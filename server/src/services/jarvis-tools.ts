import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../middleware/logger.js";

const execAsync = promisify(exec);

/**
 * Mac-resident tool surface for Augi.
 *
 * This module wires the safe + read-mostly tools that Augi can call
 * directly without confirmation: shell exec with a sensible timeout,
 * filesystem read / list / search under the user's home, and read-only
 * AppleScript bridges to Calendar / Reminders / Messages. The query
 * surface is what Augi needs to answer "what did Baily send me?" or
 * "what's on my calendar tomorrow?".
 *
 * Irreversible / write operations (sending a message, scheduling an
 * event, deleting a file) are NOT exposed here. The persona requires a
 * brief confirmation before any irreversible action, and that
 * confirmation flow runs through the chat UI — when those tools land,
 * they go through `requestConfirmation()` first and only execute after
 * Tyler taps approve. See JARVIS-TOOLS.md for the contract.
 *
 * All tool calls return { ok, value? , error? } so the brain can decide
 * whether to surface the failure verbatim or fall back to a deterministic
 * reply.
 */

export interface ToolResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  ms: number;
}

const SHELL_TIMEOUT_MS = 15_000;
const SHELL_MAX_BYTES = 256_000;

/**
 * Restricted-but-real shell exec. No PATH narrowing or sudo gating yet —
 * the server already runs as Tyler. The hard limits are:
 *   - 15 second wall-clock timeout
 *   - 256 KB max stdout (truncated with a marker)
 *   - explicit DENY list for the most foot-gun-prone command names
 *     (rm -rf, format, mkfs, dd if=...)
 */
const SHELL_DENY_PATTERNS: RegExp[] = [
  /\brm\s+-r\w*\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{/, // fork bomb start
  /\bshutdown\b/i,
  /\bhalt\b/i,
  /\bdiskutil\s+eraseDisk\b/i,
  /\b>\s*\/dev\/(sda|disk0)/i,
];

export interface ShellOptions {
  cwd?: string;
  envExtra?: Record<string, string>;
}

export async function shellExec(
  cmd: string,
  options: ShellOptions = {},
): Promise<ToolResult<{ stdout: string; stderr: string; truncated: boolean }>> {
  const start = Date.now();
  for (const pat of SHELL_DENY_PATTERNS) {
    if (pat.test(cmd)) {
      return {
        ok: false,
        error: `Refused: matched local-safety deny pattern ${pat}. Use the explicit confirmation flow for destructive operations.`,
        ms: Date.now() - start,
      };
    }
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: SHELL_MAX_BYTES,
      cwd: options.cwd,
      env: { ...process.env, ...options.envExtra },
    });
    const out = String(stdout).slice(0, SHELL_MAX_BYTES);
    const err = String(stderr).slice(0, SHELL_MAX_BYTES);
    return {
      ok: true,
      value: {
        stdout: out,
        stderr: err,
        truncated: out.length === SHELL_MAX_BYTES,
      },
      ms: Date.now() - start,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      error: e.message ?? "shell exec failed",
      value: {
        stdout: String(e.stdout ?? "").slice(0, SHELL_MAX_BYTES),
        stderr: String(e.stderr ?? "").slice(0, SHELL_MAX_BYTES),
        truncated: false,
      },
      ms: Date.now() - start,
    };
  }
}

/**
 * Filesystem reads. Scoped to the user's home + /tmp by default; a
 * caller can opt out with `allowAny: true` if they're sure (rare).
 */
const DEFAULT_FS_ROOTS = [os.homedir(), "/tmp"];

function resolveAndAuthorize(target: string, allowAny: boolean): string | null {
  const resolved = path.resolve(target);
  if (allowAny) return resolved;
  for (const root of DEFAULT_FS_ROOTS) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  }
  return null;
}

export async function fsRead(
  target: string,
  opts: { encoding?: BufferEncoding; allowAny?: boolean; maxBytes?: number } = {},
): Promise<ToolResult<string>> {
  const start = Date.now();
  const authorized = resolveAndAuthorize(target, opts.allowAny ?? false);
  if (!authorized) {
    return {
      ok: false,
      error: `fs.read denied: ${target} is outside the default-allowed roots (${DEFAULT_FS_ROOTS.join(", ")}).`,
      ms: Date.now() - start,
    };
  }
  try {
    const buf = await fs.readFile(authorized);
    const cap = opts.maxBytes ?? 256_000;
    const text = buf.subarray(0, cap).toString(opts.encoding ?? "utf8");
    return { ok: true, value: text, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: (err as Error).message, ms: Date.now() - start };
  }
}

export async function fsList(
  target: string,
  opts: { allowAny?: boolean } = {},
): Promise<ToolResult<{ name: string; type: "file" | "dir" | "symlink" | "other"; sizeBytes?: number }[]>> {
  const start = Date.now();
  const authorized = resolveAndAuthorize(target, opts.allowAny ?? false);
  if (!authorized) {
    return {
      ok: false,
      error: `fs.list denied: ${target} is outside the default-allowed roots.`,
      ms: Date.now() - start,
    };
  }
  try {
    const entries = await fs.readdir(authorized, { withFileTypes: true });
    const value = await Promise.all(
      entries.map(async (e) => {
        const full = path.join(authorized, e.name);
        let type: "file" | "dir" | "symlink" | "other" = "other";
        if (e.isFile()) type = "file";
        else if (e.isDirectory()) type = "dir";
        else if (e.isSymbolicLink()) type = "symlink";
        let sizeBytes: number | undefined;
        if (type === "file") {
          try {
            const st = await fs.stat(full);
            sizeBytes = st.size;
          } catch {}
        }
        return { name: e.name, type, sizeBytes };
      }),
    );
    return { ok: true, value, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: (err as Error).message, ms: Date.now() - start };
  }
}

export async function fsSearch(
  root: string,
  query: string,
  opts: { allowAny?: boolean; maxResults?: number } = {},
): Promise<ToolResult<string[]>> {
  const start = Date.now();
  const authorized = resolveAndAuthorize(root, opts.allowAny ?? false);
  if (!authorized) {
    return {
      ok: false,
      error: `fs.search denied: ${root} is outside the default-allowed roots.`,
      ms: Date.now() - start,
    };
  }
  // Use the OS `find` for speed. Limit results to keep the brain prompt tight.
  const max = Math.max(1, Math.min(opts.maxResults ?? 50, 200));
  const escaped = query.replace(/'/g, "'\\''");
  const result = await shellExec(
    `find ${JSON.stringify(authorized)} -iname '${escaped}' -not -path '*/.git/*' -not -path '*/node_modules/*' -maxdepth 6 | head -${max}`,
  );
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error ?? "find failed", ms: Date.now() - start };
  }
  const lines = result.value.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return { ok: true, value: lines, ms: Date.now() - start };
}

// =================================================================
// AppleScript bridge — read-only
// =================================================================

async function osascript(script: string): Promise<ToolResult<string>> {
  if (os.platform() !== "darwin") {
    return { ok: false, error: "AppleScript bridge requires macOS", ms: 0 };
  }
  // -ss enables raw output that we can parse line-by-line.
  const escaped = script.replace(/'/g, "'\\''");
  const result = await shellExec(`osascript -e '${escaped}'`);
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error ?? "osascript failed", ms: result.ms };
  }
  return { ok: true, value: result.value.stdout.trim(), ms: result.ms };
}

export interface CalendarEvent {
  title: string;
  startDate: string;
  endDate: string;
  calendar: string;
}

/**
 * Pulls upcoming Calendar events within `windowHours` from now. Triggers
 * the macOS Automation prompt on first call — Tyler grants once, then
 * subsequent calls are silent.
 */
export async function calendarUpcoming(windowHours = 24): Promise<ToolResult<CalendarEvent[]>> {
  const start = Date.now();
  const script = `
tell application "Calendar"
  set out to ""
  set startWindow to current date
  set endWindow to startWindow + (${windowHours} * hours)
  repeat with cal in calendars
    set evts to (every event of cal whose start date is greater than or equal to startWindow and start date is less than endWindow)
    repeat with e in evts
      set out to out & (summary of e) & "|" & (start date of e) & "|" & (end date of e) & "|" & (name of cal) & linefeed
    end repeat
  end repeat
  return out
end tell
`.trim();
  const result = await osascript(script);
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error ?? "calendar query failed", ms: Date.now() - start };
  }
  const lines = result.value.split("\n").filter((l) => l.trim().length > 0);
  const events: CalendarEvent[] = lines.map((l) => {
    const [title = "", startDate = "", endDate = "", calendar = ""] = l.split("|");
    return { title, startDate, endDate, calendar };
  });
  return { ok: true, value: events, ms: Date.now() - start };
}

export interface ReminderItem {
  name: string;
  completed: boolean;
  list: string;
  dueDate: string | null;
}

/**
 * Pulls open reminders from the macOS Reminders app. Same Automation
 * permission prompt rule applies.
 */
export async function remindersOpen(): Promise<ToolResult<ReminderItem[]>> {
  const start = Date.now();
  const script = `
tell application "Reminders"
  set out to ""
  repeat with l in lists
    set reminders_in_list to (every reminder of l whose completed is false)
    repeat with r in reminders_in_list
      set d to ""
      try
        set d to (due date of r) as string
      end try
      set out to out & (name of r) & "|" & (completed of r as string) & "|" & (name of l) & "|" & d & linefeed
    end repeat
  end repeat
  return out
end tell
`.trim();
  const result = await osascript(script);
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error ?? "reminders query failed", ms: Date.now() - start };
  }
  const lines = result.value.split("\n").filter((l) => l.trim().length > 0);
  const items: ReminderItem[] = lines.map((l) => {
    const [name = "", completed = "false", list = "", dueDate = ""] = l.split("|");
    return {
      name,
      completed: completed.toLowerCase() === "true",
      list,
      dueDate: dueDate.length > 0 ? dueDate : null,
    };
  });
  return { ok: true, value: items, ms: Date.now() - start };
}

export interface MessageThread {
  handle: string;
  lastMessageDate: string;
  unread: boolean;
}

/**
 * Lists recent iMessage / SMS chats. Uses AppleScript against the
 * Messages app — no chat.db read (which needs Full Disk Access).
 */
export async function messagesRecent(limit = 10): Promise<ToolResult<MessageThread[]>> {
  const start = Date.now();
  const max = Math.max(1, Math.min(limit, 50));
  const script = `
tell application "Messages"
  set out to ""
  set chatList to chats
  set i to 0
  repeat with c in chatList
    if i is greater than or equal to ${max} then exit repeat
    set i to i + 1
    set h to ""
    try
      set h to (id of c) as string
    end try
    set t to ""
    try
      set t to (text of (first text chat of c)) as string
    end try
    set out to out & h & "|" & t & linefeed
  end repeat
  return out
end tell
`.trim();
  const result = await osascript(script);
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error ?? "messages query failed", ms: Date.now() - start };
  }
  const lines = result.value.split("\n").filter((l) => l.trim().length > 0);
  const threads: MessageThread[] = lines.map((l) => {
    const [handle = "", lastMessageDate = ""] = l.split("|");
    return { handle, lastMessageDate, unread: false };
  });
  return { ok: true, value: threads, ms: Date.now() - start };
}

// =================================================================
// Confirmation registry — for irreversible operations
// =================================================================
/**
 * Augi's irreversible actions (send iMessage, schedule Calendar event,
 * write files outside ~/Downloads, etc.) get registered here pending
 * Tyler's confirmation in the chat UI. The brain emits a confirmation
 * request payload; the client renders it as a yes/no card; once Tyler
 * taps approve, the client POSTs back to /jarvis/confirm/:id which
 * runs the queued action.
 *
 * The actual write/send wiring lands in a follow-up commit — for now
 * this is the registry + types so the API contract is stable.
 */
export interface PendingConfirmation {
  id: string;
  summary: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

const CONFIRMATIONS = new Map<string, PendingConfirmation>();
const CONFIRMATION_TTL_MS = 5 * 60_000;

export function requestConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  summary: string,
): PendingConfirmation {
  // Prune expired entries opportunistically.
  const now = Date.now();
  for (const [k, v] of CONFIRMATIONS) {
    if (v.expiresAt < now) CONFIRMATIONS.delete(k);
  }
  const id = `c-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: PendingConfirmation = {
    id,
    toolName,
    args,
    summary,
    expiresAt: now + CONFIRMATION_TTL_MS,
  };
  CONFIRMATIONS.set(id, entry);
  logger.info({ id, toolName, summary }, "jarvis-tools: confirmation queued");
  return entry;
}

export function consumeConfirmation(id: string): PendingConfirmation | null {
  const entry = CONFIRMATIONS.get(id) ?? null;
  if (entry) CONFIRMATIONS.delete(id);
  if (entry && entry.expiresAt < Date.now()) return null;
  return entry;
}

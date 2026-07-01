import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../middleware/logger.js";

const execAsync = promisify(exec);

/**
 * Probes what Augi can actually do on this machine. Tyler's persona
 * promises a wide tool surface (shell, fs, AppleScript, iPhone bridge,
 * iMessage, Calendar) — this service grounds those promises in what's
 * really installed and reachable.
 *
 * The probe is cached for 10 minutes per company (saved to
 * paperclip.jarvis.capabilities.json under the data dir). Tyler can
 * force a refresh via the "Run Diagnostics" link or
 * GET /jarvis/capabilities?refresh=1.
 *
 * Each capability surfaces:
 *   - id (stable key)
 *   - label (human, used in the UI + Augi's "what can you do" reply)
 *   - status: ready | needs_install | needs_permission | unsupported
 *   - install_hint: shell command Tyler runs to enable it (when missing)
 *   - check_ms: how long the probe took
 */

export type CapabilityStatus = "ready" | "needs_install" | "needs_permission" | "unsupported";

export interface Capability {
  id: string;
  group: "machine" | "phone" | "apps" | "paperclip" | "web";
  label: string;
  status: CapabilityStatus;
  detail?: string;
  installHint?: string;
  checkMs: number;
}

export interface CapabilitySnapshot {
  generatedAt: string;
  hostPlatform: NodeJS.Platform;
  capabilities: Capability[];
}

const CACHE_TTL_MS = 10 * 60_000;

interface CacheEntry {
  snapshot: CapabilitySnapshot;
  loadedAt: number;
}

let cache: CacheEntry | null = null;

function cachePath(): string {
  const dir = process.env.PAPERCLIP_HOME && process.env.PAPERCLIP_HOME.length > 0
    ? process.env.PAPERCLIP_HOME
    : path.join(os.homedir(), ".paperclip");
  return path.join(dir, "jarvis-capabilities.json");
}

async function readCacheFile(): Promise<CapabilitySnapshot | null> {
  try {
    const raw = await fs.readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as CapabilitySnapshot;
    if (parsed && Array.isArray(parsed.capabilities)) return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logger.warn({ err }, "jarvis-capabilities: cache read failed");
    }
  }
  return null;
}

async function writeCacheFile(snapshot: CapabilitySnapshot): Promise<void> {
  try {
    const target = cachePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  } catch (err) {
    logger.warn({ err }, "jarvis-capabilities: cache write failed");
  }
}

async function timedCheck<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - start };
  } catch {
    return { value: null, ms: Date.now() - start };
  }
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`command -v ${cmd}`, { timeout: 3000 });
    const found = stdout.trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

async function probeMachineCapabilities(): Promise<Capability[]> {
  const out: Capability[] = [];

  // Shell + basic POSIX — if we're running, this is always ready.
  out.push({
    id: "machine.shell",
    group: "machine",
    label: "Shell execution (bash / zsh)",
    status: "ready",
    detail: `Running on ${os.platform()} ${os.arch()}, Node ${process.version}`,
    checkMs: 0,
  });

  // Filesystem access — also always ready under the server's uid.
  out.push({
    id: "machine.fs",
    group: "machine",
    label: "Filesystem read / write / search",
    status: "ready",
    detail: `Home: ${os.homedir()}`,
    checkMs: 0,
  });

  // Common dev tools (sqlite3, ffmpeg, yt-dlp, jq, git).
  const tools = [
    { cmd: "sqlite3", label: "SQLite CLI", install: "brew install sqlite" },
    { cmd: "ffmpeg", label: "FFmpeg", install: "brew install ffmpeg" },
    { cmd: "yt-dlp", label: "yt-dlp", install: "brew install yt-dlp" },
    { cmd: "jq", label: "jq", install: "brew install jq" },
    { cmd: "git", label: "git", install: "brew install git" },
  ];
  for (const t of tools) {
    const { value, ms } = await timedCheck(() => which(t.cmd));
    out.push({
      id: `machine.${t.cmd}`,
      group: "machine",
      label: t.label,
      status: value ? "ready" : "needs_install",
      detail: value ?? undefined,
      installHint: value ? undefined : t.install,
      checkMs: ms,
    });
  }

  return out;
}

async function probeAppCapabilities(): Promise<Capability[]> {
  if (os.platform() !== "darwin") {
    return [
      {
        id: "apps.applescript",
        group: "apps",
        label: "AppleScript bridge",
        status: "unsupported",
        detail: "macOS only",
        checkMs: 0,
      },
    ];
  }

  const out: Capability[] = [];
  const { value: osascript, ms: osascriptMs } = await timedCheck(() => which("osascript"));
  out.push({
    id: "apps.applescript",
    group: "apps",
    label: "AppleScript bridge (osascript)",
    status: osascript ? "ready" : "unsupported",
    detail: osascript ?? "osascript not found on PATH",
    checkMs: osascriptMs,
  });

  // Native macOS apps reachable through AppleScript. These checks confirm
  // the app is installed; they DO NOT verify Automation permission — that
  // pops a dialog on first real use which Tyler will grant.
  if (osascript) {
    const apps = [
      { bundle: "com.apple.iCal", label: "Calendar" },
      { bundle: "com.apple.reminders", label: "Reminders" },
      { bundle: "com.apple.MobileSMS", label: "Messages (iMessage)" },
      { bundle: "com.apple.Notes", label: "Notes" },
      { bundle: "com.apple.mail", label: "Mail" },
      { bundle: "com.apple.Safari", label: "Safari" },
      { bundle: "com.apple.Photos", label: "Photos" },
    ];
    for (const a of apps) {
      const { value, ms } = await timedCheck(async () => {
        const { stdout } = await execAsync(
          `osascript -e 'tell application "Finder" to exists (application file id "${a.bundle}")'`,
          { timeout: 3000 },
        );
        return stdout.trim() === "true";
      });
      out.push({
        id: `apps.${a.bundle}`,
        group: "apps",
        label: a.label,
        status: value === true ? "ready" : "unsupported",
        detail: value === true
          ? "Automation prompt appears on first write — grant in System Settings → Privacy & Security → Automation."
          : "App not detected",
        checkMs: ms,
      });
    }
  }

  return out;
}

async function probePhoneCapabilities(): Promise<Capability[]> {
  if (os.platform() !== "darwin") {
    return [
      {
        id: "phone.bridge",
        group: "phone",
        label: "iPhone bridge",
        status: "unsupported",
        detail: "macOS host required",
        checkMs: 0,
      },
    ];
  }

  const out: Capability[] = [];

  // libimobiledevice toolchain — file system + diagnostics
  const { value: ideviceinfo, ms: ideviceMs } = await timedCheck(() => which("ideviceinfo"));
  out.push({
    id: "phone.libimobiledevice",
    group: "phone",
    label: "libimobiledevice (USB diagnostics + filesystem)",
    status: ideviceinfo ? "ready" : "needs_install",
    detail: ideviceinfo ?? "Toolchain not installed",
    installHint: ideviceinfo ? undefined : "brew install libimobiledevice ideviceinstaller",
    checkMs: ideviceMs,
  });

  // pymobiledevice3 — newer iOS support (17+)
  const { value: pmd3, ms: pmd3Ms } = await timedCheck(() => which("pymobiledevice3"));
  out.push({
    id: "phone.pymobiledevice3",
    group: "phone",
    label: "pymobiledevice3 (iOS 17+ services)",
    status: pmd3 ? "ready" : "needs_install",
    detail: pmd3 ?? "Python package not installed",
    installHint: pmd3 ? undefined : "pipx install pymobiledevice3",
    checkMs: pmd3Ms,
  });

  // Device connected? (only useful if libimobiledevice is present)
  if (ideviceinfo) {
    const { value, ms } = await timedCheck(async () => {
      const { stdout } = await execAsync("idevice_id -l 2>/dev/null", { timeout: 3000 });
      return stdout.trim().split("\n").filter(Boolean);
    });
    const deviceCount = Array.isArray(value) ? value.length : 0;
    out.push({
      id: "phone.connected",
      group: "phone",
      label: deviceCount > 0 ? `iPhone connected (${deviceCount})` : "No iPhone over USB",
      status: deviceCount > 0 ? "ready" : "needs_permission",
      detail: deviceCount > 0
        ? `${deviceCount} device(s) paired and trusted`
        : "Plug in iPhone via USB and tap 'Trust' to enable the bridge.",
      checkMs: ms,
    });
  }

  // Messages bridge — iMessage via Continuity uses the local Messages app
  // (covered under apps.com.apple.MobileSMS) plus the Messages.app DB at
  // ~/Library/Messages/chat.db for read access.
  const { value: messagesDb, ms: messagesDbMs } = await timedCheck(async () => {
    const target = path.join(os.homedir(), "Library", "Messages", "chat.db");
    await fs.access(target);
    return target;
  });
  out.push({
    id: "phone.messages_db",
    group: "phone",
    label: "Messages (chat.db) read",
    status: messagesDb ? "needs_permission" : "unsupported",
    detail: messagesDb
      ? "DB found — needs Full Disk Access for the server process to read."
      : "chat.db not found at the expected location.",
    installHint: messagesDb
      ? "Grant Terminal (or your shell binary) Full Disk Access in System Settings → Privacy & Security."
      : undefined,
    checkMs: messagesDbMs,
  });

  return out;
}

async function probePaperclipCapabilities(): Promise<Capability[]> {
  // Self-test: Paperclip's own data + tools are always reachable from
  // inside the server. Listed here so Augi can say "I can pull cost-
  // watcher numbers, fleet status, blocked issues, ..." accurately.
  return [
    {
      id: "paperclip.cost_watcher",
      group: "paperclip",
      label: "Cost watcher (spend / alerts / top-burn agent)",
      status: "ready",
      checkMs: 0,
    },
    {
      id: "paperclip.issues",
      group: "paperclip",
      label: "Issues (blocked count / filters / create)",
      status: "ready",
      checkMs: 0,
    },
    {
      id: "paperclip.agents",
      group: "paperclip",
      label: "Agent fleet (status / runs / dispatch)",
      status: "ready",
      checkMs: 0,
    },
    {
      id: "paperclip.search",
      group: "paperclip",
      label: "Semantic search across issues / agents / rooms / knowledge",
      status: "ready",
      checkMs: 0,
    },
    {
      id: "paperclip.routines",
      group: "paperclip",
      label: "Routines (schedule + run-once)",
      status: "ready",
      checkMs: 0,
    },
  ];
}

async function probeWebCapabilities(): Promise<Capability[]> {
  const out: Capability[] = [];
  out.push({
    id: "web.fetch",
    group: "web",
    label: "Web fetch (any URL)",
    status: "ready",
    checkMs: 0,
  });

  const { value: curl, ms } = await timedCheck(() => which("curl"));
  out.push({
    id: "web.curl",
    group: "web",
    label: "curl",
    status: curl ? "ready" : "needs_install",
    detail: curl ?? undefined,
    installHint: curl ? undefined : "brew install curl",
    checkMs: ms,
  });

  return out;
}

export async function probeCapabilities(): Promise<CapabilitySnapshot> {
  const start = Date.now();
  const [machine, apps, phone, paperclip, web] = await Promise.all([
    probeMachineCapabilities(),
    probeAppCapabilities(),
    probePhoneCapabilities(),
    probePaperclipCapabilities(),
    probeWebCapabilities(),
  ]);
  const snapshot: CapabilitySnapshot = {
    generatedAt: new Date().toISOString(),
    hostPlatform: os.platform(),
    capabilities: [...machine, ...apps, ...phone, ...paperclip, ...web],
  };
  logger.info(
    { ms: Date.now() - start, total: snapshot.capabilities.length },
    "jarvis-capabilities: probe complete",
  );
  return snapshot;
}

export async function getCapabilitySnapshot(opts: { refresh?: boolean } = {}): Promise<CapabilitySnapshot> {
  const now = Date.now();
  if (!opts.refresh && cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.snapshot;
  }
  // Try the on-disk cache before re-probing — survives a server restart.
  if (!opts.refresh && !cache) {
    const persisted = await readCacheFile();
    if (persisted) {
      const generatedAt = Date.parse(persisted.generatedAt);
      if (!Number.isNaN(generatedAt) && now - generatedAt < CACHE_TTL_MS) {
        cache = { snapshot: persisted, loadedAt: generatedAt };
        return persisted;
      }
    }
  }

  const snapshot = await probeCapabilities();
  cache = { snapshot, loadedAt: now };
  await writeCacheFile(snapshot);
  return snapshot;
}

/** Render a short bullet-free prose summary for Augi to weave into replies. */
export function summarizeForPersona(snapshot: CapabilitySnapshot): string {
  const ready = snapshot.capabilities.filter((c) => c.status === "ready");
  const missing = snapshot.capabilities.filter((c) => c.status === "needs_install");
  const permission = snapshot.capabilities.filter((c) => c.status === "needs_permission");
  const lines: string[] = [];
  lines.push(`You currently have ${ready.length} ready capabilities on this host.`);
  if (missing.length > 0) {
    lines.push(
      `Missing (install needed): ${missing.map((c) => c.label).join(", ")}.`,
    );
  }
  if (permission.length > 0) {
    lines.push(
      `Pending Tyler's permission grant: ${permission.map((c) => c.label).join(", ")}.`,
    );
  }
  return lines.join(" ");
}

// ponytail: unbuffered crash-safe log + EPIPE guard. One file, no deps.
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";

const LOG_PATH = "/tmp/pc-server.log";
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

// --- rotation on import ---
if (existsSync(LOG_PATH)) {
  try {
    const { size } = statSync(LOG_PATH);
    if (size > MAX_SIZE) {
      // Shift: .4 -> .5, .3 -> .4, ..., current -> .1
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const old = `${LOG_PATH}.${i}`;
        const next = `${LOG_PATH}.${i + 1}`;
        try { if (existsSync(old)) renameSync(old, next); } catch {}
      }
      try { renameSync(LOG_PATH, `${LOG_PATH}.1`); } catch {}
    }
  } catch {
    // FS errors during rotation are non-fatal — log won't rotate this time
  }
}

// --- startup marker ---
try {
  appendFileSync(LOG_PATH, `\n=== SERVER START ${new Date().toISOString()} ===\n`);
} catch {}

// --- unbuffered append ---
export function pcLog(message: string): void {
  try {
    const ts = new Date().toISOString();
    appendFileSync(LOG_PATH, `[${ts}] ${message}\n`);
  } catch {
    // drop on floor — this is a best-effort crash log
  }
}

// --- EPIPE-safe console wrappers ---
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

function safeWrite(fn: typeof _origWarn, ...args: unknown[]): void {
  try { fn(...args); } catch (e: unknown) {
    if (e instanceof Error && (e as Error & { code?: string }).code === "EPIPE") {
      // stdout/stderr pipe closed — terminal gone, nothing to do
      return;
    }
    throw e;
  }
}

console.warn = (...args: unknown[]) => safeWrite(_origWarn, ...args);
console.error = (...args: unknown[]) => safeWrite(_origError, ...args);

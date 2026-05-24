/**
 * Provider API Keys store.
 *
 * Keys live in a single JSON file on disk:
 *   ~/.paperclip/provider-api-keys.json
 *
 * Tyler explicitly named this path as the "Augi/August inject them here"
 * backup channel. The UI Save flow writes this file, and Augi/August
 * scripts can write it directly — both paths converge on the same store.
 *
 * The file is mode 0600 so the running user is the only reader. Never
 * include the raw key value in any HTTP response; redactedMetadata()
 * returns last-4 + lastUpdated only.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type ProviderKey =
  | "deepseek"
  | "moonshot"
  | "openai"
  | "anthropic"
  | "gemini";

export const SUPPORTED_PROVIDERS: ProviderKey[] = [
  "deepseek",
  "moonshot",
  "openai",
  "anthropic",
  "gemini",
];

interface StoredKey {
  /** Raw secret. Never returned over HTTP — only used for adapter calls. */
  value: string;
  /** ISO timestamp the key was last written. */
  updatedAt: string;
}

type StoreShape = Partial<Record<ProviderKey, StoredKey>>;

export interface RedactedKeyEntry {
  provider: ProviderKey;
  hasKey: boolean;
  last4: string | null;
  updatedAt: string | null;
}

function storePath(): string {
  // PAPERCLIP_HOME override (test harness uses this); fallback to ~/.paperclip.
  const baseDir = process.env.PAPERCLIP_HOME && process.env.PAPERCLIP_HOME.length > 0
    ? process.env.PAPERCLIP_HOME
    : path.join(os.homedir(), ".paperclip");
  return path.join(baseDir, "provider-api-keys.json");
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StoreShape;
    }
  } catch (err) {
    // File missing is the normal startup case — return empty.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    // Malformed JSON or permission error: log and continue with empty.
    // eslint-disable-next-line no-console
    console.warn("[provider-api-keys] failed to read store:", err);
  }
  return {};
}

async function writeStore(next: StoreShape): Promise<void> {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/** Returned by GET — never exposes the raw key value. */
export async function listRedactedKeys(): Promise<RedactedKeyEntry[]> {
  const store = await readStore();
  return SUPPORTED_PROVIDERS.map((provider) => {
    const entry = store[provider];
    if (!entry || typeof entry.value !== "string" || entry.value.length === 0) {
      return { provider, hasKey: false, last4: null, updatedAt: null };
    }
    const tail = entry.value.length >= 4 ? entry.value.slice(-4) : entry.value;
    return {
      provider,
      hasKey: true,
      last4: tail,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
    };
  });
}

/**
 * Internal-only: return the raw key for a provider (used by the
 * provider-credits service to make real API calls). Never expose this
 * via HTTP.
 */
export async function getRawKey(provider: ProviderKey): Promise<string | null> {
  const store = await readStore();
  const entry = store[provider];
  return entry && typeof entry.value === "string" && entry.value.length > 0 ? entry.value : null;
}

/** Upsert a single provider's key. Pass empty string to clear. */
export async function setKey(provider: ProviderKey, rawValue: string): Promise<RedactedKeyEntry> {
  const trimmed = rawValue.trim();
  const store = await readStore();
  if (trimmed.length === 0) {
    delete store[provider];
  } else {
    store[provider] = { value: trimmed, updatedAt: new Date().toISOString() };
  }
  await writeStore(store);
  const fresh = await listRedactedKeys();
  return fresh.find((entry) => entry.provider === provider)!;
}

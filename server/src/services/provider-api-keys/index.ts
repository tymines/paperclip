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
  | "gemini"
  // Jarvis premium voice tier — used independently from the chat-completion
  // providers. openai_realtime is the WebRTC STT gateway; elevenlabs is the
  // streaming TTS provider. Adding new slots here automatically surfaces them
  // in the existing instance/settings/provider-keys page.
  | "openai_realtime"
  | "elevenlabs"
  // Replicate — hosted LoRA training (ostris/flux-dev-lora-trainer) for the
  // Image Studio persona pipeline. Single bearer token, stored like elevenlabs.
  | "replicate"
  // Atlas Cloud — OpenAI-compatible LLM gateway (api.atlascloud.ai/v1). Single
  // bearer token (apikey-…), stored like the other provider keys.
  | "atlascloud"
  // WaveSpeed AI — image/video generation API (api.wavespeed.ai/api/v3). Single
  // bearer token (wsk_live_…), stored like the other provider keys.
  | "wavespeedai";

export const SUPPORTED_PROVIDERS: ProviderKey[] = [
  "deepseek",
  "moonshot",
  "openai",
  "anthropic",
  "gemini",
  "openai_realtime",
  "elevenlabs",
  "replicate",
  "atlascloud",
  "wavespeedai",
];

interface StoredKey {
  /** Raw secret. Never returned over HTTP — only used for adapter calls. */
  value: string;
  /** ISO timestamp the key was last written. */
  updatedAt: string;
}

/**
 * On disk a key entry is either a {value, updatedAt} object (current
 * format written by setKey) or a bare string (legacy / out-of-band
 * writes, e.g. Augi/August dropping keys directly into the file). Both
 * shapes are accepted on read; setKey always writes the object form.
 */
type StoreEntry = StoredKey | string;
type StoreShape = Partial<Record<ProviderKey, StoreEntry>>;

function entryValue(entry: StoreEntry | undefined): string | null {
  if (typeof entry === "string") return entry.length > 0 ? entry : null;
  if (entry && typeof entry.value === "string" && entry.value.length > 0) return entry.value;
  return null;
}

function entryUpdatedAt(entry: StoreEntry | undefined): string | null {
  if (typeof entry === "string" || !entry) return null;
  return typeof entry.updatedAt === "string" ? entry.updatedAt : null;
}

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
    const raw = entryValue(store[provider]);
    if (!raw) return { provider, hasKey: false, last4: null, updatedAt: null };
    const tail = raw.length >= 4 ? raw.slice(-4) : raw;
    return {
      provider,
      hasKey: true,
      last4: tail,
      updatedAt: entryUpdatedAt(store[provider]),
    };
  });
}

/**
 * Internal-only: return the raw key for a provider (used by the
 * provider-credits service to make real API calls). Never expose this
 * via HTTP.
 */
/**
 * Well-known environment variables per provider. The on-disk store takes
 * precedence (UI-saved / Augi-injected keys); env vars are a fallback so a key
 * that's live in the process environment (e.g. GOOGLE_API_KEY on the box) is
 * usable without also being written into provider-api-keys.json.
 *
 * 2026-07-12 (Fable): added because getRawKey previously read ONLY the store,
 * so a live GOOGLE_API_KEY was invisible — Book Studio's Gemini lane fell
 * through to the misleading "Anthropic not configured" error.
 */
const PROVIDER_ENV_FALLBACKS: Record<ProviderKey, string[]> = {
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  replicate: ["REPLICATE_API_TOKEN", "REPLICATE_API_KEY"],
  atlascloud: ["ATLASCLOUD_API_KEY", "ATLAS_CLOUD_API_KEY"],
  wavespeedai: ["WAVESPEED_API_KEY", "WAVESPEEDAI_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  openai_realtime: ["OPENAI_REALTIME_API_KEY"],
};

function envKey(provider: ProviderKey): string | null {
  for (const name of PROVIDER_ENV_FALLBACKS[provider] ?? []) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export async function getRawKey(provider: ProviderKey): Promise<string | null> {
  const store = await readStore();
  return entryValue(store[provider]) ?? envKey(provider);
}

/** Whether a provider has a usable key (store OR env). Never returns the value. */
export async function isProviderConfigured(provider: ProviderKey): Promise<boolean> {
  return (await getRawKey(provider)) !== null;
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

/**
 * Lightweight AES-256-GCM helper for social-OAuth credentials and tokens.
 *
 * Uses the same master key as the local_encrypted secrets provider — so
 * if Tyler ever rotates `PAPERCLIP_SECRETS_MASTER_KEY` or its file, both
 * subsystems rotate together. Stored as a small JSON envelope rather than
 * a string so future schemes (KMS, etc.) can be added by switching on
 * `scheme`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDefaultSecretsKeyFilePath } from "../../home-paths.js";

export interface EncryptedEnvelope {
  scheme: "local_encrypted_v1";
  iv: string;
  tag: string;
  ciphertext: string;
}

function decodeMasterKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    /* ignore */
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32) return Buffer.from(trimmed, "utf8");
  return null;
}

function loadOrCreateMasterKey(): Buffer {
  const envKeyRaw = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  if (envKeyRaw && envKeyRaw.trim().length > 0) {
    const key = decodeMasterKey(envKeyRaw);
    if (!key) {
      throw new Error(
        "PAPERCLIP_SECRETS_MASTER_KEY is set but is not a valid 32-byte key (expected 32-byte base64, 64-char hex, or raw 32-char string)",
      );
    }
    return key;
  }
  const keyPath =
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE?.trim() ||
    resolveDefaultSecretsKeyFilePath();
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf8");
    const decoded = decodeMasterKey(raw);
    if (!decoded) {
      throw new Error(`Invalid secrets master key material at ${keyPath}`);
    }
    return decoded;
  }
  const generated = randomBytes(32);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, generated.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* best effort */
  }
  return generated;
}

export function encryptOAuthSecret(value: string): EncryptedEnvelope {
  const key = loadOrCreateMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    scheme: "local_encrypted_v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptOAuthSecret(envelope: EncryptedEnvelope): string {
  if (envelope.scheme !== "local_encrypted_v1") {
    throw new Error(`Unknown OAuth secret scheme: ${envelope.scheme}`);
  }
  const key = loadOrCreateMasterKey();
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).scheme === "local_encrypted_v1" &&
    typeof (value as Record<string, unknown>).iv === "string" &&
    typeof (value as Record<string, unknown>).tag === "string" &&
    typeof (value as Record<string, unknown>).ciphertext === "string"
  );
}

export function fingerprintOAuthSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function last4(value: string): string | null {
  if (!value) return null;
  return value.length <= 4 ? value : value.slice(-4);
}

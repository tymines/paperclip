/**
 * Webhook receivers for third-party services.
 *
 * Currently scoped to ElevenLabs. The receiver verifies HMAC, logs the
 * raw payload to `webhook_event_log`, and returns 200 quickly. No
 * downstream handlers run yet — voice-removal and transcription routing
 * land once the cloned-voices and transcription-jobs data model exists
 * (planned separately).
 *
 * The webhook secret lives in `instance_settings.general.elevenlabsWebhookSecret`.
 * That field is NOT in the typed `instanceGeneralSettingsSchema`, so the
 * normalized GET /instance/settings/general endpoint will not leak it —
 * the secret only round-trips through the dedicated endpoints in this file
 * (admin-only) and is returned in full exactly once, at generation time.
 */
import { Router, type Request, type Response } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { instanceSettings, webhookEventLog } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { logger } from "../middleware/logger.js";

const ELEVENLABS_SOURCE = "elevenlabs";
const ELEVENLABS_SECRET_KEY = "elevenlabsWebhookSecret";
const ELEVENLABS_SECRET_BYTES = 24; // 32 base64url chars
const ELEVENLABS_SIGNATURE_HEADER = "elevenlabs-signature";
const ELEVENLABS_SIGNATURE_MAX_AGE_SECONDS = 30 * 60;

interface ElevenLabsSignatureParts {
  timestamp: number;
  signature: string;
}

export function parseElevenLabsSignatureHeader(
  header: string | undefined,
): ElevenLabsSignatureParts | null {
  if (!header || typeof header !== "string") return null;
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (!k || !v) continue;
    const key = k.trim();
    const value = v.trim();
    if (key === "t") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) timestamp = n;
    } else if (key === "v0") {
      signature = value;
    }
  }
  if (timestamp === null || signature === null || signature.length === 0) return null;
  return { timestamp, signature };
}

export interface VerifyElevenLabsSignatureInput {
  rawBody: Buffer;
  header: string | undefined;
  secret: string;
  /** Milliseconds since epoch — defaulted to Date.now(); injectable for tests. */
  nowMs?: number;
  /** Seconds; defaults to 30 minutes. */
  maxAgeSeconds?: number;
}

export type VerifyElevenLabsSignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "bad_format" | "stale_timestamp" | "bad_signature" };

export function verifyElevenLabsSignature(
  input: VerifyElevenLabsSignatureInput,
): VerifyElevenLabsSignatureResult {
  const parsed = parseElevenLabsSignatureHeader(input.header);
  if (!parsed) {
    return { ok: false, reason: input.header ? "bad_format" : "missing_header" };
  }
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const maxAge = input.maxAgeSeconds ?? ELEVENLABS_SIGNATURE_MAX_AGE_SECONDS;
  if (Math.abs(nowSeconds - parsed.timestamp) > maxAge) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const signedPayload = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    input.rawBody,
  ]);
  const expectedHex = createHmac("sha256", input.secret).update(signedPayload).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(parsed.signature, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

export function generateElevenLabsWebhookSecret(): string {
  return randomBytes(ELEVENLABS_SECRET_BYTES).toString("base64url");
}

interface WebhookSecretStore {
  read(): Promise<{ secret: string | null; updatedAt: string | null }>;
  write(secret: string): Promise<{ secret: string; updatedAt: string }>;
}

function elevenlabsWebhookSecretStore(db: Db): WebhookSecretStore {
  async function loadGeneralRow() {
    const row = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, "default"))
      .then((rows) => rows[0] ?? null);
    return row;
  }
  return {
    async read() {
      const row = await loadGeneralRow();
      if (!row) return { secret: null, updatedAt: null };
      const general = (row.general ?? {}) as Record<string, unknown>;
      const slot = general[ELEVENLABS_SECRET_KEY];
      if (
        slot &&
        typeof slot === "object" &&
        "value" in slot &&
        typeof (slot as { value: unknown }).value === "string"
      ) {
        const value = (slot as { value: string }).value;
        const updatedAt =
          typeof (slot as { updatedAt?: unknown }).updatedAt === "string"
            ? ((slot as { updatedAt: string }).updatedAt)
            : null;
        return { secret: value, updatedAt };
      }
      return { secret: null, updatedAt: null };
    },
    async write(secret: string) {
      const now = new Date();
      const updatedAt = now.toISOString();
      const existing = await loadGeneralRow();
      const baseGeneral = (existing?.general ?? {}) as Record<string, unknown>;
      const nextGeneral = {
        ...baseGeneral,
        [ELEVENLABS_SECRET_KEY]: { value: secret, updatedAt },
      };
      if (existing) {
        await db
          .update(instanceSettings)
          .set({ general: nextGeneral, updatedAt: now })
          .where(eq(instanceSettings.id, existing.id));
      } else {
        await db
          .insert(instanceSettings)
          .values({
            singletonKey: "default",
            general: nextGeneral,
            experimental: {},
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [instanceSettings.singletonKey],
            set: { general: nextGeneral, updatedAt: now },
          });
      }
      return { secret, updatedAt };
    },
  };
}

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

function resolvePublicWebhookUrl(req: Request): string {
  const envBase = process.env.PAPERCLIP_PUBLIC_BASE_URL;
  if (envBase && envBase.length > 0) {
    const trimmed = envBase.replace(/\/+$/, "");
    return `${trimmed}/api/webhooks/elevenlabs`;
  }
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ??
    req.protocol ??
    "https";
  const host = req.headers["host"] ?? "localhost";
  return `${proto}://${host}/api/webhooks/elevenlabs`;
}

function last4(secret: string): string {
  return secret.length <= 4 ? secret : secret.slice(-4);
}

/**
 * Public webhook receiver. Mounted at `/api/webhooks` OUTSIDE the
 * authenticated `/api` router so it skips the board-mutation guard.
 * Returns 200 after logging — never blocks on downstream work.
 */
export function webhookReceiverRoutes(db: Db) {
  const router = Router();
  const store = elevenlabsWebhookSecretStore(db);

  router.post("/elevenlabs", async (req: Request, res: Response) => {
    const { secret } = await store.read();
    if (!secret) {
      // No secret configured yet — refuse rather than silently accepting
      // unsigned events. Operator must generate one in /instance/settings.
      logger.warn(
        { source: ELEVENLABS_SOURCE },
        "rejected webhook: no secret configured",
      );
      res.status(401).json({ error: "webhook secret not configured" });
      return;
    }

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: "empty body" });
      return;
    }

    const header = req.header(ELEVENLABS_SIGNATURE_HEADER);
    const verification = verifyElevenLabsSignature({
      rawBody,
      header,
      secret,
    });
    if (!verification.ok) {
      logger.warn(
        { source: ELEVENLABS_SOURCE, reason: verification.reason },
        "rejected webhook: signature check failed",
      );
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      payload = { _unparsed: rawBody.toString("utf8") };
    }
    const eventType =
      payload && typeof payload === "object" && payload !== null
        ? typeof (payload as { type?: unknown }).type === "string"
          ? (payload as { type: string }).type
          : typeof (payload as { event?: unknown }).event === "string"
            ? (payload as { event: string }).event
            : "unknown"
        : "unknown";

    try {
      await db.insert(webhookEventLog).values({
        source: ELEVENLABS_SOURCE,
        eventType,
        payload: payload as object,
        processed: false,
      });
    } catch (err) {
      // Persistence failure must not cause ElevenLabs to retry — we
      // already verified the signature, so the payload is authentic.
      // Log loudly and return 200 to avoid retry storms.
      logger.error(
        { err, source: ELEVENLABS_SOURCE, eventType },
        "failed to persist webhook event",
      );
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

/**
 * Admin-only secret management. Mounted inside the `/api` router so it
 * benefits from actor middleware and the standard board-mutation guard.
 */
export function elevenlabsWebhookSecretRoutes(db: Db) {
  const router = Router();
  const store = elevenlabsWebhookSecretStore(db);

  router.get("/instance/settings/elevenlabs-webhook", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const { secret, updatedAt } = await store.read();
    res.json({
      url: resolvePublicWebhookUrl(req),
      configured: !!secret,
      last4: secret ? last4(secret) : null,
      updatedAt,
    });
  });

  router.post("/instance/settings/elevenlabs-webhook/generate", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const secret = generateElevenLabsWebhookSecret();
    const written = await store.write(secret);
    res.json({
      url: resolvePublicWebhookUrl(req),
      secret: written.secret,
      last4: last4(written.secret),
      updatedAt: written.updatedAt,
    });
  });

  return router;
}

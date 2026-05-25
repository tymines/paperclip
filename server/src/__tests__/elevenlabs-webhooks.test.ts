import express from "express";
import request from "supertest";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { instanceSettings, webhookEventLog } from "@paperclipai/db";
import {
  parseElevenLabsSignatureHeader,
  verifyElevenLabsSignature,
  generateElevenLabsWebhookSecret,
  webhookReceiverRoutes,
  elevenlabsWebhookSecretRoutes,
} from "../routes/webhooks.js";
import { errorHandler } from "../middleware/index.js";

// ── Minimal fake Db ────────────────────────────────────────────────────
// The webhook module only touches `instance_settings` and `webhook_event_log`
// through these three drizzle entry points:
//   db.select().from(X).where(Y).then(cb)
//   db.insert(X).values(Y).onConflictDoUpdate(Z)?
//   db.update(X).set(Y).where(Z)
// Each call records what was passed so tests can assert on it.
interface FakeRecords {
  instanceSettingsRow: { id: string; general: Record<string, unknown>; experimental: Record<string, unknown> } | null;
  eventLogInserts: Array<{ source: string; eventType: string; payload: unknown }>;
  instanceSettingsUpdates: number;
}

function makeFakeDb(initial: Partial<FakeRecords> = {}) {
  const records: FakeRecords = {
    instanceSettingsRow: initial.instanceSettingsRow ?? null,
    eventLogInserts: [],
    instanceSettingsUpdates: 0,
  };
  // Identity compare against the imported drizzle table objects — much
  // more robust than introspecting drizzle's internal name fields.
  function tableKind(table: unknown): "instance_settings" | "webhook_event_log" | "unknown" {
    if (table === instanceSettings) return "instance_settings";
    if (table === webhookEventLog) return "webhook_event_log";
    return "unknown";
  }

  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where(_cond: unknown) {
              const kind = tableKind(table);
              const rows = kind === "instance_settings" && records.instanceSettingsRow
                ? [records.instanceSettingsRow]
                : [];
              return {
                then(resolve: (rows: unknown[]) => unknown) {
                  return Promise.resolve(resolve(rows));
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      const kind = tableKind(table);
      return {
        values(values: Record<string, unknown>) {
          if (kind === "webhook_event_log") {
            records.eventLogInserts.push({
              source: String(values.source),
              eventType: String(values.eventType),
              payload: values.payload,
            });
            return Promise.resolve();
          }
          if (kind === "instance_settings") {
            records.instanceSettingsRow = {
              id: "row-1",
              general: (values.general ?? {}) as Record<string, unknown>,
              experimental: (values.experimental ?? {}) as Record<string, unknown>,
            };
          }
          return {
            onConflictDoUpdate(_args: unknown) {
              return Promise.resolve();
            },
          };
        },
      };
    },
    update(table: unknown) {
      const kind = tableKind(table);
      return {
        set(values: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              if (kind === "instance_settings" && records.instanceSettingsRow) {
                records.instanceSettingsRow.general = (values.general ?? {}) as Record<string, unknown>;
                records.instanceSettingsUpdates += 1;
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { db, records };
}

function buildApp(
  db: ReturnType<typeof makeFakeDb>["db"],
  actor: any = { type: "board", source: "local_implicit", isInstanceAdmin: true },
) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api/webhooks", webhookReceiverRoutes(db as any));
  app.use("/api", elevenlabsWebhookSecretRoutes(db as any));
  app.use(errorHandler);
  return app;
}

function signBody(secret: string, body: object, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), raw]);
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return { header: `t=${timestamp},v0=${sig}`, raw };
}

describe("parseElevenLabsSignatureHeader", () => {
  it("parses a well-formed header", () => {
    expect(parseElevenLabsSignatureHeader("t=1234567890,v0=abcdef")).toEqual({
      timestamp: 1234567890,
      signature: "abcdef",
    });
  });
  it("returns null for missing parts", () => {
    expect(parseElevenLabsSignatureHeader("t=1234567890")).toBeNull();
    expect(parseElevenLabsSignatureHeader("v0=abcdef")).toBeNull();
    expect(parseElevenLabsSignatureHeader("")).toBeNull();
    expect(parseElevenLabsSignatureHeader(undefined)).toBeNull();
  });
  it("returns null for non-numeric timestamp", () => {
    expect(parseElevenLabsSignatureHeader("t=oops,v0=abcdef")).toBeNull();
  });
});

describe("verifyElevenLabsSignature", () => {
  const secret = "shhh-test-secret";
  const body = Buffer.from(JSON.stringify({ event: "ping" }), "utf8");
  const ts = 1_700_000_000;
  const goodSig = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${ts}.`, "utf8"), body]))
    .digest("hex");

  it("accepts a matching signature within the window", () => {
    expect(
      verifyElevenLabsSignature({
        rawBody: body,
        header: `t=${ts},v0=${goodSig}`,
        secret,
        nowMs: ts * 1000,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ event: "tampered" }), "utf8");
    expect(
      verifyElevenLabsSignature({
        rawBody: tampered,
        header: `t=${ts},v0=${goodSig}`,
        secret,
        nowMs: ts * 1000,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyElevenLabsSignature({
        rawBody: body,
        header: `t=${ts},v0=${goodSig}`,
        secret: "different-secret",
        nowMs: ts * 1000,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a stale timestamp", () => {
    expect(
      verifyElevenLabsSignature({
        rawBody: body,
        header: `t=${ts},v0=${goodSig}`,
        secret,
        nowMs: (ts + 60 * 60) * 1000, // 1 hour later
        maxAgeSeconds: 60,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects when the header is missing", () => {
    expect(
      verifyElevenLabsSignature({ rawBody: body, header: undefined, secret }),
    ).toEqual({ ok: false, reason: "missing_header" });
  });

  it("rejects when the header is malformed", () => {
    expect(
      verifyElevenLabsSignature({ rawBody: body, header: "bogus", secret }),
    ).toEqual({ ok: false, reason: "bad_format" });
  });
});

describe("generateElevenLabsWebhookSecret", () => {
  it("returns a 32-char base64url string", () => {
    const a = generateElevenLabsWebhookSecret();
    const b = generateElevenLabsWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("POST /api/webhooks/elevenlabs", () => {
  let secret: string;
  let app: express.Express;
  let records: ReturnType<typeof makeFakeDb>["records"];

  beforeEach(() => {
    secret = "test-secret-xyz";
    const fake = makeFakeDb({
      instanceSettingsRow: {
        id: "row-1",
        general: { elevenlabsWebhookSecret: { value: secret, updatedAt: new Date().toISOString() } },
        experimental: {},
      },
    });
    records = fake.records;
    app = buildApp(fake.db);
  });

  it("returns 200 and logs the event when HMAC verifies", async () => {
    const body = { type: "voice_removal_notice", voice_id: "voice-abc" };
    const { header } = signBody(secret, body);

    const res = await request(app)
      .post("/api/webhooks/elevenlabs")
      .set("elevenlabs-signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(records.eventLogInserts).toHaveLength(1);
    expect(records.eventLogInserts[0]).toMatchObject({
      source: "elevenlabs",
      eventType: "voice_removal_notice",
    });
  });

  it("returns 401 on bad HMAC and does not log the event", async () => {
    const body = { type: "voice_removal_notice" };
    const { header } = signBody("not-the-right-secret", body);

    const res = await request(app)
      .post("/api/webhooks/elevenlabs")
      .set("elevenlabs-signature", header)
      .send(body);

    expect(res.status).toBe(401);
    expect(records.eventLogInserts).toHaveLength(0);
  });

  it("returns 401 when missing the signature header", async () => {
    const res = await request(app)
      .post("/api/webhooks/elevenlabs")
      .send({ type: "ping" });

    expect(res.status).toBe(401);
    expect(records.eventLogInserts).toHaveLength(0);
  });

  it("returns 401 when no secret is configured", async () => {
    // Rebuild app with empty store.
    const fake = makeFakeDb();
    const noSecretApp = buildApp(fake.db);

    const body = { type: "ping" };
    const { header } = signBody("anything-at-all", body);
    const res = await request(noSecretApp)
      .post("/api/webhooks/elevenlabs")
      .set("elevenlabs-signature", header)
      .send(body);

    expect(res.status).toBe(401);
    expect(fake.records.eventLogInserts).toHaveLength(0);
  });
});

describe("ElevenLabs webhook secret management", () => {
  it("returns presence + last4 (never the raw secret) from GET", async () => {
    const secret = generateElevenLabsWebhookSecret();
    const fake = makeFakeDb({
      instanceSettingsRow: {
        id: "row-1",
        general: { elevenlabsWebhookSecret: { value: secret, updatedAt: "2026-05-25T00:00:00.000Z" } },
        experimental: {},
      },
    });
    const app = buildApp(fake.db);

    const res = await request(app).get("/api/instance/settings/elevenlabs-webhook");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.last4).toBe(secret.slice(-4));
    expect(res.body.url).toContain("/api/webhooks/elevenlabs");
    expect(JSON.stringify(res.body)).not.toContain(secret); // raw secret never leaks
  });

  it("returns configured=false when nothing on file", async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake.db);
    const res = await request(app).get("/api/instance/settings/elevenlabs-webhook");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.last4).toBeNull();
  });

  it("generate returns the full secret exactly once and writes it to instance_settings.general", async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake.db);
    const res = await request(app).post("/api/instance/settings/elevenlabs-webhook/generate").send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.secret).toBe("string");
    expect(res.body.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.body.last4).toBe(res.body.secret.slice(-4));
    expect(fake.records.instanceSettingsRow?.general).toMatchObject({
      elevenlabsWebhookSecret: { value: res.body.secret },
    });
  });

  it("forbids non-admin actors from generating", async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake.db, { type: "none", source: "none" });
    const res = await request(app).post("/api/instance/settings/elevenlabs-webhook/generate").send({});
    expect(res.status).toBe(403);
  });
});

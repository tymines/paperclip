/**
 * Integration test for the wizard's OAuth callback route — confirms that
 * the route exchanges a code for real tokens via the mocked Reddit token
 * endpoint and persists the resulting accessToken/refreshToken/etc. to
 * `social_accounts` (not the legacy stub values).
 *
 * Uses an embedded postgres fixture so the round-trip through
 * `socialService.createAccount` is real DB writes; mocks the Reddit token
 * endpoint via `__setOAuthFetchForTesting` so no network leaves the test.
 */
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, companies, createDb, socialAccounts, socialAppCredentials } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { socialRoutes, __testing_oauthStateStore } from "../routes/social.js";
import {
  __setOAuthFetchForTesting,
  encryptOAuthSecret,
} from "../services/social-scheduler/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbedded = embeddedPostgresSupport.supported ? describe : describe.skip;

function makeApp(db: ReturnType<typeof createDb>): Express {
  const app = express();
  app.use(express.json());
  // Minimal actor middleware — every test request acts as company member.
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "test-user",
      companyIds: ["*"],
      source: "session",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use(socialRoutes(db));
  return app;
}

describeEmbedded("social OAuth callback route", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-social-oauth-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    __setOAuthFetchForTesting(null);
    await db.delete(socialAccounts);
    await db.delete(socialAppCredentials);
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyWithCredentials() {
    const [company] = await db
      .insert(companies)
      .values({ name: `oauth-${randomUUID()}`, issuePrefix: `O${randomUUID().slice(0, 5).toUpperCase()}` })
      .returning();
    companyId = company!.id;
    await db.insert(socialAppCredentials).values({
      platform: "reddit",
      clientId: "test-client-id",
      clientSecretEncrypted: encryptOAuthSecret("test-client-secret"),
      clientSecretLast4: "cret",
      redirectUri: "https://paperclip.augiport.com/auth/social-callback/reddit",
    });
    return company!;
  }

  it("exchanges Reddit auth code for real tokens and persists them on social_accounts", async () => {
    await seedCompanyWithCredentials();
    const { rememberOAuthState } = __testing_oauthStateStore();
    const state = "test-state-1";
    rememberOAuthState(state, {
      companyId,
      platform: "reddit",
      redirectUri: "https://paperclip.augiport.com/auth/social-callback/reddit",
      createdAt: Date.now(),
    });

    // Mock the Reddit token endpoint + /me.
    __setOAuthFetchForTesting((async (input, _init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url === "https://www.reddit.com/api/v1/access_token") {
        return new Response(
          JSON.stringify({
            access_token: "live-reddit-token-XYZ",
            refresh_token: "live-reddit-refresh-XYZ",
            expires_in: 3600,
            scope: "identity submit read",
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "https://oauth.reddit.com/api/v1/me") {
        return new Response(
          JSON.stringify({ id: "redditor-1", name: "tyler_test" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "no_mock" }), { status: 500 });
    }) as typeof fetch);

    const app = makeApp(db);
    const res = await request(app)
      .get("/auth/social-callback/reddit")
      .query({ code: "auth-code-from-reddit", state });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Connected");
    expect(res.text).toContain("u/tyler_test");

    const accounts = await db.select().from(socialAccounts);
    expect(accounts).toHaveLength(1);
    const row = accounts[0]!;
    // Crucial: real tokens persisted, not legacy stubs.
    expect(row.accessToken).toBe("live-reddit-token-XYZ");
    expect(row.refreshToken).toBe("live-reddit-refresh-XYZ");
    expect(row.accessToken).not.toBe("stub_access_token");
    expect(row.platformAccountId).toBe("redditor-1");
    expect(row.username).toBe("u/tyler_test");
    expect(row.displayName).toBe("u/tyler_test");
    expect(row.tokenExpiresAt).toBeInstanceOf(Date);
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.connectMethod).toBe("wizard");
    expect(row.scopes).toEqual(["identity", "submit", "read"]);
  });

  it("returns a structured error when the platform rejects the code", async () => {
    await seedCompanyWithCredentials();
    const { rememberOAuthState } = __testing_oauthStateStore();
    const state = "test-state-2";
    rememberOAuthState(state, {
      companyId,
      platform: "reddit",
      redirectUri: "https://paperclip.augiport.com/auth/social-callback/reddit",
      createdAt: Date.now(),
    });

    __setOAuthFetchForTesting((async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Authorization code is invalid",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch);

    const app = makeApp(db);
    const res = await request(app)
      .get("/auth/social-callback/reddit")
      .query({ code: "bad-code", state });

    expect(res.status).toBe(400);
    expect(res.text).toContain("Token exchange failed");
    expect(res.text).toContain("Authorization code is invalid");
    // No account row should have been created.
    const accounts = await db.select().from(socialAccounts);
    expect(accounts).toHaveLength(0);
  });

  it("rejects when no app credentials saved for the platform", async () => {
    const [company] = await db
      .insert(companies)
      .values({ name: `oauth-${randomUUID()}`, issuePrefix: `V${randomUUID().slice(0, 5).toUpperCase()}` })
      .returning();
    companyId = company!.id;
    const { rememberOAuthState } = __testing_oauthStateStore();
    const state = "test-state-3";
    rememberOAuthState(state, {
      companyId,
      platform: "reddit",
      redirectUri: "https://paperclip.augiport.com/auth/social-callback/reddit",
      createdAt: Date.now(),
    });

    const app = makeApp(db);
    const res = await request(app)
      .get("/auth/social-callback/reddit")
      .query({ code: "any", state });

    expect(res.status).toBe(400);
    expect(res.text).toContain("Save reddit app credentials");
  });

  it("rejects when the OAuth state is missing or expired", async () => {
    await seedCompanyWithCredentials();
    const app = makeApp(db);
    const res = await request(app)
      .get("/auth/social-callback/reddit")
      .query({ code: "any", state: "never-registered" });

    expect(res.status).toBe(400);
    expect(res.text).toContain("state");
  });
});

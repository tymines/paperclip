import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentBridgeReplyAttempts,
  agents,
  bridgeHealth,
  companies,
  createDb,
  rooms,
  roomMessages,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentBridgeRoutes } from "../routes/agent-bridge.js";
import { errorHandler } from "../middleware/error-handler.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const BRIDGE_TOKEN = "test-bridge-token-roundtrip";

async function seedCompanyAgentRoom(db: ReturnType<typeof createDb>) {
  const [company] = await db
    .insert(companies)
    .values({
      name: `Bridge Roundtrip ${randomUUID()}`,
      issuePrefix: `BR${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({
      companyId: company!.id,
      name: "TestAugi",
      role: "engineering_lead",
      status: "active",
      agentBridge: {
        kind: "openclaw",
        gatewayUrl: "http://127.0.0.1:18790",
        authToken: BRIDGE_TOKEN,
        identityId: "test-augi",
      },
    })
    .returning();

  const [room] = await db
    .insert(rooms)
    .values({
      companyId: company!.id,
      name: "Roundtrip Test",
    })
    .returning();

  return { company: company!, agent: agent!, room: room! };
}

function buildApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  app.use("/api", agentBridgeRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("agent-bridge round-trip persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-bridge-roundtrip-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(agentBridgeReplyAttempts);
    await db.delete(roomMessages);
    await db.delete(rooms);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(bridgeHealth);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("persists a bridge reply end-to-end and records a 'persisted' attempt", async () => {
    const { agent, room } = await seedCompanyAgentRoom(db);
    const app = buildApp(db);
    const content = `bridge roundtrip ${randomUUID()}`;

    const response = await request(app)
      .post("/api/agent-bridge/reply")
      .set("Authorization", `Bearer ${BRIDGE_TOKEN}`)
      .send({ agentId: agent.id, roomId: room.id, content });

    expect(response.status).toBe(201);
    expect(response.body.content).toBe(content);

    const persisted = await db
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.roomId, room.id))
      .orderBy(desc(roomMessages.createdAt));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.senderId).toBe(agent.id);
    expect(persisted[0]!.senderType).toBe("agent");
    expect(persisted[0]!.content).toBe(content);

    const attempts = await db
      .select()
      .from(agentBridgeReplyAttempts)
      .where(
        and(
          eq(agentBridgeReplyAttempts.agentId, agent.id),
          eq(agentBridgeReplyAttempts.roomId, room.id),
        ),
      );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe("persisted");
  }, 20_000);

  it("rejects with 4xx and records a 'rejected' attempt when the bridge token is wrong", async () => {
    const { agent, room } = await seedCompanyAgentRoom(db);
    const app = buildApp(db);

    const response = await request(app)
      .post("/api/agent-bridge/reply")
      .set("Authorization", "Bearer wrong-token")
      .send({ agentId: agent.id, roomId: room.id, content: "should not land" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    const persisted = await db
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.roomId, room.id));
    expect(persisted).toHaveLength(0);

    const attempts = await db
      .select()
      .from(agentBridgeReplyAttempts)
      .where(eq(agentBridgeReplyAttempts.agentId, agent.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe("rejected");
    expect(attempts[0]!.errorDetail).toBe("bridge-token-mismatch");
  }, 20_000);

  it("health check writes and reads back a row with a matching checksum", async () => {
    const app = buildApp(db);
    const nonce = `hello-${randomUUID()}`;

    const response = await request(app)
      .post("/api/agent-bridge/health")
      .send({ token: "bridge-health-dev-token", testMessage: nonce });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.id).toBeTruthy();
    expect(response.body.testMessage).toBe(nonce);

    const rows = await db.select().from(bridgeHealth);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.testMessage).toBe(nonce);
  }, 20_000);

  it("rejects health pings with the wrong token", async () => {
    const app = buildApp(db);
    const response = await request(app)
      .post("/api/agent-bridge/health")
      .send({ token: "wrong", testMessage: "x" });
    expect(response.status).toBe(401);
  });

  it("bridge-attempts endpoint returns counts + flags 24h failures", async () => {
    const { company, agent, room } = await seedCompanyAgentRoom(db);
    const app = buildApp(db);

    // One success, one rejection.
    await request(app)
      .post("/api/agent-bridge/reply")
      .set("Authorization", `Bearer ${BRIDGE_TOKEN}`)
      .send({ agentId: agent.id, roomId: room.id, content: "first" });
    await request(app)
      .post("/api/agent-bridge/reply")
      .set("Authorization", "Bearer wrong-token")
      .send({ agentId: agent.id, roomId: room.id, content: "second" });

    const response = await request(app)
      .get(`/api/companies/${company.id}/agents/${agent.id}/bridge-attempts`);

    expect(response.status).toBe(200);
    expect(response.body.attempts.length).toBeGreaterThanOrEqual(2);
    expect(response.body.last24hCounts.persisted).toBeGreaterThanOrEqual(1);
    expect(response.body.last24hCounts.rejected).toBeGreaterThanOrEqual(1);
    expect(response.body.hasFailures24h).toBe(true);
  }, 30_000);
});

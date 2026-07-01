// Seeds the "Council" room with bridged Augi + Hermes agents for the
// agent-rooms-v1 smoke test. Idempotent — safe to re-run.
//
//   pnpm --filter @paperclipai/db exec tsx src/seed-agent-rooms.ts
//
// Picks the first company in the database. Pass --company-id <uuid> to target
// a specific company.
//
// Bridge auth tokens here must match `~/.openclaw/agent-rooms-v1/agents.json`
// on the OpenClaw side. The shared dev defaults are:
//   - Augi:   1f395f598aa066b3cf47fbf9d93ff630  (existing OpenClaw gateway token)
//   - Hermes: paperclip-bridge-hermes-dev-token-v1

import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  agents,
  companies,
  rooms,
  roomMembers,
} from "./schema/index.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);

const args = process.argv.slice(2);
let targetCompanyId: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--company-id" && args[i + 1]) {
    targetCompanyId = args[i + 1]!;
    i++;
  }
}

const company = targetCompanyId
  ? await db
      .select()
      .from(companies)
      .where(eq(companies.id, targetCompanyId))
      .then((rows) => rows[0] ?? null)
  : await db
      .select()
      .from(companies)
      .limit(1)
      .then((rows) => rows[0] ?? null);

if (!company) {
  console.error("No company found. Run the base seed first or pass --company-id.");
  process.exit(1);
}

console.log(`Seeding agent-rooms-v1 into company "${company.name}" (${company.id})`);

const bridgeGatewayUrl = process.env.AGENT_ROOMS_BRIDGE_URL ?? "http://127.0.0.1:18790";

const augiBridge = {
  kind: "openclaw",
  gatewayUrl: bridgeGatewayUrl,
  authToken:
    process.env.BRIDGE_AUGI_TOKEN ?? "1f395f598aa066b3cf47fbf9d93ff630",
  identityId: "augi",
  peerEndpoint: null, // v2: cross-machine peers
};

const hermesBridge = {
  kind: "openclaw",
  gatewayUrl: bridgeGatewayUrl,
  authToken:
    process.env.BRIDGE_HERMES_TOKEN ?? "paperclip-bridge-hermes-dev-token-v1",
  identityId: "hermes",
  peerEndpoint: null,
};

async function upsertBridgedAgent(input: {
  name: string;
  role: string;
  title: string;
  icon: string;
  bridge: typeof augiBridge;
}) {
  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.name, input.name))
    .then((rows) => rows.find((row) => row.companyId === company.id) ?? null);
  if (existing) {
    await db
      .update(agents)
      .set({ agentBridge: input.bridge, updatedAt: new Date() })
      .where(eq(agents.id, existing.id));
    console.log(`  updated agent ${input.name} (${existing.id})`);
    return existing.id;
  }
  const [created] = await db
    .insert(agents)
    .values({
      companyId: company.id,
      name: input.name,
      role: input.role,
      title: input.title,
      icon: input.icon,
      status: "idle",
      // adapterType stays "process" with a no-op command — adapter is unused
      // for bridged agents (their loop runs on the OpenClaw side).
      adapterType: "process",
      adapterConfig: { command: "echo", args: ["bridged"] },
      agentBridge: input.bridge,
      budgetMonthlyCents: 5000,
    })
    .returning();
  console.log(`  created agent ${input.name} (${created!.id})`);
  return created!.id;
}

const augiId = await upsertBridgedAgent({
  name: "Augi",
  role: "engineer",
  title: "Lead Engineer (bridged → OpenClaw)",
  icon: "wrench",
  bridge: augiBridge,
});

const hermesId = await upsertBridgedAgent({
  name: "Hermes",
  role: "general",
  title: "Comms / Strategy (bridged → OpenClaw)",
  icon: "feather",
  bridge: hermesBridge,
});

// Upsert the Council room.
let council = await db
  .select()
  .from(rooms)
  .where(eq(rooms.companyId, company.id))
  .then((rows) => rows.find((row) => row.name === "Council") ?? null);

if (!council) {
  [council] = await db
    .insert(rooms)
    .values({
      companyId: company.id,
      name: "Council",
      description:
        "Multi-agent council for cross-functional decisions. Bridged to OpenClaw — Augi and Hermes here run on their native runtimes.",
      type: "collaboration",
      status: "active",
    })
    .returning();
  console.log(`  created room Council (${council!.id})`);
} else {
  console.log(`  room Council exists (${council.id})`);
}

// Ensure both agents are members.
const memberRows = await db
  .select()
  .from(roomMembers)
  .where(eq(roomMembers.roomId, council!.id));
const memberAgentIds = new Set(memberRows.map((row) => row.agentId).filter(Boolean));

for (const agentId of [augiId, hermesId]) {
  if (memberAgentIds.has(agentId)) {
    console.log(`  member ${agentId} already in Council`);
    continue;
  }
  await db.insert(roomMembers).values({
    roomId: council!.id,
    agentId,
    role: "member",
  });
  console.log(`  added ${agentId} to Council`);
}

console.log("agent-rooms-v1 seed complete");
process.exit(0);

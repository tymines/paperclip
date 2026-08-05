import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { AcpAgentCapabilities, AcpFleetResult } from "../api/acp";
import { countOperationalHomeFleet, resolveHomeFleet } from "./Home";

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function definition(
  name: string,
  options: { id?: string; registered?: boolean; status?: string | null } = {},
): AcpAgentCapabilities {
  return {
    id: options.id ?? `canonical:${name.toLowerCase()}`,
    name,
    registered: options.registered ?? false,
    status: options.status ?? null,
    role: null,
    fleetRole: "Agent",
    pairing: null,
    title: null,
    hostedBy: null,
    hostKey: null,
    hostLabel: null,
    hostMachine: null,
    hostParent: null,
    framework: null,
    harness: null,
    relationship: null,
    surfaceLinks: [],
    workspace: null,
    runtime: null,
    model: null,
    modelInfo: null,
    modes: [],
    modeDefault: null,
    teamCapable: false,
    provenance: {},
  };
}

function canonicalFleet(agents: AcpAgentCapabilities[]): AcpFleetResult {
  return {
    ok: true,
    transport: "canonical-db",
    url: "",
    connectedAtMs: 0,
    handshakeMs: 0,
    server: { version: "canonical-roster", protocol: null, connId: null },
    methods: [],
    events: [],
    models: [],
    slashCommands: [],
    identity: { name: "Canonical Fleet", avatar: null },
    teamCapable: false,
    teamCapableReason: "Not evaluated",
    agents,
    agentCount: agents.length,
    rosterSource: "canonical",
    provenance: { agents: "derived" },
    notes: { real: [], derived: [], stub: [] },
  };
}

describe("Home canonical Fleet summary", () => {
  it("uses canonical Fleet positions and excludes preserved noncanonical records", () => {
    const zeus = makeAgent({ id: "db-zeus", name: "Zeus", status: "active" });
    const legacy = makeAgent({ id: "db-legacy", name: "Legacy Builder", status: "active" });
    const result = resolveHomeFleet(
      [legacy, zeus],
      canonicalFleet([
        definition("Zeus", { id: zeus.id, registered: true, status: "active" }),
        definition("Hermes", { id: "db-hermes", registered: true, status: "idle" }),
        definition("Calliope"),
      ]),
    );

    expect(result.canonical).toBe(true);
    expect(result.entries.map((entry) => entry.definition?.name)).toEqual(["Zeus", "Hermes", "Calliope"]);
    expect(result.entries.map((entry) => entry.agent?.name ?? null)).toEqual(["Zeus", null, null]);
    expect(countOperationalHomeFleet(result.entries)).toBe(1);
  });

  it("falls back honestly to registered agents when a canonical roster is unavailable", () => {
    const paused = makeAgent({ id: "paused", name: "Paused", status: "paused" });
    const active = makeAgent({ id: "active", name: "Active", status: "active" });
    const result = resolveHomeFleet([paused, active], undefined);

    expect(result.canonical).toBe(false);
    expect(result.entries.map((entry) => entry.agent?.name)).toEqual(["Active", "Paused"]);
    expect(countOperationalHomeFleet(result.entries)).toBe(1);
  });
});

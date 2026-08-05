import { describe, expect, it } from "vitest";
import { CANONICAL_FLEET_ROSTER } from "./canonical-fleet.js";
import { readGatewayFleet } from "./gateway-handshake.js";

const expectedNames = [
  "Zeus",
  "Athena",
  "Hermes",
  "Atlas",
  "Artemis",
  "Chronos",
  "Achlys",
  "Augi",
  "Ares",
  "Apollo",
  "Hephaestus",
  "Poseidon",
  "Hades",
  "Calliope",
  "Book Keeper",
  "August",
];

describe("canonical Fleet roster", () => {
  it("defines the exact ordered 2026-08-04-v2 names, groups, roles, pairings, models, and harnesses", () => {
    expect(CANONICAL_FLEET_ROSTER.map((position) => position.name)).toEqual(expectedNames);
    expect(CANONICAL_FLEET_ROSTER.map((position) => position.hostLabel)).toEqual([
      "WINDOWS — ZEUS", "WINDOWS — ZEUS",
      "BOX 1 — HERMES", "BOX 1 — HERMES", "BOX 1 — HERMES", "BOX 1 — HERMES", "BOX 1 — HERMES", "BOX 1 — HERMES",
      "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES", "BOX 2 — ARES",
    ]);

    const byName = new Map(CANONICAL_FLEET_ROSTER.map((position) => [position.name, position]));
    expect(byName.get("Zeus")?.model).toBe("SOL");
    expect(byName.get("Athena")?.model).toBe("Kimi K3");
    expect(byName.get("Hermes")?.model).toBe("SOL");
    expect(byName.get("Atlas")).toMatchObject({ fleetRole: "Builder", pairing: "Reviewed by Achlys", model: "SOL" });
    expect(byName.get("Artemis")).toMatchObject({ fleetRole: "Builder", pairing: "Reviewed by Chronos", model: "Kimi K3" });
    expect(byName.get("Chronos")).toMatchObject({ fleetRole: "Reviewer", pairing: "Reviews Artemis", model: "SOL" });
    expect(byName.get("Achlys")).toMatchObject({ fleetRole: "Reviewer", pairing: "Reviews Atlas", model: "Kimi K3" });
    expect(byName.get("Apollo")).toMatchObject({ fleetRole: "Builder", pairing: "Reviewed by Hades", model: "SOL" });
    expect(byName.get("Hephaestus")).toMatchObject({ fleetRole: "Builder", pairing: "Reviewed by Poseidon", model: "Kimi K3" });
    expect(byName.get("Poseidon")).toMatchObject({ fleetRole: "Reviewer", pairing: "Reviews Hephaestus", model: "SOL" });
    expect(byName.get("Hades")).toMatchObject({ fleetRole: "Reviewer", pairing: "Reviews Apollo", model: "Kimi K3" });
    expect(byName.get("Book Keeper")?.model).toBe("DeepSeek V4 Flash");
    expect(byName.get("Augi")?.model).toBeUndefined();
    expect(byName.get("Augi")).toMatchObject({ framework: "openclaw", harness: "OpenClaw" });
    expect(byName.get("August")?.model).toBeUndefined();
    expect(byName.get("August")).toMatchObject({ framework: "openclaw", harness: "OpenClaw" });
    expect(byName.get("Calliope")?.surfaceLinks).toEqual([
      { label: "Book Writing", href: "/book-writing" },
      { label: "AI Influencer Studio", href: "/image-studio" },
    ]);
  });

  it("reconciles matches by normalized name, retains paused rows, and marks missing definitions", async () => {
    const result = await readGatewayFleet({
      skipGateway: true,
      roster: [
        { id: "db-zeus", name: "  ZEUS ", role: "ceo", title: "Chief agent", status: "error" },
        { id: "db-zeus-collision", name: "Zeus", role: "duplicate", title: "Later collision", status: "active" },
        { id: "db-athena", name: "Athena", role: "engineer", title: "Registered Athena", status: "paused" },
        { id: "db-other", name: "Baily AI", role: "service", title: "Preserved elsewhere", status: "active" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.agents.map((agent) => agent.name)).toEqual([
      "  ZEUS ",
      "Athena",
      ...expectedNames.slice(2),
    ]);
    expect(result.agents).toHaveLength(16);
    expect(result.agents[0]).toMatchObject({ id: "db-zeus", registered: true, role: "ceo", title: "Chief agent", status: "error", model: "SOL" });
    expect(result.agents[1]).toMatchObject({ id: "db-athena", registered: true, status: "paused", model: "Kimi K3" });
    expect(result.agents.find((agent) => agent.name === "Atlas")).toMatchObject({ fleetRole: "Builder", pairing: "Reviewed by Achlys", model: "SOL" });
    expect(result.agents.find((agent) => agent.name === "Calliope")).toMatchObject({
      id: "canonical:calliope",
      registered: false,
      status: null,
      model: "SOL",
      relationship: "Baily's agent",
    });
    expect(result.agents.some((agent) => agent.name === "Baily AI")).toBe(false);
  });
});

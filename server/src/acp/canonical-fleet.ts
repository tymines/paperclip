/**
 * Tyler's canonical Fleet lineup, version 2026-08-04-v2.
 *
 * This ordered roster is presentation configuration only. It is reconciled to
 * registered Paperclip agents by normalized display name and never mutates the
 * agent registry.
 */

export interface CanonicalSurfaceLink {
  label: string;
  href: string;
}

export interface CanonicalFleetPosition {
  name: string;
  hostKey: "windows" | "box1" | "box2";
  hostLabel: "WINDOWS — ZEUS" | "BOX 1 — HERMES" | "BOX 2 — ARES";
  hostMachine: string;
  parent: string | null;
  fleetRole: string;
  pairing?: string;
  model?: "SOL" | "Kimi K3" | "DeepSeek V4 Flash";
  framework?: "openclaw";
  harness?: "OpenClaw";
  relationship?: string;
  surfaceLinks?: CanonicalSurfaceLink[];
}

/** Normalize an agent display name to a stable lookup key. */
export function fleetKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export const CANONICAL_FLEET_ROSTER: readonly CanonicalFleetPosition[] = [
  { name: "Zeus", hostKey: "windows", hostLabel: "WINDOWS — ZEUS", hostMachine: "WindowsAugi", parent: null, fleetRole: "Chief / senior reviewer", model: "SOL" },
  { name: "Athena", hostKey: "windows", hostLabel: "WINDOWS — ZEUS", hostMachine: "WindowsAugi", parent: "Zeus", fleetRole: "Agent", model: "Kimi K3" },

  { name: "Hermes", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Zeus", fleetRole: "Boss / coordinator", model: "SOL" },
  { name: "Atlas", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Hermes", fleetRole: "Builder", pairing: "Reviewed by Achlys", model: "SOL" },
  { name: "Artemis", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Hermes", fleetRole: "Builder", pairing: "Reviewed by Chronos", model: "Kimi K3" },
  { name: "Chronos", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Hermes", fleetRole: "Reviewer", pairing: "Reviews Artemis", model: "SOL" },
  { name: "Achlys", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Hermes", fleetRole: "Reviewer", pairing: "Reviews Atlas", model: "Kimi K3" },
  { name: "Augi", hostKey: "box1", hostLabel: "BOX 1 — HERMES", hostMachine: "AugiAIs-Mini", parent: "Hermes", fleetRole: "OpenClaw agent", framework: "openclaw", harness: "OpenClaw" },

  { name: "Ares", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Zeus", fleetRole: "Boss / coordinator", model: "Kimi K3" },
  { name: "Apollo", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "Builder", pairing: "Reviewed by Hades", model: "SOL" },
  { name: "Hephaestus", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "Builder", pairing: "Reviewed by Poseidon", model: "Kimi K3" },
  { name: "Poseidon", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "Reviewer", pairing: "Reviews Hephaestus", model: "SOL" },
  { name: "Hades", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "Reviewer", pairing: "Reviews Apollo", model: "Kimi K3" },
  {
    name: "Calliope",
    hostKey: "box2",
    hostLabel: "BOX 2 — ARES",
    hostMachine: "AugiBot2s-Mini",
    parent: "Ares",
    fleetRole: "Baily's agent",
    model: "SOL",
    relationship: "Baily's agent",
    surfaceLinks: [
      { label: "Book Writing", href: "/book-writing" },
      { label: "AI Influencer Studio", href: "/image-studio" },
    ],
  },
  { name: "Book Keeper", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "Book Keeper", model: "DeepSeek V4 Flash" },
  { name: "August", hostKey: "box2", hostLabel: "BOX 2 — ARES", hostMachine: "AugiBot2s-Mini", parent: "Ares", fleetRole: "OpenClaw agent", framework: "openclaw", harness: "OpenClaw" },
] as const;

export function canonicalPositionFor(name: string): CanonicalFleetPosition | undefined {
  const key = fleetKey(name);
  return CANONICAL_FLEET_ROSTER.find((position) => fleetKey(position.name) === key);
}

/** Compatibility lookup for gateway-capability code; membership never depends on this map. */
export interface CanonicalModel {
  model: string;
  catalogMatch: string | null;
  source: string;
}

export const CANONICAL_FLEET_MODELS: Record<string, CanonicalModel> = Object.fromEntries(
  CANONICAL_FLEET_ROSTER
    .filter((position): position is CanonicalFleetPosition & { model: NonNullable<CanonicalFleetPosition["model"]> } => Boolean(position.model))
    .map((position) => [
      fleetKey(position.name),
      {
        model: position.model,
        catalogMatch: null,
        source: `Tyler Fleet lineup ${position.name} model, 2026-08-04-v2`,
      },
    ]),
);

export function canonicalModelFor(name: string): CanonicalModel | undefined {
  return CANONICAL_FLEET_MODELS[fleetKey(name)];
}

export interface HostEntry {
  machine: string;
  platform: string;
  parent: string;
}

export const CANONICAL_HOST_MAP: Record<string, HostEntry> = Object.fromEntries(
  CANONICAL_FLEET_ROSTER.map((position) => [
    fleetKey(position.name),
    {
      machine: position.hostMachine,
      platform: position.hostKey === "windows" ? "Windows" : "Mac",
      parent: position.parent ?? position.name,
    },
  ]),
);

export function hostFor(name: string): HostEntry | undefined {
  return CANONICAL_HOST_MAP[fleetKey(name)];
}

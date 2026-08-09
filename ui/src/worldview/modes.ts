import type { LayerId } from "./layerRegistry";

export type ModeId = "pulse" | "storms" | "space";

export interface ModeDefinition {
  id: ModeId;
  label: string;
  personality: string;
  layers: readonly LayerId[];
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
}

export const MODES: Record<ModeId, ModeDefinition> = {
  pulse: {
    id: "pulse",
    label: "World Pulse",
    personality: "The world, breathing now",
    layers: ["flights", "seismic", "fires", "terminator"],
    camera: { center: [10, 22], zoom: 1.55, pitch: 0, bearing: 0 },
  },
  storms: {
    id: "storms",
    label: "Storms",
    personality: "Active weather and fire complexes",
    layers: ["weather", "fires", "terminator"],
    camera: { center: [-32, 18], zoom: 1.8, pitch: 18, bearing: -8 },
  },
  space: {
    id: "space",
    label: "Space",
    personality: "Near-Earth orbit, quiet and vast",
    layers: ["satellites", "terminator"],
    camera: { center: [25, 12], zoom: 1.15, pitch: 0, bearing: 0 },
  },
};

export function layersForMode(mode: ModeId): Set<LayerId> {
  return new Set(MODES[mode].layers);
}

export function modeIsCustomized(mode: ModeId, enabled: ReadonlySet<LayerId>): boolean {
  const curated = MODES[mode].layers;
  return enabled.size !== curated.length || curated.some((id) => !enabled.has(id));
}

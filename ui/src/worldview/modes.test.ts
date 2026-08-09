import { describe, expect, it } from "vitest";
import { MODES, layersForMode, modeIsCustomized } from "./modes";

describe("Quiet Globe modes", () => {
  it("ships only the three Wave 1/2 scenes", () => {
    expect(Object.keys(MODES)).toEqual(["pulse", "storms", "space"]);
  });

  it("uses the six signature layers and keeps the terminator in every scene", () => {
    expect(layersForMode("pulse")).toEqual(new Set(["flights", "seismic", "fires", "terminator"]));
    expect(layersForMode("storms")).toEqual(new Set(["weather", "fires", "terminator"]));
    expect(layersForMode("space")).toEqual(new Set(["satellites", "terminator"]));
  });

  it("marks additive manual changes and recognizes a reset", () => {
    expect(modeIsCustomized("space", new Set(["satellites", "terminator", "seismic"]))).toBe(true);
    expect(modeIsCustomized("space", layersForMode("space"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { hasTrainingPhotos } from "./training.js";

describe("hasTrainingPhotos", () => {
  it("rejects empty and invalid counts", () => {
    expect(hasTrainingPhotos(0)).toBe(false);
    expect(hasTrainingPhotos(-1)).toBe(false);
    expect(hasTrainingPhotos(1.5)).toBe(false);
    expect(hasTrainingPhotos(Number.NaN)).toBe(false);
  });

  it("accepts one or more photos", () => {
    expect(hasTrainingPhotos(1)).toBe(true);
    expect(hasTrainingPhotos(50)).toBe(true);
  });
});

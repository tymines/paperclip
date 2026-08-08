import { describe, expect, it } from "vitest";
import { decodeGalleryCursor, encodeGalleryCursor } from "./gallery-pagination.js";

describe("gallery pagination cursor", () => {
  it("round-trips a timestamp and UUID", () => {
    const value = {
      createdAt: new Date("2026-08-08T12:34:56.789Z"),
      id: "11111111-1111-4111-8111-111111111111",
    };

    expect(decodeGalleryCursor(encodeGalleryCursor(value))).toEqual(value);
  });

  it.each([
    "not-base64-json",
    Buffer.from(JSON.stringify({ createdAt: "bad", id: "also-bad" })).toString("base64url"),
    Buffer.from(JSON.stringify({ createdAt: "2026-08-08T12:34:56.789Z" })).toString("base64url"),
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => decodeGalleryCursor(cursor)).toThrow("Invalid gallery cursor");
  });
});

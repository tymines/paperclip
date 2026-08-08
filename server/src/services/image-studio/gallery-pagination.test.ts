import { describe, expect, it } from "vitest";
import { decodeGalleryCursor, encodeGalleryCursor } from "./gallery-pagination.js";

describe("gallery pagination cursor", () => {
  it("round-trips exact PostgreSQL microseconds and a UUID", () => {
    const value = {
      createdAtMicros: "1786192496789123",
      id: "11111111-1111-4111-8111-111111111111",
    };

    expect(decodeGalleryCursor(encodeGalleryCursor(value))).toEqual(value);
  });

  it.each([
    "not-base64-json",
    Buffer.from(JSON.stringify({ createdAtMicros: "bad", id: "also-bad" })).toString("base64url"),
    Buffer.from(JSON.stringify({ createdAtMicros: "1786192496789123" })).toString("base64url"),
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => decodeGalleryCursor(cursor)).toThrow("Invalid gallery cursor");
  });
});

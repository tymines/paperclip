import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTIFIERS } from "./brand.js";

describe("PRODUCT_IDENTIFIERS", () => {
  it("defines the canonical Olympus identifiers", () => {
    expect(PRODUCT_IDENTIFIERS.canonical).toEqual({
      displayName: "Olympus",
      slug: "olympus",
      cli: "olympus",
      environmentPrefix: "OLYMPUS_",
      mcpServerKey: "olympus",
    });
  });

  it("defines the Paperclip compatibility identifiers", () => {
    expect(PRODUCT_IDENTIFIERS.compatibility).toEqual({
      displayName: "Paperclip",
      slug: "paperclip",
      cli: "paperclipai",
      environmentPrefix: "PAPERCLIP_",
      mcpServerKey: "paperclip",
    });
  });
});

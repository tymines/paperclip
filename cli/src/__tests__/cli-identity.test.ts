import { afterEach, describe, expect, it } from "vitest";
import { PRODUCT_IDENTIFIERS } from "@paperclipai/shared/brand";
import {
  getCliIdentity,
  getCliProductIdentifiers,
  selectCliIdentity,
} from "../cli-identity.js";
import { buildCliCommandLabel } from "../client/command-label.js";

const originalArgs = process.argv.slice(2);

afterEach(() => {
  selectCliIdentity("compatibility");
  process.argv.splice(2, process.argv.length, ...originalArgs);
});

describe("CLI identity", () => {
  it("uses the compatibility identity by default", () => {
    expect(getCliIdentity()).toBe("compatibility");
    expect(getCliProductIdentifiers()).toBe(PRODUCT_IDENTIFIERS.compatibility);
  });

  it("selects the canonical identity in process", () => {
    selectCliIdentity("canonical");

    expect(getCliIdentity()).toBe("canonical");
    expect(getCliProductIdentifiers()).toBe(PRODUCT_IDENTIFIERS.canonical);
  });

  it("builds command labels from the active CLI identity", () => {
    process.argv.splice(2, process.argv.length, "company", "list");
    expect(buildCliCommandLabel()).toBe("paperclipai company list");

    selectCliIdentity("canonical");
    expect(buildCliCommandLabel()).toBe("olympus company list");
  });
});

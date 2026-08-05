import { describe, expect, it, vi } from "vitest";
import { createBrandEnvReader, type BrandEnvironment } from "./env-compat.js";

const parseEnabled = (value: string): boolean | undefined => {
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  return undefined;
};

function createFixtureReader(
  getEnv: () => BrandEnvironment,
  warn = vi.fn<(message: string) => void>(),
) {
  return {
    read: createBrandEnvReader({ getEnv, warn }),
    warn,
  };
}

function readTelemetryDisabled(
  read: ReturnType<typeof createBrandEnvReader>,
): boolean | undefined {
  return read({
    suffix: "TELEMETRY_DISABLED",
    parseOlympus: parseEnabled,
    parsePaperclip: parseEnabled,
  });
}

describe("createBrandEnvReader", () => {
  it("reads an Olympus-only value", () => {
    const { read } = createFixtureReader(() => ({ OLYMPUS_TELEMETRY_DISABLED: "enabled" }));

    expect(readTelemetryDisabled(read)).toBe(true);
  });

  it("falls back to a Paperclip-only value", () => {
    const { read } = createFixtureReader(() => ({ PAPERCLIP_TELEMETRY_DISABLED: "disabled" }));

    expect(readTelemetryDisabled(read)).toBe(false);
  });

  it("does not warn for equal values", () => {
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "enabled",
      PAPERCLIP_TELEMETRY_DISABLED: "enabled",
    }));

    expect(readTelemetryDisabled(read)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("prefers a valid Olympus value and warns for differing nonempty values", () => {
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "enabled",
      PAPERCLIP_TELEMETRY_DISABLED: "disabled",
    }));

    expect(readTelemetryDisabled(read)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("treats whitespace-only Olympus values as absent", () => {
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "  \t ",
      PAPERCLIP_TELEMETRY_DISABLED: "enabled",
    }));

    expect(readTelemetryDisabled(read)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back when the Olympus parser rejects a nonempty value", () => {
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "invalid-olympus",
      PAPERCLIP_TELEMETRY_DISABLED: "enabled",
    }));

    expect(readTelemetryDisabled(read)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns undefined when both parsers reject their values", () => {
    const { read } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "invalid-olympus",
      PAPERCLIP_TELEMETRY_DISABLED: "invalid-paperclip",
    }));

    expect(readTelemetryDisabled(read)).toBeUndefined();
  });

  it("warns only once per suffix for each reader instance", () => {
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: "enabled",
      PAPERCLIP_TELEMETRY_DISABLED: "disabled",
      OLYMPUS_TELEMETRY_ENDPOINT: "enabled",
      PAPERCLIP_TELEMETRY_ENDPOINT: "disabled",
    }));

    readTelemetryDisabled(read);
    readTelemetryDisabled(read);
    read({
      suffix: "TELEMETRY_ENDPOINT",
      parseOlympus: parseEnabled,
      parsePaperclip: parseEnabled,
    });

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not leak either conflicting value in warnings", () => {
    const olympusValue = "olympus-private-value";
    const paperclipValue = "paperclip-private-value";
    const { read, warn } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED: olympusValue,
      PAPERCLIP_TELEMETRY_DISABLED: paperclipValue,
    }));

    read({
      suffix: "TELEMETRY_DISABLED",
      parseOlympus: () => true,
      parsePaperclip: () => false,
    });

    const warning = warn.mock.calls[0]?.[0];
    expect(warning).toContain("OLYMPUS_TELEMETRY_DISABLED");
    expect(warning).toContain("PAPERCLIP_TELEMETRY_DISABLED");
    expect(warning).not.toContain(olympusValue);
    expect(warning).not.toContain(paperclipValue);
  });

  it("isolates warning deduplication between fresh readers", () => {
    const env = {
      OLYMPUS_TELEMETRY_DISABLED: "enabled",
      PAPERCLIP_TELEMETRY_DISABLED: "disabled",
    };
    const first = createFixtureReader(() => env);
    const second = createFixtureReader(() => env);

    readTelemetryDisabled(first.read);
    readTelemetryDisabled(second.read);

    expect(first.warn).toHaveBeenCalledOnce();
    expect(second.warn).toHaveBeenCalledOnce();
  });

  it("reads the supplied environment at call time", () => {
    let env: BrandEnvironment = { PAPERCLIP_TELEMETRY_DISABLED: "disabled" };
    const { read } = createFixtureReader(() => env);

    expect(readTelemetryDisabled(read)).toBe(false);
    env = { OLYMPUS_TELEMETRY_DISABLED: "enabled" };
    expect(readTelemetryDisabled(read)).toBe(true);
  });

  it("does not mutate the supplied environment", () => {
    const env = Object.freeze({ PAPERCLIP_TELEMETRY_DISABLED: "enabled" });
    const before = { ...env };
    const { read } = createFixtureReader(() => env);

    readTelemetryDisabled(read);

    expect(env).toEqual(before);
    expect(Object.keys(env)).toEqual(["PAPERCLIP_TELEMETRY_DISABLED"]);
  });

  it("constructs only the exact prefixed keys for the supplied suffix", () => {
    const { read } = createFixtureReader(() => ({
      OLYMPUS_TELEMETRY_DISABLED_EXTRA: "enabled",
      PAPERCLIP_TELEMETRY_DISABLED_EXTRA: "enabled",
      TELEMETRY_DISABLED: "enabled",
    }));

    expect(readTelemetryDisabled(read)).toBeUndefined();
  });
});

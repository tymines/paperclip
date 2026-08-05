import { describe, expect, it, vi } from "vitest";
import {
  createBrandEnvReader,
  type BrandEnvironment,
} from "../env-compat.js";
import {
  resolveTelemetryConfig,
  type TelemetryConfigRuntime,
} from "./config.js";

function createRuntime(
  initialEnv: BrandEnvironment,
  warn = vi.fn<(message: string) => void>(),
): { runtime: TelemetryConfigRuntime; setEnv: (env: BrandEnvironment) => void; warn: typeof warn } {
  let env = initialEnv;
  const getEnv = () => env;
  return {
    runtime: {
      getEnv,
      readBrandEnv: createBrandEnvReader({ getEnv, warn }),
    },
    setEnv: (nextEnv) => {
      env = nextEnv;
    },
    warn,
  };
}

describe("resolveTelemetryConfig", () => {
  it.each([
    ["1", false],
    ["0", true],
  ])("applies exact Olympus disabled value %s", (value, enabled) => {
    const { runtime } = createRuntime({ OLYMPUS_TELEMETRY_DISABLED: value });

    expect(resolveTelemetryConfig(undefined, runtime).enabled).toBe(enabled);
  });

  it.each([
    ["1", false],
    ["0", true],
    ["true", true],
    ["yes", true],
  ])("preserves Paperclip exact-1 disabled semantics for %s", (value, enabled) => {
    const { runtime } = createRuntime({ PAPERCLIP_TELEMETRY_DISABLED: value });

    expect(resolveTelemetryConfig(undefined, runtime).enabled).toBe(enabled);
  });

  it("falls back to Paperclip when the Olympus disabled value is invalid", () => {
    const { runtime } = createRuntime({
      OLYMPUS_TELEMETRY_DISABLED: "true",
      PAPERCLIP_TELEMETRY_DISABLED: "1",
    });

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: false });
  });

  it("lets a valid Olympus disabled value win over Paperclip", () => {
    const { runtime } = createRuntime({
      OLYMPUS_TELEMETRY_DISABLED: "0",
      PAPERCLIP_TELEMETRY_DISABLED: "1",
    });

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: true, endpoint: undefined });
  });

  it("accepts an absolute HTTP(S) Olympus endpoint", () => {
    const endpoint = "https://olympus.example.test/ingest";
    const { runtime } = createRuntime({ OLYMPUS_TELEMETRY_ENDPOINT: endpoint });

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: true, endpoint });
  });

  it.each(["/relative", "ftp://olympus.example.test/ingest", "not-a-url"])(
    "rejects invalid Olympus endpoint %s and falls back to Paperclip",
    (olympusEndpoint) => {
      const paperclipEndpoint = "legacy-relative-endpoint";
      const { runtime } = createRuntime({
        OLYMPUS_TELEMETRY_ENDPOINT: olympusEndpoint,
        PAPERCLIP_TELEMETRY_ENDPOINT: paperclipEndpoint,
      });

      expect(resolveTelemetryConfig(undefined, runtime)).toEqual({
        enabled: true,
        endpoint: paperclipEndpoint,
      });
    },
  );

  it("preserves the legacy endpoint's nonempty-string behavior", () => {
    const endpoint = "legacy-relative-endpoint";
    const { runtime } = createRuntime({ PAPERCLIP_TELEMETRY_ENDPOINT: endpoint });

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: true, endpoint });
  });

  it("treats whitespace-only endpoints as absent", () => {
    const { runtime } = createRuntime({
      OLYMPUS_TELEMETRY_ENDPOINT: "  ",
      PAPERCLIP_TELEMETRY_ENDPOINT: "\t",
    });

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: true, endpoint: undefined });
  });

  it.each([
    ["DO_NOT_TRACK", "1"],
    ["CI", "1"],
    ["GITHUB_ACTIONS", "true"],
  ])("keeps %s ahead of file configuration and endpoint selection", (key, value) => {
    const { runtime } = createRuntime({
      [key]: value,
      OLYMPUS_TELEMETRY_ENDPOINT: "https://olympus.example.test/ingest",
    });

    expect(resolveTelemetryConfig({ enabled: true }, runtime)).toEqual({ enabled: false });
  });

  it("keeps file configuration disabling ahead of endpoint selection", () => {
    const { runtime } = createRuntime({
      OLYMPUS_TELEMETRY_ENDPOINT: "https://olympus.example.test/ingest",
    });

    expect(resolveTelemetryConfig({ enabled: false }, runtime)).toEqual({ enabled: false });
  });

  it("is enabled by default", () => {
    const { runtime } = createRuntime({});

    expect(resolveTelemetryConfig(undefined, runtime)).toEqual({ enabled: true, endpoint: undefined });
  });

  it("reads environment changes at each resolution", () => {
    const fixture = createRuntime({ OLYMPUS_TELEMETRY_DISABLED: "0" });

    expect(resolveTelemetryConfig(undefined, fixture.runtime).enabled).toBe(true);
    fixture.setEnv({ OLYMPUS_TELEMETRY_DISABLED: "1" });
    expect(resolveTelemetryConfig(undefined, fixture.runtime).enabled).toBe(false);
  });

  it("warns once for conflicts without exposing values", () => {
    const olympusEndpoint = "https://olympus-private.example.test/ingest";
    const paperclipEndpoint = "paperclip-private-endpoint";
    const { runtime, warn } = createRuntime({
      OLYMPUS_TELEMETRY_ENDPOINT: olympusEndpoint,
      PAPERCLIP_TELEMETRY_ENDPOINT: paperclipEndpoint,
    });

    resolveTelemetryConfig(undefined, runtime);
    resolveTelemetryConfig(undefined, runtime);

    expect(warn).toHaveBeenCalledOnce();
    const warning = warn.mock.calls[0]?.[0];
    expect(warning).not.toContain(olympusEndpoint);
    expect(warning).not.toContain(paperclipEndpoint);
  });
});

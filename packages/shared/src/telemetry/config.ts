import type { TelemetryConfig } from "./types.js";
import {
  createBrandEnvReader,
  type BrandEnvironment,
  type BrandEnvReader,
} from "../env-compat.js";

const CI_ENV_VARS = ["CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI"];

export interface TelemetryConfigRuntime {
  getEnv: () => BrandEnvironment;
  readBrandEnv: BrandEnvReader;
}

const getProcessEnv = (): BrandEnvironment => process.env;
const productionBrandEnvReader = createBrandEnvReader({ getEnv: getProcessEnv });
const productionRuntime: TelemetryConfigRuntime = {
  getEnv: getProcessEnv,
  readBrandEnv: productionBrandEnvReader,
};

function isCI(env: BrandEnvironment): boolean {
  return CI_ENV_VARS.some((key) => env[key] === "true" || env[key] === "1");
}

function parseOlympusDisabled(value: string): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function parsePaperclipDisabled(value: string): boolean {
  return value === "1";
}

function parseOlympusEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function parsePaperclipEndpoint(value: string): string {
  return value;
}

export function resolveTelemetryConfig(
  fileConfig?: { enabled?: boolean },
  runtime: TelemetryConfigRuntime = productionRuntime,
): TelemetryConfig {
  const disabled = runtime.readBrandEnv({
    suffix: "TELEMETRY_DISABLED",
    parseOlympus: parseOlympusDisabled,
    parsePaperclip: parsePaperclipDisabled,
  });
  if (disabled === true) {
    return { enabled: false };
  }
  const env = runtime.getEnv();
  if (env.DO_NOT_TRACK === "1") {
    return { enabled: false };
  }
  if (isCI(env)) {
    return { enabled: false };
  }
  if (fileConfig?.enabled === false) {
    return { enabled: false };
  }

  const endpoint = runtime.readBrandEnv({
    suffix: "TELEMETRY_ENDPOINT",
    parseOlympus: parseOlympusEndpoint,
    parsePaperclip: parsePaperclipEndpoint,
  });
  return { enabled: true, endpoint };
}

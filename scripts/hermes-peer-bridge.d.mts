import type { Server } from "node:http";

export interface BridgeConfig {
  PORT: number;
  HOST: string;
  TOKEN: string;
  HERMES_BIN: string;
  HERMES_VENV: string;
  TURN_TIMEOUT_MS: number;
  MAX_CONCURRENT: number;
  MAX_OUTPUT_BYTES: number;
  CALLBACK_TIMEOUT_MS: number;
}

export interface BridgeHandle {
  server: Server;
  config: BridgeConfig;
  peers: Record<string, string>;
}

export function loadConfig(env?: NodeJS.ProcessEnv): BridgeConfig;
export function createBridge(overrides?: Partial<BridgeConfig>): BridgeHandle;

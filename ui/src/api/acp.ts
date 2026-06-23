/**
 * ACP (Agent Client Protocol) handshake API — POC, read-only.
 * Fetches an agent's self-described capability bag from the ACP route.
 */
import { api } from "./client";

export type AcpProvenance = "real" | "derived" | "stub";

export interface AcpModel {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface AcpSlashCommand {
  name: string;
  description?: string;
  category?: string;
  aliases?: string[];
  acceptsArgs?: boolean;
}

export interface AcpMode {
  id: string;
  label: string;
}

export interface AcpRosterEntry {
  id: string;
  name: string;
  model?: string;
  runtime?: string;
}

export interface AcpHandshake {
  ok: true;
  agentLabel: string;
  gatewayAgentId: string;
  transport: string;
  url: string;
  connectedAtMs: number;
  handshakeMs: number;
  server: { version: string | null; protocol: number | null; connId: string | null };
  methods: string[];
  events: string[];
  models: AcpModel[];
  slashCommands: AcpSlashCommand[];
  modes: AcpMode[];
  modeDefault: string | null;
  roster: AcpRosterEntry[];
  identity: { name: string | null; avatar: string | null };
  teamCapable: boolean;
  teamCapableReason: string;
  provenance: Record<string, AcpProvenance>;
}

export interface AcpHandshakeError {
  ok: false;
  agentLabel: string;
  url: string;
  error: string;
  stage: string;
}

export type AcpHandshakeResult = AcpHandshake | AcpHandshakeError;

export const acpApi = {
  handshake: (params?: { agentId?: string; label?: string; url?: string }) => {
    const q = new URLSearchParams();
    if (params?.agentId) q.set("agentId", params.agentId);
    if (params?.label) q.set("label", params.label);
    if (params?.url) q.set("url", params.url);
    const qs = q.toString();
    return api.get<AcpHandshakeResult>(`/acp/handshake${qs ? `?${qs}` : ""}`);
  },
};

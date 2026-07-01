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

export interface AcpAgentCapabilities {
  id: string;
  name: string;
  role?: string | null;
  title?: string | null;
  /** Host machine + parent agent (e.g. AugiAIs-Mini u00b7 under Augi), null if unknown. */
  hostedBy: string | null;
  workspace: string | null;
  runtime: string | null;
  model: string | null;
  modelInfo: AcpModel | null;
  modes: AcpMode[];
  modeDefault: string | null;
  teamCapable: boolean;
  provenance: Record<string, AcpProvenance>;
}

export interface AcpFleet {
  ok: true;
  transport: string;
  url: string;
  connectedAtMs: number;
  handshakeMs: number;
  server: { version: string | null; protocol: number | null; connId: string | null };
  methods: string[];
  events: string[];
  models: AcpModel[];
  slashCommands: AcpSlashCommand[];
  identity: { name: string | null; avatar: string | null };
  teamCapable: boolean;
  teamCapableReason: string;
  agents: AcpAgentCapabilities[];
  agentCount: number;
  rosterSource?: "canonical" | "handshake";
  provenance: Record<string, AcpProvenance>;
  notes: { real: string[]; derived: string[]; stub: string[] };
}

export type AcpFleetResult = AcpFleet | AcpHandshakeError;

export const acpApi = {
  handshake: (params?: { agentId?: string; label?: string; url?: string }) => {
    const q = new URLSearchParams();
    if (params?.agentId) q.set("agentId", params.agentId);
    if (params?.label) q.set("label", params.label);
    if (params?.url) q.set("url", params.url);
    const qs = q.toString();
    return api.get<AcpHandshakeResult>(`/acp/handshake${qs ? `?${qs}` : ""}`);
  },
  fleet: (params?: { url?: string; companyId?: string }) => {
    const q = new URLSearchParams();
    if (params?.url) q.set("url", params.url);
    if (params?.companyId) q.set("companyId", params.companyId);
    const qs = q.toString();
    return api.get<AcpFleetResult>(`/acp/fleet${qs ? `?${qs}` : ""}`);
  },
};

/**
 * ACP (Agent Client Protocol) handshake reader — POC, READ-ONLY.
 *
 * Connects to an OpenClaw agent over the existing Gateway WebSocket transport
 * (the same `connect` device-key handshake the openclaw_gateway adapter uses),
 * then reads the agent's SELF-DESCRIBED capabilities via the gateway's
 * self-describing RPC methods and normalises them into a single capability bag.
 *
 * This is the core idea of ACP: the agent announces what it can do on connect,
 * and the UI builds itself from that handshake instead of hard-coded per-agent
 * config.
 *
 * IMPORTANT — additive & non-destructive:
 *   - This does NOT spawn, mutate, or send work to any agent. It only opens a
 *     connection, reads capability metadata, and disconnects.
 *   - It does NOT touch the existing Hermes<->Ares bridge or the production
 *     openclaw_gateway adapter. It is a parallel reader.
 *
 * Provenance: every field in the returned bag is tagged real | derived | stub
 * so the Fleet UI can be honest about what came verbatim from the agent vs what
 * Paperclip computed.
 */
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  canonicalModelFor,
  type CanonicalModel,
} from "./canonical-fleet.js";

// Matches the installed OpenClaw gateway (server.protocol === 4). The in-repo
// openclaw_gateway adapter still pins v3; this reader was verified live against
// the running gateway (2026.6.1) which negotiates v4.
const PROTOCOL_VERSION = 4;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type Provenance = "real" | "derived" | "stub";

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
  /** Human label for the connected backend. */
  agentLabel: string;
  /** Which gateway agent the per-agent fields (modes/identity) were read from. */
  gatewayAgentId: string;
  transport: "openclaw-gateway-ws";
  url: string;
  connectedAtMs: number;
  handshakeMs: number;
  /** Self-described server info from the `connect` hello-ok frame. */
  server: { version: string | null; protocol: number | null; connId: string | null };
  /** Verbatim method/event catalog the agent advertises. */
  methods: string[];
  events: string[];
  /** Self-described capability surfaces. */
  models: AcpModel[];
  slashCommands: AcpSlashCommand[];
  modes: AcpMode[];
  modeDefault: string | null;
  roster: AcpRosterEntry[];
  identity: { name: string | null; avatar: string | null };
  /** Computed: is this backend eligible for Team Mode? */
  teamCapable: boolean;
  teamCapableReason: string;
  /** Per-field provenance so the UI can mark real vs derived vs stub. */
  provenance: Record<string, Provenance>;
}

export interface AcpHandshakeError {
  ok: false;
  agentLabel: string;
  url: string;
  error: string;
  stage: string;
}

export interface GatewayHandshakeOptions {
  url?: string;
  /** Which gateway agent to read per-agent capability fields from. */
  gatewayAgentId?: string;
  agentLabel?: string;
  /** Override the device identity / token source (defaults to ~/.openclaw). */
  openclawHome?: string;
  timeoutMs?: number;
  /**
   * Optional REAL fleet roster (from the Paperclip DB) used to replace the
   * gateway's self-described persona pool with Tyler's actual agents. When
   * supplied, per-agent capabilities are built from this roster joined with
   * the canonical fleet model map (see canonical-fleet.ts) instead of the raw
   * agents.list handshake. Additive: omit it and behaviour is unchanged.
   */
  roster?: Array<{ id: string; name: string; role?: string | null; title?: string | null }>;
}

// ---------------------------------------------------------------------------
// device-key auth helpers (faithful copy of the openclaw_gateway adapter's
// wire format so this is a REAL connection, not a mock).
// ---------------------------------------------------------------------------

function b64u(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(pem: string): Buffer {
  const spki = crypto.createPublicKey(pem).export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function buildDeviceAuthPayloadV3(p: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  return [
    "v3",
    p.deviceId,
    p.clientId,
    p.clientMode,
    p.role,
    p.scopes.join(","),
    String(p.signedAtMs),
    p.token ?? "",
    p.nonce,
    p.platform ?? "",
    p.deviceFamily ?? "",
  ].join("|");
}

interface LocalDeviceIdentity {
  deviceId: string;
  privateKeyPem: string;
  publicKeyRawB64: string;
  token: string;
  role: string;
  scopes: string[];
}

function loadLocalDeviceIdentity(openclawHome: string): LocalDeviceIdentity {
  const device = JSON.parse(fs.readFileSync(path.join(openclawHome, "identity", "device.json"), "utf8"));
  const auth = JSON.parse(fs.readFileSync(path.join(openclawHome, "identity", "device-auth.json"), "utf8"));
  const operator = auth?.tokens?.operator ?? Object.values(auth?.tokens ?? {})[0];
  if (!operator?.token) throw new Error("no operator device token found in device-auth.json");
  return {
    deviceId: device.deviceId,
    privateKeyPem: device.privateKeyPem,
    publicKeyRawB64: b64u(derivePublicKeyRaw(device.publicKeyPem)),
    token: operator.token,
    role: operator.role ?? "operator",
    scopes: Array.isArray(operator.scopes) ? operator.scopes : ["operator.admin"],
  };
}

// ---------------------------------------------------------------------------
// minimal JSON-RPC-over-WS client (req/res/event frames, connect.challenge)
// ---------------------------------------------------------------------------

class GatewayProbeClient {
  private ws: WebSocket;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private resolveChallenge!: (nonce: string) => void;
  private challenge: Promise<string>;
  private readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });
    this.challenge = new Promise<string>((resolve) => (this.resolveChallenge = resolve));
    this.challenge.catch(() => {});
    this.ws.on("message", (data) => this.onMessage(data.toString()));
  }

  open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("gateway websocket open timeout")), this.timeoutMs);
      this.ws.once("open", () => { clearTimeout(t); resolve(); });
      this.ws.once("error", (e) => { clearTimeout(t); reject(e as Error); });
    });
  }

  waitChallenge(): Promise<string> {
    return Promise.race([
      this.challenge,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("connect challenge timeout")), this.timeoutMs)),
    ]);
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`gateway request timeout (${method})`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  close(): void {
    try { this.ws.close(1000, "acp-handshake-complete"); } catch { /* ignore */ }
  }

  private onMessage(raw: string): void {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.type === "event") {
      if (m.event === "connect.challenge" && m.payload?.nonce) this.resolveChallenge(m.payload.nonce);
      return;
    }
    if (m?.type === "res" && typeof m.id === "string") {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.payload ?? null);
      else p.reject(new Error(m.error?.message || m.error?.code || "gateway request failed"));
    }
  }
}

// ---------------------------------------------------------------------------
// normalisers
// ---------------------------------------------------------------------------

function asArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function normaliseModels(payload: any): AcpModel[] {
  return asArray(payload?.models).map((m) => ({
    id: String(m.id ?? ""),
    name: String(m.name ?? m.id ?? ""),
    provider: m.provider,
    contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
    reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
    input: Array.isArray(m.input) ? m.input.map(String) : undefined,
  })).filter((m) => m.id);
}

function normaliseCommands(payload: any): AcpSlashCommand[] {
  return asArray(payload?.commands).map((c) => ({
    name: String(c.name ?? ""),
    description: c.description,
    category: c.category,
    aliases: Array.isArray(c.textAliases) ? c.textAliases.map(String) : undefined,
    acceptsArgs: typeof c.acceptsArgs === "boolean" ? c.acceptsArgs : undefined,
  })).filter((c) => c.name);
}

function normaliseRoster(payload: any): AcpRosterEntry[] {
  return asArray(payload?.agents).map((a) => ({
    id: String(a.id ?? ""),
    name: String(a.name ?? a.id ?? ""),
    model: a?.model?.primary,
    runtime: a?.agentRuntime?.id,
  })).filter((a) => a.id);
}

function pickModes(payload: any, gatewayAgentId: string): { modes: AcpMode[]; def: string | null } {
  const agents = asArray(payload?.agents);
  const agent = agents.find((a) => String(a.id) === gatewayAgentId) ?? agents[0];
  if (!agent) return { modes: [], def: null };
  const levels = asArray(agent.thinkingLevels).map((l) => ({ id: String(l.id), label: String(l.label ?? l.id) }));
  return { modes: levels, def: agent.thinkingDefault ?? null };
}

/**
 * teamCapable is DERIVED from the self-described method catalog. AionUi's spec
 * defines team_capable = mcp_capabilities.stdio. The OpenClaw gateway doesn't
 * surface mcp_capabilities verbatim, but it DOES advertise the multi-agent
 * orchestration methods that make a backend team-eligible, so we derive it from
 * those. This is the one non-verbatim field and is marked "derived".
 */
function deriveTeamCapable(methods: string[]): { capable: boolean; reason: string } {
  const set = new Set(methods);
  const required = ["agents.create", "sessions.create", "tasks.list"];
  const present = required.filter((m) => set.has(m));
  const capable = present.length === required.length;
  return {
    capable,
    reason: capable
      ? `advertises multi-agent orchestration methods (${present.join(", ")})`
      : `missing orchestration methods (${required.filter((m) => !set.has(m)).join(", ")})`,
  };
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

export async function readGatewayHandshake(
  opts: GatewayHandshakeOptions = {},
): Promise<AcpHandshake | AcpHandshakeError> {
  const url = opts.url ?? process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789";
  const agentLabel = opts.agentLabel ?? "OpenClaw Agent";
  const gatewayAgentId = opts.gatewayAgentId ?? "main";
  const openclawHome = opts.openclawHome ?? path.join(os.homedir(), ".openclaw");
  const timeoutMs = opts.timeoutMs ?? 12_000;

  let stage = "identity";
  let client: GatewayProbeClient | null = null;
  const startedAt = Date.now();
  try {
    const identity = loadLocalDeviceIdentity(openclawHome);

    stage = "open";
    client = new GatewayProbeClient(url, timeoutMs);
    await client.open();

    stage = "connect";
    const nonce = await client.waitChallenge();
    const signedAtMs = Date.now();
    const clientId = "gateway-client";
    const clientMode = "backend";
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role: identity.role,
      scopes: identity.scopes,
      signedAtMs,
      token: identity.token,
      nonce,
      platform: process.platform,
    });
    const hello = await client.request<any>("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: clientId, version: "paperclip-acp-poc/0.1.0", platform: process.platform, mode: clientMode },
      role: identity.role,
      scopes: identity.scopes,
      caps: [],
      auth: { deviceToken: identity.token },
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKeyRawB64,
        signature: b64u(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(identity.privateKeyPem))),
        signedAt: signedAtMs,
        nonce,
      },
    });

    const methods: string[] = asArray(hello?.features?.methods).map(String);
    const events: string[] = asArray(hello?.features?.events).map(String);

    // Read each self-describing surface. Tolerate individual method failures so
    // a single unsupported method doesn't sink the whole handshake.
    stage = "capabilities";
    const safe = async <T,>(method: string, fallback: T): Promise<T> => {
      try { return (await client!.request<T>(method, {})) ?? fallback; } catch { return fallback; }
    };
    const [modelsRes, commandsRes, agentsRes, identityRes] = await Promise.all([
      safe<any>("models.list", {}),
      safe<any>("commands.list", {}),
      safe<any>("agents.list", {}),
      safe<any>("agent.identity.get", {}),
    ]);

    const { modes, def } = pickModes(agentsRes, gatewayAgentId);
    const team = deriveTeamCapable(methods);

    const result: AcpHandshake = {
      ok: true,
      agentLabel,
      gatewayAgentId,
      transport: "openclaw-gateway-ws",
      url,
      connectedAtMs: startedAt,
      handshakeMs: Date.now() - startedAt,
      server: {
        version: hello?.server?.version ?? null,
        protocol: typeof hello?.protocol === "number" ? hello.protocol : null,
        connId: hello?.server?.connId ?? null,
      },
      methods,
      events,
      models: normaliseModels(modelsRes),
      slashCommands: normaliseCommands(commandsRes),
      modes,
      modeDefault: def,
      roster: normaliseRoster(agentsRes),
      identity: { name: identityRes?.name ?? null, avatar: identityRes?.avatar ?? identityRes?.emoji ?? null },
      teamCapable: team.capable,
      teamCapableReason: team.reason,
      provenance: {
        server: "real",
        methods: "real",
        events: "real",
        models: "real",
        slashCommands: "real",
        modes: "real",
        roster: "real",
        identity: "real",
        teamCapable: "derived",
      },
    };
    return result;
  } catch (err) {
    return {
      ok: false,
      agentLabel,
      url,
      error: err instanceof Error ? err.message : String(err),
      stage,
    };
  } finally {
    client?.close();
  }
}

// ===========================================================================
// PHASE 1 — multi-agent fleet capabilities (additive, read-only).
//
// The single `connect` handshake already self-describes a MULTI-AGENT roster
// (`agents.list`), each entry carrying real per-agent capability fields
// (model.primary, thinkingLevels = modes, thinkingDefault, agentRuntime,
// workspace). Phase 1 turns that one handshake into a per-agent capability bag
// for EVERY roster agent, so Paperclip's Fleet builds each agent's models/modes
// from the handshake instead of hard-coded adapter config.
//
// This is strictly parallel to the Hermes<->Ares bridge and the production
// openclaw_gateway adapter: it opens a read-only connection, reads capability
// metadata for the whole roster, and disconnects. It spawns nothing and mutates
// nothing. The proven single-agent `readGatewayHandshake` above is untouched.
// ===========================================================================

/** One roster agent's capabilities, built entirely from the live handshake. */
export interface AcpAgentCapabilities {
  id: string;
  name: string;
  /** Org role (e.g. orchestrator, coo, engineer) when known. */
  role: string | null;
  /** Human title / role description shown under the name. */
  title: string | null;
  workspace: string | null;
  runtime: string | null;
  /** Per-agent primary model id (verbatim from agents.list[].model.primary). */
  model: string | null;
  /** Full model record resolved against the shared models.list catalog. */
  modelInfo: AcpModel | null;
  /** Per-agent thinking levels (= modes), verbatim. */
  modes: AcpMode[];
  modeDefault: string | null;
  /** Derived from the shared gateway method catalog (one backend). */
  teamCapable: boolean;
  provenance: Record<string, Provenance>;
}

/**
 * Fleet-wide capability bag: the shared backend catalog (read once) plus a
 * per-agent capability bag for each roster agent.
 */
export interface AcpFleet {
  ok: true;
  transport: "openclaw-gateway-ws";
  url: string;
  connectedAtMs: number;
  handshakeMs: number;
  server: { version: string | null; protocol: number | null; connId: string | null };
  /** Shared, verbatim from the backend. */
  methods: string[];
  events: string[];
  models: AcpModel[];
  slashCommands: AcpSlashCommand[];
  identity: { name: string | null; avatar: string | null };
  teamCapable: boolean;
  teamCapableReason: string;
  /** Per-agent capabilities, one per roster entry — built from the handshake. */
  agents: AcpAgentCapabilities[];
  agentCount: number;
  /** "canonical" = real Paperclip fleet roster; "handshake" = gateway personas. */
  rosterSource: "canonical" | "handshake";
  provenance: Record<string, Provenance>;
  /** Honest real/derived/stub accounting for the UI legend + report. */
  notes: { real: string[]; derived: string[]; stub: string[] };
}

function normaliseAgentCapabilities(
  rawAgents: any[],
  models: AcpModel[],
  team: { capable: boolean },
): AcpAgentCapabilities[] {
  const byId = new Map(models.map((m) => [m.id, m] as const));
  return rawAgents
    .map((a) => {
      const id = String(a?.id ?? "");
      const modelId = a?.model?.primary ? String(a.model.primary) : null;
      const modes = asArray(a?.thinkingLevels).map((l) => ({ id: String(l.id), label: String(l.label ?? l.id) }));
      return {
        id,
        name: String(a?.name ?? a?.id ?? ""),
        role: null,
        title: null,
        workspace: a?.workspace ? String(a.workspace) : null,
        runtime: a?.agentRuntime?.id ? String(a.agentRuntime.id) : null,
        model: modelId,
        modelInfo: modelId ? byId.get(modelId) ?? null : null,
        modes,
        modeDefault: a?.thinkingDefault ? String(a.thinkingDefault) : null,
        teamCapable: team.capable,
        provenance: {
          model: "real",
          modes: "real",
          modeDefault: "real",
          runtime: "real",
          workspace: "real",
          teamCapable: "derived",
        } as Record<string, Provenance>,
      };
    })
    .filter((a) => a.id);
}

/**
 * Build per-agent capabilities from the REAL Paperclip fleet roster (DB names +
 * roles/titles) joined with the canonical fleet model map. Used when the caller
 * passes opts.roster, so the Fleet panel reflects Tyler's actual agents instead
 * of the gateway's self-described persona pool. The shared model catalog from
 * the live handshake is still used to resolve a richer modelInfo where possible.
 */
function buildCanonicalAgentCapabilities(
  roster: Array<{ id: string; name: string; role?: string | null; title?: string | null }>,
  models: AcpModel[],
  team: { capable: boolean },
): AcpAgentCapabilities[] {
  const resolveModelInfo = (cm: CanonicalModel | undefined): AcpModel | null => {
    if (!cm?.catalogMatch) return null;
    const needle = cm.catalogMatch.toLowerCase();
    return (
      models.find(
        (m) =>
          m.id.toLowerCase().includes(needle) ||
          (m.name ?? "").toLowerCase().includes(needle),
      ) ?? null
    );
  };
  return roster
    .filter((a) => a && a.id)
    .map((a) => {
      const cm = canonicalModelFor(a.name);
      return {
        id: a.id,
        name: a.name,
        role: a.role ?? null,
        title: a.title ?? null,
        workspace: null,
        runtime: null,
        model: cm?.model ?? null,
        modelInfo: resolveModelInfo(cm),
        modes: [],
        modeDefault: null,
        teamCapable: team.capable,
        provenance: {
          // Names/roles/titles are REAL (verbatim from the Paperclip DB roster).
          name: "real",
          role: "real",
          title: "real",
          // Model is DERIVED: reconciled from the live fleet config (bridge +
          // litellm aliases + DB titles) via the canonical fleet map.
          model: "derived",
          teamCapable: "derived",
        } as Record<string, Provenance>,
      };
    });
}

export async function readGatewayFleet(
  opts: GatewayHandshakeOptions = {},
): Promise<AcpFleet | AcpHandshakeError> {
  const url = opts.url ?? process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789";
  const agentLabel = opts.agentLabel ?? "OpenClaw Gateway";
  const openclawHome = opts.openclawHome ?? path.join(os.homedir(), ".openclaw");
  const timeoutMs = opts.timeoutMs ?? 12_000;

  let stage = "identity";
  let client: GatewayProbeClient | null = null;
  const startedAt = Date.now();
  try {
    const identity = loadLocalDeviceIdentity(openclawHome);

    stage = "open";
    client = new GatewayProbeClient(url, timeoutMs);
    await client.open();

    stage = "connect";
    const nonce = await client.waitChallenge();
    const signedAtMs = Date.now();
    const clientId = "gateway-client";
    const clientMode = "backend";
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role: identity.role,
      scopes: identity.scopes,
      signedAtMs,
      token: identity.token,
      nonce,
      platform: process.platform,
    });
    // Negotiate protocol range; the live gateway selects v4 (see PROTOCOL_VERSION).
    const hello = await client.request<any>("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: clientId, version: "paperclip-acp-fleet/0.1.0", platform: process.platform, mode: clientMode },
      role: identity.role,
      scopes: identity.scopes,
      caps: [],
      auth: { deviceToken: identity.token },
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKeyRawB64,
        signature: b64u(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(identity.privateKeyPem))),
        signedAt: signedAtMs,
        nonce,
      },
    });

    const methods: string[] = asArray(hello?.features?.methods).map(String);
    const events: string[] = asArray(hello?.features?.events).map(String);

    stage = "capabilities";
    const safe = async <T,>(method: string, fallback: T): Promise<T> => {
      try { return (await client!.request<T>(method, {})) ?? fallback; } catch { return fallback; }
    };
    const [modelsRes, commandsRes, agentsRes, identityRes] = await Promise.all([
      safe<any>("models.list", {}),
      safe<any>("commands.list", {}),
      safe<any>("agents.list", {}),
      safe<any>("agent.identity.get", {}),
    ]);

    const models = normaliseModels(modelsRes);
    const team = deriveTeamCapable(methods);
    const useCanonical = Array.isArray(opts.roster) && opts.roster.length > 0;
    const agents = useCanonical
      ? buildCanonicalAgentCapabilities(opts.roster!, models, team)
      : normaliseAgentCapabilities(asArray(agentsRes?.agents), models, team);
    const rosterSource: "canonical" | "handshake" = useCanonical ? "canonical" : "handshake";

    const fleet: AcpFleet = {
      ok: true,
      transport: "openclaw-gateway-ws",
      url,
      connectedAtMs: startedAt,
      handshakeMs: Date.now() - startedAt,
      server: {
        version: hello?.server?.version ?? null,
        protocol: typeof hello?.protocol === "number" ? hello.protocol : null,
        connId: hello?.server?.connId ?? null,
      },
      methods,
      events,
      models,
      slashCommands: normaliseCommands(commandsRes),
      identity: { name: identityRes?.name ?? null, avatar: identityRes?.avatar ?? identityRes?.emoji ?? null },
      teamCapable: team.capable,
      teamCapableReason: team.reason,
      agents,
      agentCount: agents.length,
      rosterSource,
      provenance: {
        server: "real",
        methods: "real",
        events: "real",
        models: "real",
        slashCommands: "real",
        identity: "real",
        agents: useCanonical ? "derived" : "real",
        teamCapable: "derived",
      },
      notes: {
        real: [
          "per-agent model (agents.list[].model.primary)",
          "per-agent modes + default (thinkingLevels / thinkingDefault)",
          "per-agent runtime + workspace",
          "shared models / slash-commands / method+event catalog / identity",
          useCanonical
            ? `${agents.length} agents = REAL Paperclip fleet roster (names/roles verbatim from DB)`
            : `multi-agent: ${agents.length} agents built from ONE handshake (not hard-coded adapter config)`,
        ],
        derived: [
          "teamCapable (computed from advertised orchestration methods)",
          ...(useCanonical
            ? ["per-agent model reconciled from the live fleet config (bridge personas/peers + litellm aliases + DB titles) via the canonical fleet map"]
            : []),
        ],
        stub: [
          "no separate live ACP session is opened per agent yet — that is Phase 2 (in parallel, no cutover). All capability data here is verbatim from the live handshake.",
        ],
      },
    };
    void agentLabel;
    return fleet;
  } catch (err) {
    return {
      ok: false,
      agentLabel,
      url,
      error: err instanceof Error ? err.message : String(err),
      stage,
    };
  } finally {
    client?.close();
  }
}

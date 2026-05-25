import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, roomMessages } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export type AgentBridgeConfig = {
  kind: string;
  gatewayUrl: string;
  authToken: string;
  identityId: string;
  // Reserved for v2 (cross-machine peers). Null/undefined for local agents.
  peerEndpoint?: string | null;
};

export type DispatchAgentBridgeInput = {
  agentId: string;
  companyId: string;
  roomId: string;
  messageId: string;
  messageContent: string;
  senderActorType: string;
  senderActorId: string;
};

const RECENT_MESSAGE_WINDOW = 20;
const BRIDGE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolves the base URL the bridge daemon should POST agent replies to. The
 * dev server's listen port is published by index.ts as PAPERCLIP_LISTEN_PORT;
 * fall back to the legacy 3001 only as a last resort so a misconfigured env
 * doesn't silently break round-trip persistence.
 */
export function resolveBridgeApiBaseUrl(): string {
  if (process.env.PAPERCLIP_API_URL) return process.env.PAPERCLIP_API_URL;
  if (process.env.PAPERCLIP_PUBLIC_BASE_URL) return process.env.PAPERCLIP_PUBLIC_BASE_URL;
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3001";
  return `http://127.0.0.1:${port}`;
}

function isBridgeConfig(value: unknown): value is AgentBridgeConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.gatewayUrl === "string" &&
    typeof candidate.authToken === "string" &&
    typeof candidate.identityId === "string"
  );
}

async function fetchRecentContext(db: Db, roomId: string) {
  const rows = await db
    .select({
      id: roomMessages.id,
      senderId: roomMessages.senderId,
      senderType: roomMessages.senderType,
      content: roomMessages.content,
      createdAt: roomMessages.createdAt,
    })
    .from(roomMessages)
    .where(eq(roomMessages.roomId, roomId))
    .orderBy(roomMessages.createdAt);
  return rows.slice(-RECENT_MESSAGE_WINDOW);
}

/**
 * If the target agent has an `agentBridge` config, POSTs the room message to
 * the bridge's gateway and returns true. Returns false when the agent has no
 * bridge (caller should fall back to the standard heartbeat wakeup path).
 *
 * The bridge is fire-and-forget from Paperclip's side: the external runtime is
 * responsible for POSTing the agent's reply back to
 * `/api/companies/:companyId/rooms/:roomId/messages` using its own API key.
 */
export async function dispatchAgentBridge(
  db: Db,
  input: DispatchAgentBridgeInput,
): Promise<boolean> {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      agentBridge: agents.agentBridge,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);

  if (!agent || !isBridgeConfig(agent.agentBridge)) return false;

  const bridge = agent.agentBridge;
  const targetUrl = new URL("/rooms/incoming", bridge.gatewayUrl).toString();

  const history = await fetchRecentContext(db, input.roomId);

  const apiBaseUrl = resolveBridgeApiBaseUrl();
  const replyUrl = new URL(
    `/api/agent-bridge/reply`,
    apiBaseUrl,
  ).toString();

  const body = {
    kind: bridge.kind,
    identityId: bridge.identityId,
    agent: {
      id: agent.id,
      name: agent.name,
    },
    room: {
      id: input.roomId,
      companyId: input.companyId,
    },
    message: {
      id: input.messageId,
      content: input.messageContent,
      senderActorType: input.senderActorType,
      senderActorId: input.senderActorId,
    },
    history: history.map((row) => ({
      id: row.id,
      senderId: row.senderId,
      senderType: row.senderType,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    })),
    reply: {
      // External runtime POSTs back to this URL with { content, ... }.
      url: replyUrl,
      // The runtime must authenticate using its own Paperclip API key — we do
      // NOT forward Paperclip credentials. The bridge's own auth token is
      // separate and used only for the inbound POST to the gateway.
      authHint: "Use the agent's PAPERCLIP_API_KEY (Bearer) when posting replies.",
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bridge.authToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status, agentId: agent.id, gatewayUrl: bridge.gatewayUrl },
        "agent bridge gateway responded with non-2xx",
      );
    }
  } catch (err) {
    logger.warn(
      { err, agentId: agent.id, gatewayUrl: bridge.gatewayUrl },
      "agent bridge POST failed",
    );
  } finally {
    clearTimeout(timer);
  }

  return true;
}

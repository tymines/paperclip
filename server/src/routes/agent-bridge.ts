import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { ROOM_MESSAGE_HARD_CAP } from "@paperclipai/shared";
import {
  roomService,
  dispatchAgentBridge,
  heartbeatService,
  publishLiveEvent,
} from "../services/index.js";
import type { AgentBridgeConfig } from "../services/index.js";
import { conflict, forbidden, notFound, unauthorized, badRequest } from "../errors.js";
import { logger } from "../middleware/logger.js";

/**
 * Routes used by external bridged agent runtimes (e.g. OpenClaw, Hermes) to
 * post replies back into Paperclip rooms. Authentication is per-agent — the
 * caller must include `Authorization: Bearer <agent.agentBridge.authToken>`
 * matching the target agent's bridge config. This sidesteps the standard
 * actor middleware so the bridge daemon does not need a Paperclip-issued
 * agent API key.
 */
export function agentBridgeRoutes(db: Db) {
  const router = Router();
  const svc = roomService(db);
  const heartbeat = heartbeatService(db);

  router.post("/agent-bridge/reply", async (req, res) => {
    const header = (req.headers.authorization ?? "").trim();
    const match = header.match(/^bearer\s+(.+)$/i);
    if (!match) throw unauthorized("Missing bearer token");
    const presentedToken = match[1]!.trim();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const agentId = typeof body.agentId === "string" ? body.agentId : null;
    const roomId = typeof body.roomId === "string" ? body.roomId : null;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const parentMessageId =
      typeof body.parentMessageId === "string" && body.parentMessageId.length > 0
        ? body.parentMessageId
        : null;

    if (!agentId || !roomId) throw badRequest("agentId and roomId are required");
    if (content.length === 0) throw badRequest("content must be a non-empty string");

    const [agent] = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        agentBridge: agents.agentBridge,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) throw notFound("Agent not found");

    const bridge = agent.agentBridge as AgentBridgeConfig | null;
    if (!bridge || typeof bridge.authToken !== "string") {
      throw forbidden("Agent has no bridge configured");
    }
    if (bridge.authToken !== presentedToken) {
      throw forbidden("Bridge token mismatch");
    }

    const room = await svc.getById(roomId);
    if (!room || room.companyId !== agent.companyId) throw notFound("Room not found");

    const messageCount = await svc.countMessages(roomId);
    if (messageCount >= ROOM_MESSAGE_HARD_CAP) {
      throw conflict(
        `Room has hit the hard message cap (${ROOM_MESSAGE_HARD_CAP}).`,
        { roomId, messageCount, cap: ROOM_MESSAGE_HARD_CAP },
      );
    }

    const message = await svc.sendMessage({
      roomId,
      senderId: agent.id,
      senderType: "agent",
      content,
      messageType: "chat",
      metadata: { source: "agent-bridge", kind: bridge.kind },
      parentMessageId,
    });

    publishLiveEvent({
      companyId: agent.companyId,
      type: "room.message",
      payload: {
        roomId,
        messageId: message.id,
        senderId: message.senderId,
        senderType: message.senderType,
        content: message.content,
        messageType: message.messageType,
        parentMessageId: message.parentMessageId,
        createdAt: message.createdAt,
      },
    });

    // Cascade to other room members. Re-uses the same dispatcher used by the
    // primary message endpoint so bridged agents can address one another.
    void (async () => {
      const members = await svc.listMembers(roomId);
      for (const member of members) {
        if (!member.agentId) continue;
        if (member.agentId === agent.id) continue;
        const handled = await dispatchAgentBridge(db, {
          agentId: member.agentId,
          companyId: agent.companyId,
          roomId,
          messageId: message.id,
          messageContent: message.content,
          senderActorType: "agent",
          senderActorId: agent.id,
        }).catch((err) => {
          logger.warn(
            { err, roomId, agentId: member.agentId },
            "cascade dispatch failed",
          );
          return false;
        });
        if (handled) continue;
        heartbeat
          .wakeup(member.agentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "room_message",
            payload: { roomId, messageId: message.id },
            requestedByActorType: "agent",
            requestedByActorId: agent.id,
            contextSnapshot: {
              roomId,
              messageId: message.id,
              source: "room.message",
              wakeReason: "room_message",
            },
          })
          .catch((err) =>
            logger.warn({ err, roomId, agentId: member.agentId }, "wakeup failed"),
          );
      }
    })();

    res.status(201).json(message);
  });

  return router;
}

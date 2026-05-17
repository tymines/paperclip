import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createRoomSchema,
  updateRoomSchema,
  addRoomMemberSchema,
  sendRoomMessageSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { roomService, logActivity, publishLiveEvent, heartbeatService } from "../services/index.js";
import { notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";

export function roomRoutes(db: Db) {
  const router = Router();
  const svc = roomService(db);
  const heartbeat = heartbeatService(db);

  // GET /companies/:companyId/rooms
  router.get("/companies/:companyId/rooms", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  // POST /companies/:companyId/rooms
  router.post("/companies/:companyId/rooms", validate(createRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const room = await svc.create(companyId, {
      ...req.body,
      createdBy: actor.actorId,
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "room.created",
      entityType: "room",
      entityId: room.id,
      details: { name: room.name, type: room.type },
    });
    res.status(201).json(room);
  });

  // GET /companies/:companyId/rooms/:roomId
  router.get("/companies/:companyId/rooms/:roomId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const room = await svc.getById(roomId);
    if (!room || room.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const members = await svc.listMembers(roomId);
    res.json({ ...room, members });
  });

  // PATCH /companies/:companyId/rooms/:roomId
  router.patch("/companies/:companyId/rooms/:roomId", validate(updateRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const room = await svc.update(roomId, req.body);
    if (!room) {
      throw notFound("Room not found");
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "room.updated",
      entityType: "room",
      entityId: room.id,
      details: req.body,
    });
    publishLiveEvent({
      companyId,
      type: "room.updated",
      payload: { roomId: room.id },
    });
    res.json(room);
  });

  // DELETE /companies/:companyId/rooms/:roomId
  router.delete("/companies/:companyId/rooms/:roomId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const room = await svc.remove(roomId);
    if (!room) {
      throw notFound("Room not found");
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "room.deleted",
      entityType: "room",
      entityId: room.id,
    });
    res.json(room);
  });

  // POST /companies/:companyId/rooms/:roomId/members
  router.post("/companies/:companyId/rooms/:roomId/members", validate(addRoomMemberSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const member = await svc.addMember({
      roomId,
      agentId: req.body.agentId ?? null,
      userId: req.body.userId ?? null,
      role: req.body.role,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "room.member.added",
      entityType: "room",
      entityId: roomId,
      details: { memberId: member.id, agentId: member.agentId, userId: member.userId },
    });
    publishLiveEvent({
      companyId,
      type: "room.member.joined",
      payload: { roomId, memberId: member.id },
    });
    res.status(201).json(member);
  });

  // DELETE /companies/:companyId/rooms/:roomId/members/:memberId
  router.delete("/companies/:companyId/rooms/:roomId/members/:memberId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    const memberId = req.params.memberId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const member = await svc.getMember(memberId);
    if (!member || member.roomId !== roomId) {
      throw notFound("Member not found");
    }
    const removed = await svc.removeMember(memberId);
    if (!removed) {
      throw notFound("Member not found");
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "room.member.removed",
      entityType: "room",
      entityId: roomId,
      details: { memberId },
    });
    publishLiveEvent({
      companyId,
      type: "room.member.left",
      payload: { roomId, memberId },
    });
    res.json(removed);
  });

  // GET /companies/:companyId/rooms/:roomId/messages
  router.get("/companies/:companyId/rooms/:roomId/messages", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const result = await svc.listMessages(roomId, { cursor, limit });
    res.json(result);
  });

  // POST /companies/:companyId/rooms/:roomId/messages
  router.post("/companies/:companyId/rooms/:roomId/messages", validate(sendRoomMessageSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(roomId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Room not found");
    }
    const actor = getActorInfo(req);
    const message = await svc.sendMessage({
      roomId,
      senderId: actor.actorId,
      senderType: req.body.senderType ?? actor.actorType,
      content: req.body.content,
      messageType: req.body.messageType,
      metadata: req.body.metadata ?? null,
      parentMessageId: req.body.parentMessageId ?? null,
    });
    publishLiveEvent({
      companyId,
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

    // Wake up agent members so they can respond to the message.
    void (async () => {
      const members = await svc.listMembers(roomId);
      const actorIsAgent = actor.actorType === "agent";
      for (const member of members) {
        if (!member.agentId) continue;
        if (actorIsAgent && actor.actorId === member.agentId) continue;
        heartbeat
          .wakeup(member.agentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "room_message",
            payload: { roomId, messageId: message.id },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              roomId,
              messageId: message.id,
              source: "room.message",
              wakeReason: "room_message",
            },
          })
          .catch((err) =>
            logger.warn({ err, roomId, agentId: member.agentId }, "failed to wake agent on room message"),
          );
      }
    })();

    res.status(201).json(message);
  });

  return router;
}

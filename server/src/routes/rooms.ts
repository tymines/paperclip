import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  createRoomSchema,
  updateRoomSchema,
  addRoomMemberSchema,
  sendRoomMessageSchema,
  ROOM_MESSAGE_HARD_CAP,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { roomService, agentService, logActivity, publishLiveEvent, heartbeatService } from "../services/index.js";
import { createDesignRunsService } from "../services/design-runs.js";
import { dispatchAgentBridge } from "../services/agent-bridge.js";
import { conflict, notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";
import {
  processRoomTransition,
} from "../rooms-rail/rail-engine.js";
import {
  createCouncilSession,
  addParticipant,
  castVote,
  checkConsensus,
} from "../rooms-rail/council.js";

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

  // ── Projects review (product-owner review of agent-built apps) ──
  const projectsFile = path.join(os.homedir(), ".openclaw", "projects.json");
  const reviewsLog = path.join(os.homedir(), ".openclaw", "project-reviews.jsonl");
  const readProjects = () => { try { return JSON.parse(fs.readFileSync(projectsFile, "utf8")); } catch { return []; } };

  // GET /companies/:companyId/projects
  router.get("/companies/:companyId/review-projects", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    res.json({ projects: readProjects() });
  });

  // POST /companies/:companyId/review-projects/:projectId/review  { decision, note }
  router.post("/companies/:companyId/review-projects/:projectId/review", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    const { projectId } = req.params;
    const decision = String((req.body?.decision ?? "")).toLowerCase();
    const note = String(req.body?.note ?? "");
    const allowed: Record<string,string> = { approve: "approved", reject: "rejected", changes: "changes_requested" };
    const status = allowed[decision];
    if (!status) { res.status(400).json({ error: "decision must be approve | reject | changes" }); return; }
    const projects = readProjects();
    const proj = projects.find((p: any) => p.id === projectId);
    if (!proj) { res.status(404).json({ error: "project not found" }); return; }
    proj.status = status; proj.reviewNote = note; proj.reviewedAt = new Date().toISOString();
    try { fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 1)); } catch {}
    try { fs.appendFileSync(reviewsLog, JSON.stringify({ ts: proj.reviewedAt, projectId, decision: status, note }) + "\n"); } catch {}
    res.json({ ok: true, project: proj });
  });

  // GET /companies/:companyId/crew-activity — recent agent activity across rooms
  router.get("/companies/:companyId/crew-activity", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const agentSvc = agentService(db);
    const [roomsList, agents] = await Promise.all([
      svc.list(companyId),
      agentSvc.list(companyId, { includeTerminated: true }),
    ]);
    const nameById = new Map<string, string>(agents.map((a: any) => [a.id, a.name]));
    const roomsToScan = roomsList.slice(0, 12);
    const perRoom = await Promise.all(
      roomsToScan.map(async (room: any) => {
        const { messages } = await svc.listMessages(room.id, { limit: 4 });
        return messages
          .filter((m: any) => m.senderType === "agent")
          .map((m: any) => {
            const ts = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt);
            return {
              id: String(m.id),
              actorName: m.senderName ?? nameById.get(m.senderId) ?? "Agent",
              action: "posted in",
              target: String(m.content ?? "").replace(/\s+/g, " ").slice(0, 100),
              roomName: room.name as string,
              timestamp: ts.toISOString(),
            };
          });
      }),
    );
    const activity = perRoom
      .flat()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 25);
    res.json({ activity });
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

    // Hard cap on per-room message volume — defends against bridged-agent ping-pong loops.
    const messageCount = await svc.countMessages(roomId);
    if (messageCount >= ROOM_MESSAGE_HARD_CAP) {
      throw conflict(
        `Room has hit the hard message cap (${ROOM_MESSAGE_HARD_CAP}). Archive or split the room to continue.`,
        { roomId, messageCount, cap: ROOM_MESSAGE_HARD_CAP },
      );
    }

    // Snapshot the sender's display name so it survives roster changes.
    let senderName: string | undefined;
    if (actor.agentId) {
      const [agent] = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, actor.agentId))
        .limit(1);
      if (agent) senderName = agent.name;
    }

    const message = await svc.sendMessage({
      roomId,
      senderId: actor.actorId,
      senderType: req.body.senderType ?? actor.actorType,
      senderName,
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
        senderName: message.senderName,
        content: message.content,
        messageType: message.messageType,
        parentMessageId: message.parentMessageId,
        createdAt: message.createdAt,
      },
    });

    // @design mention → fire a design run, post the asset back as a follow-up.
    // Detect the mention in the user's message; strip the mention to derive
    // the brief. Carousels are the default; @design[skill=poster-hero] picks
    // a different skill. Bound to a 1s rasterization wait grace via polling.
    void (async () => {
      const designMatch = message.content.match(
        /@design(?:\[skill=([a-z0-9-]+)\])?\b\s*(.*)$/is,
      );
      if (!designMatch) return;
      const skill = (designMatch[1] ?? "card-xiaohongshu").trim();
      const brief = designMatch[2]?.trim();
      if (!brief) return;
      try {
        const designSvc = createDesignRunsService(db);
        const run = await designSvc.start({
          companyId,
          skill,
          prompt: brief,
          agentId: "claude",
          createdBy: actor.actorId ?? undefined,
        });
        // Acknowledge immediately so the room sees the kickoff.
        const agentSvc = agentService(db);
        const [designerAgent] = await agentSvc.list(companyId, {}).then((agents: any[]) =>
          agents.filter((a: any) => a.name === "Hermes Designer" || a.name === "Designer"),
        );
        const designSenderId = designerAgent?.id ?? actor.actorId;
        const designSenderName = designerAgent?.name ?? "Design";
        const ack = await svc.sendMessage({
          roomId,
          senderId: designSenderId,
          senderType: "agent",
          senderName: designSenderName,
          content: `Working on a ${skill.replace(/-/g, " ")} for "${brief.slice(0, 80)}${brief.length > 80 ? "…" : ""}". Run id: ${run.id}.`,
          messageType: "chat",
          metadata: { designRunId: run.id, kind: "design-ack" },
          parentMessageId: message.id,
        });
        publishLiveEvent({
          companyId,
          type: "room.message",
          payload: {
            roomId,
            messageId: ack.id,
            senderId: ack.senderId,
            senderType: ack.senderType,
            senderName: ack.senderName,
            content: ack.content,
            messageType: ack.messageType,
            parentMessageId: ack.parentMessageId,
            createdAt: ack.createdAt,
          },
        });
        // Poll the run until terminal + raster done, then post the asset link.
        const deadline = Date.now() + 8 * 60_000;
        let lastRow = run;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3_000));
          const cur = await designSvc.get(run.id);
          if (!cur) break;
          lastRow = cur;
          const genDone = ["completed", "failed", "cancelled"].includes(cur.status);
          const rasterDone = ["completed", "failed", "skipped"].includes(cur.rasterStatus);
          if (genDone && rasterDone) break;
        }
        const pngList = Array.isArray(lastRow.pngPaths)
          ? (lastRow.pngPaths as string[])
          : [];
        let body: string;
        const metadata: Record<string, unknown> = {
          designRunId: run.id,
          kind: "design-result",
          status: lastRow.status,
          rasterStatus: lastRow.rasterStatus,
        };
        if (lastRow.status !== "completed") {
          body = `Design run failed: ${lastRow.error ?? "unknown error"}.`;
        } else if (lastRow.rasterStatus === "completed" && pngList.length > 0) {
          const urls = pngList.map(
            (_, i) => `/api/design/runs/${run.id}/asset.png?slide=${i + 1}`,
          );
          metadata.assetUrls = urls;
          metadata.mp4Url = lastRow.mp4Path ? `/api/design/runs/${run.id}/asset.mp4` : null;
          body = `Done — ${pngList.length} image${pngList.length === 1 ? "" : "s"} ready. View on /design or click any of: ${urls.slice(0, 4).join(" · ")}`;
        } else {
          metadata.assetUrl = lastRow.assetUrl;
          body = `Done — HTML preview: ${lastRow.assetUrl ?? `/api/design/runs/${run.id}/asset`}`;
        }
        const reply = await svc.sendMessage({
          roomId,
          senderId: designSenderId,
          senderType: "agent",
          senderName: designSenderName,
          content: body,
          messageType: "chat",
          metadata,
          parentMessageId: message.id,
        });
        publishLiveEvent({
          companyId,
          type: "room.message",
          payload: {
            roomId,
            messageId: reply.id,
            senderId: reply.senderId,
            senderType: reply.senderType,
            senderName: reply.senderName,
            content: reply.content,
            messageType: reply.messageType,
            parentMessageId: reply.parentMessageId,
            createdAt: reply.createdAt,
          },
        });
      } catch (err) {
        logger.warn(
          { err, roomId, designBrief: brief },
          "@design room hook dispatch failed",
        );
      }
    })().catch(() => undefined);

    // Dispatch to agent members. Bridged agents are routed via HTTP to their
    // external runtime (e.g. OpenClaw); non-bridged agents are woken via the
    // standard heartbeat path so the existing adapter executes their loop.
    void (async () => {
      const members = await svc.listMembers(roomId);
      const actorIsAgent = actor.actorType === "agent";
      for (const member of members) {
        if (!member.agentId) continue;
        if (actorIsAgent && actor.actorId === member.agentId) continue;

        const handled = await dispatchAgentBridge(db, {
          agentId: member.agentId,
          companyId,
          roomId,
          messageId: message.id,
          messageContent: message.content,
          senderActorType: actor.actorType,
          senderActorId: actor.actorId,
        }).catch((err) => {
          logger.warn(
            { err, roomId, agentId: member.agentId },
            "agent bridge dispatch failed",
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

  // ── Council routes (SHADOW — rooms_rail.enabled=false) ──
  router.post("/companies/:companyId/rooms/:roomId/council/sessions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const topic = String(req.body?.topic ?? "Review");
    const protocol = String(req.body?.protocol ?? "majority");
    const session = await createCouncilSession(db, roomId, topic, protocol);
    res.status(201).json(session);
  });

  router.post("/companies/:companyId/rooms/:roomId/council/sessions/:sessionId/participants", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { sessionId } = req.params;
    const agentId = req.body?.agentId as string;
    if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }
    const participant = await addParticipant(db, sessionId, agentId);
    res.status(201).json(participant);
  });

  router.patch("/companies/:companyId/rooms/:roomId/council/sessions/:sessionId/votes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { sessionId } = req.params;
    const { agentId, vote } = req.body as { agentId?: string; vote?: string };
    if (!agentId || !vote) { res.status(400).json({ error: "agentId and vote required" }); return; }
    const participant = await castVote(db, sessionId, agentId, vote);
    res.json(participant);
  });

  router.get("/companies/:companyId/rooms/:roomId/council/sessions/:sessionId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { sessionId } = req.params;
    const result = await checkConsensus(db, sessionId);
    res.json(result);
  });

  // ── Gate decision (enforcement path) ──
  router.post("/companies/:companyId/gate-decision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    // ponytail: agents structurally cannot advance gates
    if (actor.actorType !== "board") {
      res.status(403).json({ error: "agents cannot advance gates", actorType: actor.actorType });
      return;
    }

    const { stage, evidence, decision } = req.body as { stage?: string; evidence?: string[]; decision?: string };
    if (!stage) { res.status(400).json({ error: "stage required" }); return; }

    const { checkGate } = await import("../rooms-rail/gate-checker.js");
    const result = checkGate(stage, evidence ?? []);

    // ponytail: tyler-gate holds without explicit decision
    result.needs_tyler = !decision;
    result.blocked = result.needs_tyler;

    res.status(result.passed && !result.blocked ? 200 : 409).json(result);
  });

  return router;
}

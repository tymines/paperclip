import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { jarvisConversations, companies, companyJarvisSettings, rooms, roomMessages } from "@paperclipai/db";
import {
  commitAndResetSession,
  archiveSessionAsResource,
} from "../services/openviking-memory.js";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { jarvisBrainReply } from "../services/jarvis-brain.js";
import {
  gatherBriefingPayload,
  composeBriefingTranscript,
  extractRecommendedAction,
  type BriefingPayload,
} from "../services/jarvis-briefing.js";
import { getRawKey } from "../services/provider-api-keys/index.js";
import { getCapabilitySnapshot } from "../services/jarvis-capabilities.js";
import { logger } from "../middleware/logger.js";
import {
  calendarUpcoming,
  remindersOpen,
  messagesRecent,
  shellExec,
  fsList,
  fsSearch,
  consumeConfirmation,
} from "../services/jarvis-tools.js";
import {
  bargeInBus,
  mintRealtimeEphemeralKey,
  type BargeInCancelEvent,
} from "../services/jarvis-barge-in.js";
import {
  listDelegations,
  recordDelegationResult,
  checkPeerReachable,
  dispatchDelegation,
  type PeerAgentId,
} from "../services/jarvis-delegation.js";
import { kickoffBrainstorm } from "../services/brainstorm-kickoff.js";
import { kickoffZeusPlan, replanFromRevision } from "../services/zeus-plan.js";
import { projectizePlan } from "../services/projectize-plan.js";
import { parseToolsRequired } from "../services/tools-required.js";

/**
 * Jarvis voice endpoint.
 *
 * Accepts a finalized transcript (client handles STT), dispatches to the
 * Jarvis brain (data-rich context + LLM call + persistence), and returns
 * the agent reply. Streaming (SSE) + tool-use lands in Commit 5; the
 * endpoint contract stays stable through that change.
 */
const voiceRequestSchema = z.object({
  transcript: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  voiceTier: z.enum(["browser-native", "standard", "premium"]).optional(),
  /** True when the transcript came from the mic (TTS reply is spoken). */
  voiceMode: z.boolean().optional(),
  /** Length-budget hint. Falls back to inferResponseType() when omitted. */
  responseType: z.enum(["quick", "standard", "briefing", "detailed"]).optional(),
});

export function jarvisRoutes(db: Db) {
  const router = Router();

  /**
   * Health probe — confirms jarvisRoutes() is registered and the LLM-key
   * surface is reachable. Returns the providers that actually have keys
   * configured so the UI can show an accurate "no real LLM wired" banner
   * when every provider is missing.
   */
  router.get("/jarvis/health", async (_req, res) => {
    const [deepseek, openai, anthropic, moonshot, elevenlabs, openaiRealtime] =
      await Promise.all([
        getRawKey("deepseek").catch(() => null),
        getRawKey("openai").catch(() => null),
        getRawKey("anthropic").catch(() => null),
        getRawKey("moonshot").catch(() => null),
        getRawKey("elevenlabs").catch(() => null),
        getRawKey("openai_realtime").catch(() => null),
      ]);
    res.json({
      ok: true,
      version: 1,
      llm: {
        deepseek: !!deepseek,
        openai: !!openai,
        anthropic: !!anthropic,
        moonshot: !!moonshot,
      },
      voice: {
        elevenlabs: !!elevenlabs,
        openaiRealtime: !!openaiRealtime,
      },
    });
  });

  router.post(
    "/companies/:companyId/jarvis/voice",
    validate(voiceRequestSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      const { transcript, voiceTier, voiceMode, responseType } = req.body as z.infer<
        typeof voiceRequestSchema
      >;

      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : "unknown";

      const out = await jarvisBrainReply(db, {
        companyId,
        userActorId,
        transcript,
        voiceTier,
        voiceMode,
        responseType,
      });

      res.json({
        reply: out.reply,
        tier: voiceTier ?? "browser-native",
        latencyMs: out.latencyMs,
        llmProvider: out.llmProvider,
        llmModel: out.llmModel,
        contextSnapshot: out.contextSnapshot,
        personaVersion: out.personaVersion,
        personaSource: out.personaSource,
        responseType: out.responseType,
        truncated: out.truncated,
        conversationId: null,
        delegation: out.delegation ?? null,
      });
    }
  );

  /**
   * Daddy's Home morning briefing.
   *
   * Pulls a live ops snapshot (shipped overnight, blocked work, fleet health,
   * project progress, what changed) and hands it to Augi as the user-message
   * context. Augi composes a 4-6 sentence spoken-prose briefing per the
   * persona's "Daily morning briefing" section, ending with one concrete
   * recommended next action. Persisted to jarvis_conversations with
   * source="daddys_home" (or whatever source the caller passed).
   *
   * Server returns the briefing text + the extracted recommended-action
   * sentence (UI surfaces it as a primary CTA in the orb center). Audio
   * playback is client-side — the client picks browser TTS or ElevenLabs
   * based on the user's voiceTier.
   */
  const daddysHomeSchema = z.object({
    voiceTier: z.enum(["browser-native", "standard", "premium"]).optional(),
    source: z.string().min(1).max(64).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/daddys-home",
    validate(daddysHomeSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { voiceTier, source } = req.body as z.infer<typeof daddysHomeSchema>;

      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : "daddys-home-trigger";

      const out = await dispatchDaddysHome(db, {
        companyId,
        userActorId,
        voiceTier,
        source: source ?? "daddys_home",
      });

      res.json(out);
    },
  );

  /**
   * Local-only trigger that the bridge daemon's Mac-wake watcher hits on
   * unlock. No auth — we restrict to loopback callers and use a 4-hour
   * in-memory debounce so a flurry of wake events doesn't carpet-bomb
   * Augi. Resolves to the first company in the database (Tyler's instance
   * is single-tenant) and proxies to the main daddys-home flow.
   *
   * Mounted at /jarvis/daddys-home-trigger (no companyId prefix) so the
   * bridge daemon can call it without knowing the UUID.
   */
  router.post("/jarvis/daddys-home-trigger", async (req, res) => {
    // Defensive loopback check — req.ip is sensitive to trust-proxy config,
    // so we also consult the raw socket address. The trigger has no auth so
    // we must be strict about the origin (it's only meant for the bridge
    // daemon on the same host).
    const candidates = [
      req.ip ?? "",
      req.socket?.remoteAddress ?? "",
      (req.headers["x-forwarded-for"] as string | undefined) ?? "",
    ];
    if (!candidates.some(isLoopback)) {
      res.status(403).json({ error: "loopback_only" });
      return;
    }
    const source =
      typeof req.query.source === "string" && req.query.source.length > 0
        ? req.query.source.slice(0, 64)
        : "mac-wake";

    const lastFired = daddysHomeDebounce.get(source) ?? 0;
    const now = Date.now();
    if (now - lastFired < DADDYS_HOME_DEBOUNCE_MS) {
      const cooldownSec = Math.round(
        (DADDYS_HOME_DEBOUNCE_MS - (now - lastFired)) / 1000,
      );
      res.status(429).json({
        ok: false,
        skipped: "debounced",
        source,
        cooldownSec,
      });
      return;
    }

    const company = await db
      .select({ id: companies.id })
      .from(companies)
      .orderBy(asc(companies.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!company) {
      res.status(503).json({ ok: false, error: "no_company_configured" });
      return;
    }

    daddysHomeDebounce.set(source, now);

    try {
      const out = await dispatchDaddysHome(db, {
        companyId: company.id,
        userActorId: `system:${source}`,
        source,
      });
      res.json({ ok: true, source, companyId: company.id, ...out });
    } catch (err) {
      logger.warn({ err, source }, "daddys-home-trigger: dispatch failed");
      res.status(500).json({ ok: false, error: "dispatch_failed" });
    }
  });

  /**
   * Conversation history — pulls the user's recent turns out of
   * jarvis_conversations so the chat panel can hydrate with REAL history
   * instead of the mock "Sentiment +8.2pp WoW" stub. Returned newest-last
   * so the client can render in order without re-sorting.
   */
  router.get(
    "/companies/:companyId/jarvis/conversations",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
        100,
      );

      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : null;

      // Soft-hide filter: rows the user "cleared" from the view (cleared_at
      // set) are omitted here. They are NOT deleted. The brain's continuity
      // query (fetchRecentTurns) treats the last clear as a session boundary
      // and only loads the current session, while long-term memory (OpenViking)
      // retains everything for cross-session recall.
      const where = userActorId
        ? and(
            eq(jarvisConversations.companyId, companyId),
            eq(jarvisConversations.userActorId, userActorId),
            isNull(jarvisConversations.clearedAt),
          )
        : and(
            eq(jarvisConversations.companyId, companyId),
            isNull(jarvisConversations.clearedAt),
          );

      const rows = await db
        .select({
          id: jarvisConversations.id,
          userTranscript: jarvisConversations.userTranscript,
          agentReply: jarvisConversations.agentReply,
          llmProvider: jarvisConversations.llmProvider,
          llmModel: jarvisConversations.llmModel,
          responseType: jarvisConversations.responseType,
          interruptedAt: jarvisConversations.interruptedAt,
          interruptedAtChars: jarvisConversations.interruptedAtChars,
          createdAt: jarvisConversations.createdAt,
        })
        .from(jarvisConversations)
        .where(where)
        .orderBy(desc(jarvisConversations.createdAt))
        .limit(limit);

      res.json({ conversations: rows.reverse() });
    },
  );

  /**
   * Clear the War Room chat — start a genuinely FRESH SESSION on demand.
   * NON-DESTRUCTIVE: conversation rows are soft-hidden by stamping cleared_at,
   * never deleted. Two things happen so the new session is clean AND nothing
   * is lost:
   *   (1) Working context resets. fetchRecentTurns (jarvis-learning.ts) treats
   *       MAX(cleared_at) as the session boundary, so the brain's recent-turns
   *       window excludes everything before this clear — each new session is
   *       clean and high-quality (no ever-growing single context to degrade
   *       quality/cost).
   *   (2) Long-term memory is preserved + checkpointed. We commit the active
   *       OpenViking session (commitAndResetSession) which triggers automatic
   *       memory extraction into long-term store, then open a fresh session on
   *       the next turn. So even in a brand-new session Hermes can still recall
   *       past conversations via OpenViking. QMD / memory-core config untouched.
   * Scope mirrors the GET above: per-actor when we can resolve one, else
   * company-wide.
   */
  router.post(
    "/companies/:companyId/jarvis/conversations/clear",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : null;

      const where = userActorId
        ? and(
            eq(jarvisConversations.companyId, companyId),
            eq(jarvisConversations.userActorId, userActorId),
            isNull(jarvisConversations.clearedAt),
          )
        : and(
            eq(jarvisConversations.companyId, companyId),
            isNull(jarvisConversations.clearedAt),
          );

      // Commit + reset the long-term memory session for this actor BEFORE we
      // soft-hide the rows: extraction folds the just-ended session into
      // OpenViking long-term memory, then the next turn opens a fresh session.
      // Best-effort — a down/slow OpenViking never blocks the clear.
      const longTerm = await commitAndResetSession({
        companyId,
        userActorId: userActorId ?? "unknown",
      }).catch((err) => {
        logger.warn({ err, companyId }, "jarvis/clear: OpenViking commit failed");
        return { committed: false, sessionId: null };
      });

      // Capture the session about to be cleared, then archive it VERBATIM:
      // write the full transcript to disk and ingest it into OpenViking as a
      // RESOURCE (resources preserve exact content far better than session
      // extraction's distillation, so verbatim long-term recall is possible).
      // Fire-and-forget so the Clear click never blocks. We read the rows
      // BEFORE stamping cleared_at, while they still match `where`.
      const clearedAt = new Date();
      const sessionTurns = await db
        .select({
          userTranscript: jarvisConversations.userTranscript,
          agentReply: jarvisConversations.agentReply,
        })
        .from(jarvisConversations)
        .where(where)
        .orderBy(asc(jarvisConversations.createdAt));
      void archiveSessionAsResource({
        companyId,
        userActorId: userActorId ?? "unknown",
        turns: sessionTurns,
        clearedAt,
      });

      const cleared = await db
        .update(jarvisConversations)
        .set({ clearedAt })
        .where(where)
        .returning({ id: jarvisConversations.id });

      res.json({
        ok: true,
        cleared: cleared.length,
        longTermCommitDispatched: longTerm.committed,
        archivedTurns: sessionTurns.length,
      });
    },
  );

    /**
   * projectizePlan — convert approved plan steps into Goal + Project + Issues
   */
  router.post(
    "/companies/:companyId/jarvis/projectize",
    validate(
      z.object({
        title: z.string().min(1).max(200),
        brief: z.string().max(20000).optional(),
        steps: z
          .array(
            z.object({
              label: z.string().max(400),
              duration: z.string().max(80).optional(),
            }),
          )
          .min(1)
          .max(40),
      }),
    ),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const body = req.body;
      const actor = req.actor;

      const result = await projectizePlan(db, {
        companyId,
        title: body.title,
        brief: body.brief,
        steps: body.steps,
        createdByUserId:
          actor.type === "board" && "userId" in actor && actor.userId
            ? actor.userId
            : null,
        createdByAgentId:
          actor.type === "agent" && "agentId" in actor ? actor.agentId : null,
      });

      res.status(201).json(result);
    },
  );

  /**
   * Send-to-Brainstorm kickoff. EXPLICIT trigger from the War Room
   * Conversation view (never fires on ambiguous agreement). Hermes distills
   * the session into a PROJECT BRIEF, opens a `type:"mission"` planning room,
   * seeds it, and starts a BOUNDED Hermes<->Brainstorm planning loop whose
   * turns stream into the Brainstorm tab via the existing room transport.
   * Real model lanes (Hermes lane + GLM-5.2 critic lane) — no faked turns.
   */
  const brainstormKickoffSchema = z.object({
    title: z.string().max(120).optional(),
    brief: z.string().max(8000).optional(),
    seedText: z.string().max(8000).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/brainstorm/kickoff",
    validate(brainstormKickoffSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { title, brief, seedText } = req.body as z.infer<
        typeof brainstormKickoffSchema
      >;
      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : null;

      const result = await kickoffBrainstorm(db, {
        companyId,
        userActorId,
        createdBy: userActorId,
        title,
        brief,
        seedText,
      });
      res.json(result);
    },
  );

  /**
   * Zeus Plan kickoff - from the Tasks board IntentBox.
   * Zeus (DeepSeek / planner) produces the initial draft plan, then sends it
   * to Brainstorm (GLM-5.2 / critic) for critique. Both iterate to convergence.
   *
   * Pipeline: intent -> Zeus (plan) -> Brainstorm (critique) -> DraftPlanReview
   */
  const zeusPlanSchema = z.object({
    title: z.string().min(1).max(120),
    brief: z.string().min(1).max(8000),
  });
  router.post(
    "/companies/:companyId/jarvis/zeus/plan",
    validate(zeusPlanSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { title, brief } = req.body as z.infer<typeof zeusPlanSchema>;
      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : null;

      const result = await kickoffZeusPlan(db, {
        companyId,
        userActorId,
        createdBy: userActorId,
        title,
        brief,
      });
      res.json(result);
    },
  );


  /**
   * Approve & send to team. The War Room plan card calls this when Tyler
   * approves a proposed plan. It records the approval and hands the plan to
   * ARES (the COO / distributor) over the REAL delegation/handoff path
   * (dispatchDelegation -> persists a jarvis_delegations row -> POSTs the
   * plan to the bridge's /jarvis/dispatch as identity "ares"). Ares then fans
   * the steps out to the fleet. This is the deferred Hermes->Ares handoff,
   * now wired to the mechanism that already exists — no faked success.
   *
   * Returns the delegation id + reachability so the UI can show exactly where
   * the plan landed ("Sent to Ares") or that the bridge is down (queued).
   */
  const planApproveSchema = z.object({
    title: z.string().min(1).max(200),
    steps: z
      .array(
        z.object({
          n: z.number().int().optional(),
          label: z.string().max(400),
          duration: z.string().max(80).optional(),
        }),
      )
      .max(40)
      .optional(),
    conversationId: z.string().optional(),
    estimatedCompletion: z.string().max(120).optional(),
    agentsInvolved: z.number().int().optional(),
    // Optional raw FINAL-PLAN artifact text. If it carries a fenced
    // ```tools-required``` block, the parsed manifest rides metadata to the
    // worker (dynamic-tool-loading Part B). Optional/back-compat: absent =
    // lean context7 baseline.
    planText: z.string().max(20000).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/plan/approve",
    validate(planApproveSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof planApproveSchema>;
      const actor = req.actor;
      const userActorId =
        actor.type === "board" && "userId" in actor && actor.userId
          ? actor.userId
          : actor.type === "agent" && "agentId" in actor && actor.agentId
            ? actor.agentId
            : null;

      // Build the human-readable task brief Ares receives.
      const steps = body.steps ?? [];
      const stepLines = steps
        .map((s, i) => `${s.n ?? i + 1}. ${s.label}${s.duration ? `  (${s.duration})` : ""}`)
        .join("\n");
      const task =
        `APPROVED PLAN — ${body.title}\n` +
        (stepLines ? `${stepLines}\n` : "") +
        `\nApproved by Tyler in the War Room. Distribute these steps across the ` +
        `fleet and assign an owner to each.`;

      // dynamic-tool-loading (Part B / Phase 2a): parse the optional
      // tools-required manifest out of the plan artifact and attach it to the
      // delegation metadata. It rides payload.metadata to {bridge}/jarvis/dispatch
      // unchanged. Absent/malformed => null => lean context7 baseline downstream.
      const planArtifactText = [
        body.planText ?? "",
        body.title,
        ...steps.map((s) => s.label),
      ].join("\n");
      const toolsRequired = parseToolsRequired(planArtifactText);

      const dispatch = await dispatchDelegation(db, {
        companyId,
        conversationId: body.conversationId ?? null,
        agent: "ares",
        task,
        metadata: {
          kind: "plan-approval",
          plan: {
            title: body.title,
            steps,
            estimatedCompletion: body.estimatedCompletion ?? null,
            agentsInvolved: body.agentsInvolved ?? null,
          },
          approvedAt: new Date().toISOString(),
          ...(toolsRequired ? { tools_required: toolsRequired } : {}),
        },
        requestedByActorId: userActorId,
      });

      res.json({
        ok: dispatch.status !== "failed",
        delegationId: dispatch.id || null,
        agent: "ares",
        status: dispatch.status,
        reachable: dispatch.reachable,
        remainingQuotaThisMinute: dispatch.remainingQuotaThisMinute,
        error: dispatch.error ?? null,
      });
    },
  );

  /**
   * Tools — read-only safe operations Augi calls directly without
   * confirmation. Writes / sends / deletes go through the confirmation
   * registry (POST /jarvis/confirm/:id) and only fire after Tyler
   * approves in the chat UI.
   */
  router.get("/companies/:companyId/jarvis/tools/calendar", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    const hours = Number.parseInt(String(req.query.windowHours ?? "24"), 10);
    const out = await calendarUpcoming(Number.isFinite(hours) ? hours : 24);
    res.status(out.ok ? 200 : 500).json(out);
  });

  router.get("/companies/:companyId/jarvis/tools/reminders", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    const out = await remindersOpen();
    res.status(out.ok ? 200 : 500).json(out);
  });

  router.get("/companies/:companyId/jarvis/tools/messages", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    const limit = Number.parseInt(String(req.query.limit ?? "10"), 10);
    const out = await messagesRecent(Number.isFinite(limit) ? limit : 10);
    res.status(out.ok ? 200 : 500).json(out);
  });

  const fsListSchema = z.object({
    path: z.string().min(1).max(2000),
  });
  router.post(
    "/companies/:companyId/jarvis/tools/fs/list",
    validate(fsListSchema),
    async (req, res) => {
      assertCompanyAccess(req, req.params.companyId as string);
      const { path: target } = req.body as z.infer<typeof fsListSchema>;
      const out = await fsList(target);
      res.status(out.ok ? 200 : 500).json(out);
    },
  );

  const fsSearchSchema = z.object({
    path: z.string().min(1).max(2000),
    query: z.string().min(1).max(200),
    maxResults: z.number().int().positive().max(200).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/tools/fs/search",
    validate(fsSearchSchema),
    async (req, res) => {
      assertCompanyAccess(req, req.params.companyId as string);
      const { path: target, query, maxResults } = req.body as z.infer<typeof fsSearchSchema>;
      const out = await fsSearch(target, query, { maxResults });
      res.status(out.ok ? 200 : 500).json(out);
    },
  );

  const shellExecSchema = z.object({
    cmd: z.string().min(1).max(2000),
    cwd: z.string().max(2000).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/tools/shell",
    validate(shellExecSchema),
    async (req, res) => {
      assertCompanyAccess(req, req.params.companyId as string);
      const { cmd, cwd } = req.body as z.infer<typeof shellExecSchema>;
      const out = await shellExec(cmd, { cwd });
      res.status(out.ok ? 200 : 500).json(out);
    },
  );

  /**
   * Confirmation execution path for irreversible actions. Brain emits a
   * pending PendingConfirmation; client renders the yes/no card; on
   * approve, this endpoint pulls the entry from the registry and runs.
   * Returns 410 if expired (5min TTL) or already consumed.
   */
  router.post(
    "/companies/:companyId/jarvis/confirm/:id",
    async (req, res) => {
      assertCompanyAccess(req, req.params.companyId as string);
      const entry = consumeConfirmation(req.params.id as string);
      if (!entry) {
        res.status(410).json({
          ok: false,
          error: "Confirmation has expired or was already consumed. Re-ask Augi to redo the action.",
        });
        return;
      }
      // Write/send tool execution lands in a follow-up; for now the
      // registry round-trip is enough to validate the contract.
      res.json({
        ok: true,
        message: `Acknowledged ${entry.toolName}. Live execution wiring lands in the follow-up commit.`,
        entry,
      });
    },
  );

  /**
   * Capability surface — reports what Augi can actually do on this host.
   * Cached for 10 minutes; ?refresh=1 forces a re-probe. Tyler hits this
   * from the Capabilities panel + the persona uses it to ground "what
   * can you do" replies in real probe results.
   */
  router.get("/companies/:companyId/jarvis/capabilities", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const snapshot = await getCapabilitySnapshot({ refresh });
    res.json(snapshot);
  });

  /**
   * Lists available ElevenLabs voices. Pre-made voices are hardcoded
   * (their IDs are stable across the ElevenLabs catalog); cloned voices
   * are stored client-side in localStorage in Commit 6 — a follow-up will
   * persist them to a company_jarvis_settings row once the ElevenLabs
   * proxy lands.
   */
  router.get("/companies/:companyId/jarvis/voices", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const elevenlabsKey = await getRawKey("elevenlabs").catch(() => null);
    res.json({
      elevenlabsConfigured: !!elevenlabsKey,
      voices: PREMADE_ELEVENLABS_VOICES,
    });
  });

  /**
   * Stub for now. Real ElevenLabs proxy (POST /v1/voices/add) lands with
   * the Premium tier handlers. Returns 501 with a helpful message if the
   * key isn't configured.
   */
  router.post("/companies/:companyId/jarvis/voice/clone", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const elevenlabsKey = await getRawKey("elevenlabs").catch(() => null);
    if (!elevenlabsKey) {
      res.status(501).json({
        error: "elevenlabs_not_configured",
        message:
          "Connect an ElevenLabs API key in Fleet → Provider Keys to enable voice cloning.",
      });
      return;
    }
    // Real proxy lands in a follow-up. For now: return a "ready to clone"
    // ack so the client wizard can preview the flow without hitting
    // ElevenLabs's billing endpoint.
    res.status(202).json({
      status: "stub",
      message:
        "ElevenLabs key configured. The real /v1/voices/add proxy ships with the Premium tier handlers.",
    });
  });

  /**
   * Voice preview — synthesizes a sample sentence in the selected voice.
   * Without an ElevenLabs key, the client falls back to browser TTS
   * directly, so this endpoint primarily exists as a contract anchor.
   */
  router.post("/companies/:companyId/jarvis/voice/preview", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const elevenlabsKey = await getRawKey("elevenlabs").catch(() => null);
    res.json({
      elevenlabsConfigured: !!elevenlabsKey,
      // Client uses this flag to pick browser TTS vs server-streamed audio.
      // Real audio stream lands with Premium tier handlers.
      previewAudioUrl: null,
    });
  });

  /**
   * Streaming TTS proxy — synthesizes `text` via ElevenLabs Turbo v2.5 and
   * pipes the audio bytes (mp3) directly to the browser. The client wraps
   * the stream in an HTMLAudioElement (or MediaSource) and only falls back
   * to browser SpeechSynthesis when this endpoint returns a non-2xx.
   *
   * Upstream errors are surfaced with their original status (401/402 -> the
   * key is dead or out of quota; the UI uses this to switch the "Voice
   * Models" badge to BROWSER TTS with an explanation). 501 means no key is
   * configured at all.
   */
  const ttsSchema = z.object({
    text: z.string().min(1).max(4_000),
    voiceId: z.string().min(1).max(80).optional(),
    modelId: z.string().min(1).max(80).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/voice/tts",
    validate(ttsSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { text, voiceId, modelId } = req.body as z.infer<typeof ttsSchema>;

      const elevenlabsKey = await getRawKey("elevenlabs").catch(() => null);
      if (!elevenlabsKey) {
        res.status(501).json({
          error: "elevenlabs_not_configured",
          message:
            "No ElevenLabs key is configured. Add one in Fleet → Provider Keys, or the client will fall back to browser TTS.",
        });
        return;
      }

      const vid = (voiceId && voiceId.trim()) || "pNInz6obpgDQGcFmaJgB"; // Adam
      const mid = (modelId && modelId.trim()) || "eleven_turbo_v2_5";

      // ElevenLabs' streaming endpoint returns chunked mp3. We pipe the
      // upstream Response.body straight through res so the browser starts
      // playing while the rest of the synthesis is still arriving.
      let upstream: Response;
      try {
        upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}/stream?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": elevenlabsKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text,
              model_id: mid,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0,
                use_speaker_boost: true,
              },
            }),
          },
        );
      } catch (err) {
        logger.warn({ err, companyId }, "jarvis/voice/tts: upstream fetch failed");
        res.status(502).json({
          error: "elevenlabs_unreachable",
          message: (err as Error).message,
        });
        return;
      }

      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        logger.warn(
          { companyId, status: upstream.status, detail: detail.slice(0, 200) },
          "jarvis/voice/tts: elevenlabs returned non-2xx",
        );
        // Mirror upstream status so the client can distinguish 401 (bad
        // key) / 402 (out of quota) / 5xx (transient) and decide whether
        // to surface a permanent fallback or retry.
        res.status(upstream.status).json({
          error: "elevenlabs_upstream_error",
          status: upstream.status,
          detail: detail.slice(0, 500),
        });
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Voice-Provider", "elevenlabs");
      res.setHeader("X-Voice-Model", mid);
      res.setHeader("X-Voice-Id", vid);

      // Stream the chunked mp3 body straight through to the client. Using
      // a manual reader instead of Readable.fromWeb keeps the dep surface
      // tight and works the same on Node 18+ and 20+.
      const reader = upstream.body.getReader();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) res.write(Buffer.from(value));
        }
        res.end();
      } catch (err) {
        logger.warn({ err, companyId }, "jarvis/voice/tts: stream pipe failed");
        try {
          res.end();
        } catch {}
      }
    },
  );

  /**
   * Mints a short-lived OpenAI Realtime ephemeral key so the browser can
   * open a WebRTC session for full-duplex barge-in detection without
   * exposing the company's long-lived openai_realtime secret.
   *
   * Returns 501 when no openai_realtime key is configured; the client
   * degrades to local-VAD fallback in that case (pause TTS on detected
   * speech, no realtime ack).
   */
  const realtimeTokenSchema = z.object({
    model: z.string().min(1).max(120).optional(),
    voice: z.string().min(1).max(40).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/realtime-token",
    validate(realtimeTokenSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof realtimeTokenSchema>;
      try {
        const minted = await mintRealtimeEphemeralKey({
          model: body.model,
          voice: body.voice,
        });
        if (!minted) {
          res.status(501).json({
            error: "openai_realtime_not_configured",
            message:
              "Connect an openai_realtime key in Fleet → Provider Keys to enable Premium barge-in.",
          });
          return;
        }
        res.json(minted);
      } catch (err) {
        res.status(502).json({
          error: "openai_realtime_mint_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * Cancel an in-flight Jarvis reply because Tyler started speaking. The
   * client posts here the moment its VAD or OpenAI Realtime VAD fires;
   * the server marks the conversation row as interrupted (so the chat
   * history shows the "— interrupted" tag) and broadcasts a cancel
   * signal on the in-process barge-in bus so any streaming consumer can
   * tear down its pipe immediately.
   *
   * conversationId is optional: barge-in can fire before the reply has
   * a row yet (Claude is still composing) — in that case we only emit
   * the cancel signal and the streaming consumer aborts the outbound
   * write itself.
   */
  const cancelResponseSchema = z.object({
    conversationId: z.string().uuid().nullable().optional(),
    reason: z.enum(["user_speech", "manual", "timeout"]).default("user_speech"),
    /** Characters of agent_reply the client actually spoke before cutting. */
    spokenChars: z.number().int().nonnegative().nullable().optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/cancel-response",
    validate(cancelResponseSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { conversationId, reason, spokenChars } = req.body as z.infer<
        typeof cancelResponseSchema
      >;

      const interruptedAt = new Date();
      let updated = false;
      if (conversationId) {
        try {
          const result = await db
            .update(jarvisConversations)
            .set({
              interruptedAt,
              interruptedAtChars: spokenChars ?? null,
            })
            .where(
              and(
                eq(jarvisConversations.id, conversationId),
                eq(jarvisConversations.companyId, companyId),
              ),
            )
            .returning({ id: jarvisConversations.id });
          updated = result.length > 0;
        } catch {
          updated = false;
        }
      }

      const event: BargeInCancelEvent = {
        conversationId: conversationId ?? null,
        reason,
        atMs: interruptedAt.getTime(),
        spokenChars: spokenChars ?? null,
      };
      bargeInBus.emit(companyId, event);

      res.json({
        ok: true,
        interruptedAt: interruptedAt.toISOString(),
        persisted: updated,
      });
    },
  );

  /**
   * SSE feed of barge-in cancellation events. A future streaming voice
   * endpoint subscribes to this to abort outbound writes the instant
   * Tyler interrupts. Today it's also useful for debugging — open in a
   * terminal with `curl -N .../barge-in/stream` to watch interrupts fire
   * live as you talk over Jarvis.
   */
  router.get(
    "/companies/:companyId/jarvis/barge-in/stream",
    (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const conversationId = (req.query.conversationId as string) || null;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(":ok\n\n");

      let closed = false;
      const unsubscribe = bargeInBus.subscribe(companyId, conversationId, (event) => {
        if (closed || !res.writable) return;
        try {
          res.write(`event: cancel\n`);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // Connection dropped; treat as closed below.
        }
      });

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          res.end();
        } catch {}
      };
      req.on("close", close);
      res.on("error", close);
    },
  );

  /**
   * Reports which Jarvis voice tiers are currently available based on
   * configured provider keys. The client uses this to enable/disable the
   * tier picker rows and pick the highest-available tier by default.
   *
   * Cost estimates are rough monthly figures at ~5 minutes of conversation
   * per day — surfaces "how much will this cost me" without forcing Tyler
   * to do napkin math. Latency is the typical voice-to-voice round trip.
   */
  router.get("/companies/:companyId/jarvis/voice/tiers", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const [openaiKey, openaiRealtimeKey, elevenlabsKey] = await Promise.all([
      getRawKey("openai").catch(() => null),
      getRawKey("openai_realtime").catch(() => null),
      getRawKey("elevenlabs").catch(() => null),
    ]);

    const tiers = [
      {
        id: "premium",
        label: "Premium",
        available: !!(openaiRealtimeKey && elevenlabsKey),
        latencyEstimateMs: 800,
        monthlyCostUsdAt5min: 45,
        costPerMinUsd: 0.04,
        providers: ["openai_realtime", "elevenlabs"] as const,
        description: "OpenAI Realtime STT + ElevenLabs Turbo v2.5 TTS. Sub-1s voice-to-voice.",
      },
      {
        id: "standard",
        label: "Standard",
        available: !!openaiKey,
        latencyEstimateMs: 1500,
        monthlyCostUsdAt5min: 8,
        costPerMinUsd: 0.007,
        providers: ["openai"] as const,
        description: "OpenAI Whisper STT + TTS-1. ~1.5s voice-to-voice.",
      },
      {
        id: "browser-native",
        label: "Free",
        available: true,
        latencyEstimateMs: 1800,
        monthlyCostUsdAt5min: 0,
        costPerMinUsd: 0,
        providers: [] as const,
        description: "Browser SpeechRecognition + SpeechSynthesis. No keys needed.",
      },
    ];

    res.json({ tiers });
  });

  // ============================================================================
  // Per-company Jarvis settings
  // ============================================================================

  /**
   * Read the company's Jarvis settings. Returns the row's values when one
   * exists; otherwise returns the documented defaults (no row creation here —
   * a write through PATCH lazily upserts the row).
   */
  router.get(
    "/companies/:companyId/jarvis/settings",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const row = await db
        .select({ autoBriefOnLoad: companyJarvisSettings.autoBriefOnLoad })
        .from(companyJarvisSettings)
        .where(eq(companyJarvisSettings.companyId, companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      res.json({
        autoBriefOnLoad: row?.autoBriefOnLoad ?? false,
      });
    },
  );

  /**
   * Patch one or more Jarvis settings. Upserts the row so the first PATCH
   * after migration installs the row with the supplied values + defaults
   * for omitted fields.
   */
  const settingsPatchSchema = z.object({
    autoBriefOnLoad: z.boolean().optional(),
  });
  router.patch(
    "/companies/:companyId/jarvis/settings",
    validate(settingsPatchSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof settingsPatchSchema>;
      const now = new Date();
      const row = await db
        .insert(companyJarvisSettings)
        .values({
          companyId,
          autoBriefOnLoad: body.autoBriefOnLoad ?? false,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: companyJarvisSettings.companyId,
          set: {
            ...(body.autoBriefOnLoad !== undefined
              ? { autoBriefOnLoad: body.autoBriefOnLoad }
              : {}),
            updatedAt: now,
          },
        })
        .returning({ autoBriefOnLoad: companyJarvisSettings.autoBriefOnLoad });
      res.json({
        autoBriefOnLoad: row[0]?.autoBriefOnLoad ?? false,
      });
    },
  );

  // ============================================================================
  // Peer-agent delegations
  // ============================================================================

  /**
   * List delegations for a company. Filtered by status so the client can
   * poll `?status=running` every 30s without paging the entire table.
   */
  router.get(
    "/companies/:companyId/jarvis/delegations",
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
      const conversationId =
        typeof req.query.conversationId === "string" ? req.query.conversationId : undefined;
      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
        200,
      );
      const allowed = new Set(["queued", "running", "completed", "failed"]);
      const status = statusParam && allowed.has(statusParam)
        ? (statusParam as "queued" | "running" | "completed" | "failed")
        : undefined;
      const rows = await listDelegations(db, companyId, { status, conversationId, limit });
      res.json({ delegations: rows });
    },
  );

  /**
   * Result callback — the peer agent (Hermes, August, Codex, …) posts
   * here when it completes its work. Authentication is the per-row
   * callback token issued at dispatch time, NOT the standard board key.
   * We sidestep the actor middleware via the `_publicDelegationCallback`
   * marker so the bridge daemon can post without paperclip credentials.
   */
  const callbackSchema = z.object({
    status: z.enum(["running", "completed", "failed"]),
    result: z.string().max(64_000).optional(),
    error: z.string().max(4_000).optional(),
  });
  router.post(
    "/companies/:companyId/jarvis/delegations/:id/result",
    validate(callbackSchema),
    async (req, res) => {
      const { companyId, id } = req.params as { companyId: string; id: string };
      const header = (req.headers.authorization ?? "").trim();
      const match = header.match(/^bearer\s+(.+)$/i);
      if (!match) {
        res.status(401).json({ ok: false, error: "missing_bearer_token" });
        return;
      }
      const callbackToken = match[1]!.trim();
      const body = req.body as z.infer<typeof callbackSchema>;
      const out = await recordDelegationResult(db, {
        delegationId: id,
        companyId,
        callbackToken,
        status: body.status,
        result: body.result,
        error: body.error,
      });
      if (!out.ok) {
        res.status(out.error === "callback_token_mismatch" ? 403 : 404).json({
          ok: false,
          error: out.error,
        });
        return;
      }
      res.json({ ok: true });
    },
  );

  /**
   * Reachability probe — used by the UI / brain to verify whether a peer
   * is up before offering to delegate. Cached server-side for 30s.
   */
  router.get(
    "/companies/:companyId/jarvis/delegations/peers/:peer/reachable",
    async (req, res) => {
      const { companyId, peer } = req.params as { companyId: string; peer: string };
      assertCompanyAccess(req, companyId);
      const allowed: PeerAgentId[] = [
        "hermes",
        "august",
        "codex",
        "content",
        "social",
        "researcher",
        "claude-code",
      ];
      if (!allowed.includes(peer as PeerAgentId)) {
        res.status(400).json({ ok: false, error: "unknown_peer" });
        return;
      }
      const out = await checkPeerReachable(peer as PeerAgentId);
      res.json(out);
    },
  );

  /**
   * Complete (archive) a Jarvis/Brainstorm room. Sets status=archived,
   * stamps completed_at, returns the full transcript, and optionally
   * writes the session to the Obsidian vault via the obsidian-brain API.
   */
  router.post(
    "/companies/:companyId/jarvis/rooms/:roomId/complete",
    async (req, res) => {
      const { companyId, roomId } = req.params as { companyId: string; roomId: string };
      assertCompanyAccess(req, companyId);

      const room = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      // Collect the full transcript
      const messages = await db
        .select()
        .from(roomMessages)
        .where(eq(roomMessages.roomId, roomId))
        .orderBy(asc(roomMessages.createdAt));

      // Archive the room
      const now = new Date();
      await db
        .update(rooms)
        .set({ status: "archived", completedAt: now, updatedAt: now })
        .where(eq(rooms.id, roomId));

      // Log activity
      const actor = req.actor;
      void logActivity(db, {
        companyId,
        actorType: actor.type,
        actorId: actor.type === "board" && "userId" in actor ? actor.userId : actor.type === "agent" && "agentId" in actor ? actor.agentId : "unknown",
        action: "room.completed",
        entityType: "room",
        entityId: roomId,
        details: { name: room.name, messageCount: messages.length },
      });

      const transcript = messages.map((m) => ({
        senderId: m.senderId,
        senderName: m.senderName,
        senderType: m.senderType,
        content: m.content,
        createdAt: m.createdAt,
      }));

      // Best-effort: POST transcript to obsidian-brain for vault archiving
      void (async () => {
        try {
          const health = await fetch("http://100.68.190.105:18791/health", {
            signal: AbortSignal.timeout(3000),
          });
          if (!health.ok) return;

          const date = now.toISOString().slice(0, 10);
          const topic = (room.name ?? "session").replace(/[\\/:*?"<>|]/g, "-");
          const mdTitle = `${date}-${topic}`;

          await fetch("http://100.68.190.105:18791/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: mdTitle,
              content: transcript
                .map((t) =>
                  `**${t.senderName ?? t.senderId}** (${t.senderType}) — ${new Date(t.createdAt as Date).toLocaleTimeString()}\n\n${t.content}`
                )
                .join("\n\n---\n\n"),
              directory: "07 - Sessions/Brainstorm",
              frontmatter: {
                date: now.toISOString(),
                room_type: room.type,
                participants: [],
                topic,
              },
            }),
            signal: AbortSignal.timeout(5000),
          });
          logger.info({ roomId, vaultPath: `07 - Sessions/Brainstorm/${mdTitle}.md` }, "room: vault archive written");
        } catch {
          // vault unreachable — non-blocking
        }
      })();

      res.json({
        ok: true,
        roomId,
        roomName: room.name,
        completedAt: now.toISOString(),
        transcript,
        messageCount: messages.length,
      });
    },
  );

  return router;
}

/**
 * 4 hours per source — matches the Mac-wake watcher's debounce so a flurry
 * of wake-from-sleep events doesn't carpet-bomb Augi. The `manual` source
 * (Brief-me button) bypasses this via the company-scoped endpoint which has
 * no debounce.
 */
const DADDYS_HOME_DEBOUNCE_MS = 4 * 60 * 60 * 1000;
const daddysHomeDebounce = new Map<string, number>();

function isLoopback(ip: string): boolean {
  if (!ip) return false;
  const cleaned = ip.replace(/^::ffff:/, "");
  return (
    cleaned === "127.0.0.1" ||
    cleaned === "::1" ||
    cleaned === "localhost" ||
    cleaned.startsWith("127.")
  );
}

interface DaddysHomeDispatchInput {
  companyId: string;
  userActorId: string;
  voiceTier?: string;
  source: string;
}

interface DaddysHomeDispatchResult {
  briefingText: string;
  recommendedAction: string;
  briefingPayload: BriefingPayload;
  tier: string;
  latencyMs: number;
  llmProvider: string | null;
  llmModel: string | null;
  personaVersion: string;
  personaSource: "file" | "fallback";
  responseType: string;
  truncated: boolean;
  audioStreamUrl: null;
  conversationId: null;
  /** True when this response was served from the 5-minute dedupe window. */
  deduped: boolean;
}

/**
 * Shared briefing dispatcher used by both the company-scoped endpoint
 * (Brief-me button + scheduled routine) and the loopback trigger (Mac-wake).
 * Gathers the briefing payload, hands it to jarvisBrainReply as a
 * customUserPrompt (so the brain skips its default standard/briefing
 * composer and uses our richer payload-grounded prompt instead), then
 * extracts the recommended-action sentence for the orb-center CTA.
 */
async function dispatchDaddysHome(
  db: Db,
  input: DaddysHomeDispatchInput,
): Promise<DaddysHomeDispatchResult> {
  // Cross-source dedupe: when a fresh briefing exists for this company within
  // the dedupe window, return that row instead of firing a new LLM call. Fixes
  // the failure mode where the client auto-trigger, the Mac-wake watcher, and
  // the manual "Brief me" button each landed their own briefing inside the
  // same minute and the chat panel showed three identical replies in a row.
  const fresh = await findRecentBriefing(db, input.companyId, BRIEFING_DEDUPE_WINDOW_MS);
  if (fresh) {
    return {
      briefingText: fresh.agentReply,
      recommendedAction: extractRecommendedAction(fresh.agentReply),
      briefingPayload: (fresh.contextSnapshot as BriefingPayload | null) ??
        (await gatherBriefingPayload(db, input.companyId)),
      tier: input.voiceTier ?? "browser-native",
      latencyMs: 0,
      llmProvider: fresh.llmProvider,
      llmModel: fresh.llmModel,
      personaVersion: fresh.personaVersion ?? "cached",
      personaSource: "file",
      responseType: fresh.responseType ?? "briefing",
      truncated: false,
      audioStreamUrl: null,
      conversationId: null,
      deduped: true,
    };
  }

  const payload = await gatherBriefingPayload(db, input.companyId);
  const userPrompt = composeBriefingTranscript(payload, input.source);

  const out = await jarvisBrainReply(db, {
    companyId: input.companyId,
    userActorId: input.userActorId,
    transcript: "Daddy's Home morning briefing",
    voiceTier: input.voiceTier,
    voiceMode: true,
    responseType: "briefing",
    source: input.source,
    customUserPrompt: userPrompt,
    customContextSnapshot: payload as unknown as Record<string, unknown>,
  });

  return {
    briefingText: out.reply,
    recommendedAction: extractRecommendedAction(out.reply),
    briefingPayload: payload,
    tier: input.voiceTier ?? "browser-native",
    latencyMs: out.latencyMs,
    llmProvider: out.llmProvider,
    llmModel: out.llmModel,
    personaVersion: out.personaVersion,
    personaSource: out.personaSource,
    responseType: out.responseType,
    truncated: out.truncated,
    audioStreamUrl: null,
    conversationId: null,
    deduped: false,
  };
}

/**
 * Five-minute briefing-dedupe window. Any source that funnels into
 * dispatchDaddysHome (client auto-trigger, Mac-wake watcher, manual button,
 * scheduled cron) shares this window — if any of them has landed a briefing
 * for the company in the last five minutes, every subsequent caller reads
 * that row instead of spinning the LLM again.
 */
const BRIEFING_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const BRIEFING_SOURCES = ["daddys_home", "mac-wake", "schedule", "manual"] as const;

interface RecentBriefing {
  agentReply: string;
  contextSnapshot: Record<string, unknown> | null;
  llmProvider: string | null;
  llmModel: string | null;
  personaVersion: string | null;
  responseType: string | null;
}

async function findRecentBriefing(
  db: Db,
  companyId: string,
  windowMs: number,
): Promise<RecentBriefing | null> {
  try {
    const since = new Date(Date.now() - windowMs);
    const rows = await db
      .select({
        agentReply: jarvisConversations.agentReply,
        contextSnapshot: jarvisConversations.contextSnapshot,
        llmProvider: jarvisConversations.llmProvider,
        llmModel: jarvisConversations.llmModel,
        personaVersion: jarvisConversations.personaVersion,
        responseType: jarvisConversations.responseType,
        createdAt: jarvisConversations.createdAt,
      })
      .from(jarvisConversations)
      .where(
        and(
          eq(jarvisConversations.companyId, companyId),
          inArray(jarvisConversations.source, BRIEFING_SOURCES as unknown as string[]),
          gte(jarvisConversations.createdAt, since),
        ),
      )
      .orderBy(desc(jarvisConversations.createdAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, companyId }, "daddys-home: dedupe lookup failed");
    return null;
  }
}

/**
 * ElevenLabs's stable pre-made voice catalog. IDs are taken from the
 * documented sample voices and are the same for every account.
 */
const PREMADE_ELEVENLABS_VOICES = [
  { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam", style: "deep · calm · British", premade: true },
  { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Bella", style: "soft · warm · American", premade: true },
  { voiceId: "nPczCjzI2devNBz1zQrb", name: "Brian", style: "narrative · British", premade: true },
  { voiceId: "IKne3meq5aSn9XLyUdCD", name: "Charlie", style: "casual · Australian", premade: true },
  { voiceId: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", style: "youthful · American", premade: true },
  { voiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", style: "calm · American · narrator", premade: true },
  { voiceId: "AZnzlk1XvdvUeBnXmlld", name: "Domi", style: "strong · confident · American", premade: true },
  { voiceId: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", style: "young · emotional", premade: true },
];

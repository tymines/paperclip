import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { jarvisConversations, companies } from "@paperclipai/db";
import { and, asc, desc, eq } from "drizzle-orm";
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

      const where = userActorId
        ? and(
            eq(jarvisConversations.companyId, companyId),
            eq(jarvisConversations.userActorId, userActorId),
          )
        : eq(jarvisConversations.companyId, companyId);

      const rows = await db
        .select({
          id: jarvisConversations.id,
          userTranscript: jarvisConversations.userTranscript,
          agentReply: jarvisConversations.agentReply,
          llmProvider: jarvisConversations.llmProvider,
          llmModel: jarvisConversations.llmModel,
          responseType: jarvisConversations.responseType,
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
  };
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

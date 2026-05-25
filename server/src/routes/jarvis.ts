import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { jarvisBrainReply } from "../services/jarvis-brain.js";
import { getRawKey } from "../services/provider-api-keys/index.js";
import { getCapabilitySnapshot } from "../services/jarvis-capabilities.js";

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

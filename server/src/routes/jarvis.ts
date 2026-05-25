import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { jarvisBrainReply } from "../services/jarvis-brain.js";
import { getRawKey } from "../services/provider-api-keys/index.js";

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
});

export function jarvisRoutes(db: Db) {
  const router = Router();

  router.post(
    "/companies/:companyId/jarvis/voice",
    validate(voiceRequestSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      const { transcript, voiceTier } = req.body as z.infer<typeof voiceRequestSchema>;

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
      });

      res.json({
        reply: out.reply,
        tier: voiceTier ?? "browser-native",
        latencyMs: out.latencyMs,
        llmProvider: out.llmProvider,
        llmModel: out.llmModel,
        contextSnapshot: out.contextSnapshot,
        conversationId: null,
      });
    }
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

  return router;
}

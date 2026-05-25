import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";

/**
 * Jarvis voice endpoint.
 *
 * Commit 2 ships the plumbing — accepts a transcript from the browser
 * (which handles STT client-side via SpeechRecognition) and returns a
 * placeholder reply. Commit 3 swaps the placeholder for a real Augi
 * dispatch through the OpenClaw bridge with tools, streaming, and
 * conversation persistence. Commit 5 layers OpenAI Realtime + ElevenLabs
 * on top for premium voice; the endpoint contract stays stable.
 */
const voiceRequestSchema = z.object({
  transcript: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

export function jarvisRoutes(_db: Db) {
  const router = Router();

  router.post(
    "/companies/:companyId/jarvis/voice",
    validate(voiceRequestSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      const { transcript } = req.body as z.infer<typeof voiceRequestSchema>;

      // Commit 2 placeholder reply. Swapped in Commit 3 for Augi dispatch.
      const reply = synthesizeStubReply(transcript);

      res.json({
        reply,
        tier: "browser-native",
        latencyMs: 0,
        // Empty for now; populated in Commit 3 with the Augi conversation id
        // saved to the jarvis_conversations table.
        conversationId: null,
      });
    }
  );

  return router;
}

function synthesizeStubReply(transcript: string): string {
  const trimmed = transcript.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered.includes("revenue") || lowered.includes("kpi") || lowered.includes("stats")) {
    return "Revenue month-to-date is up twelve point four percent to eighty-four point two thousand. Real numbers will come from cost-watcher once Augi dispatch lands in commit three.";
  }
  if (lowered.startsWith("search") || lowered.includes("find ")) {
    return "Searching across issues, agents, rooms, and skills. The actual semantic search lands in commit three.";
  }
  if (lowered.includes("schedule") || lowered.includes("remind")) {
    return "I can schedule that for you. The routine and approval wiring lands in commit three.";
  }
  return `I heard: ${trimmed}. Full Augi dispatch arrives in commit three.`;
}

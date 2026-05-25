import { api } from "./client";

export type JarvisVoiceTierId = "premium" | "standard" | "browser-native";

export interface JarvisVoiceRequest {
  transcript: string;
  conversationId?: string;
  voiceTier?: JarvisVoiceTierId;
}

export interface JarvisVoiceResponse {
  reply: string;
  /** "browser-native" | "standard" | "premium" — surfaces which voice tier handled this turn. */
  tier: string;
  latencyMs: number;
  conversationId: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
}

export interface JarvisVoiceTier {
  id: JarvisVoiceTierId;
  label: string;
  available: boolean;
  latencyEstimateMs: number;
  monthlyCostUsdAt5min: number;
  costPerMinUsd: number;
  providers: readonly string[];
  description: string;
}

export interface JarvisVoiceTiersResponse {
  tiers: JarvisVoiceTier[];
}

export const jarvisApi = {
  /**
   * Sends a transcript to the server and returns the agent's reply.
   * Commit 2: placeholder. Commit 3: dispatched through Augi-as-brain
   * with real cost-watcher / blocked-issue / fleet data + LLM call.
   */
  voice: (companyId: string, body: JarvisVoiceRequest): Promise<JarvisVoiceResponse> =>
    api.post(`/api/companies/${companyId}/jarvis/voice`, body),

  /**
   * Reports which voice tiers are currently available based on configured
   * provider keys + their latency / monthly cost estimates.
   */
  voiceTiers: (companyId: string): Promise<JarvisVoiceTiersResponse> =>
    api.get(`/api/companies/${companyId}/jarvis/voice/tiers`),
};

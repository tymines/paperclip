import { api } from "./client";

export type JarvisVoiceTierId = "premium" | "standard" | "browser-native";

export type JarvisResponseType = "quick" | "standard" | "briefing" | "detailed";

export interface JarvisVoiceRequest {
  transcript: string;
  conversationId?: string;
  voiceTier?: JarvisVoiceTierId;
  /** True when the transcript came from the mic — reply will also be spoken. */
  voiceMode?: boolean;
  /** Length-budget hint. Server infers when omitted. */
  responseType?: JarvisResponseType;
}

export interface JarvisVoiceResponse {
  reply: string;
  /** "browser-native" | "standard" | "premium" — surfaces which voice tier handled this turn. */
  tier: string;
  latencyMs: number;
  conversationId: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  /** Content-hash of the persona that produced this reply. */
  personaVersion?: string;
  /** "file" if loaded from disk, "fallback" if the persona file is missing. */
  personaSource?: "file" | "fallback";
  /** Resolved response type after the server's inference pass. */
  responseType?: JarvisResponseType;
  /** True when the API layer trimmed the model output to fit the budget. */
  truncated?: boolean;
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

export interface JarvisVoiceCharacter {
  voiceId: string;
  name: string;
  style: string;
  premade: boolean;
  cloned?: boolean;
}

export interface JarvisVoicesResponse {
  elevenlabsConfigured: boolean;
  voices: JarvisVoiceCharacter[];
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

  /** Lists available ElevenLabs voice characters (pre-made + cloned). */
  voices: (companyId: string): Promise<JarvisVoicesResponse> =>
    api.get(`/api/companies/${companyId}/jarvis/voices`),

  /** Uploads a 30s audio sample to ElevenLabs for cloning. Returns voice_id when configured. */
  cloneVoice: (
    companyId: string,
    body: { name: string; audioBase64: string; mimeType: string }
  ): Promise<{ status: string; voiceId?: string; message?: string }> =>
    api.post(`/api/companies/${companyId}/jarvis/voice/clone`, body),

  /** Returns an audio preview URL for a given voice (or null on browser-fallback). */
  voicePreview: (
    companyId: string,
    body: { voiceId: string }
  ): Promise<{ elevenlabsConfigured: boolean; previewAudioUrl: string | null }> =>
    api.post(`/api/companies/${companyId}/jarvis/voice/preview`, body),
};

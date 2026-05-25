import { api } from "./client";

export interface JarvisVoiceRequest {
  transcript: string;
  conversationId?: string;
}

export interface JarvisVoiceResponse {
  reply: string;
  /** "browser-native" | "standard" | "premium" — surfaces which voice tier handled this turn. */
  tier: string;
  latencyMs: number;
  conversationId: string | null;
}

export const jarvisApi = {
  /**
   * Sends a transcript to the server and returns the agent's reply.
   * Commit 2: server returns a placeholder. Commit 3: dispatched through Augi.
   */
  voice: (companyId: string, body: JarvisVoiceRequest): Promise<JarvisVoiceResponse> =>
    api.post(`/api/companies/${companyId}/jarvis/voice`, body),
};

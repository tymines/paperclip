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
  /** When this turn dispatched a peer-agent delegation. */
  delegation?: JarvisDelegationAck | null;
}

export type JarvisPeerAgentId =
  | "hermes"
  | "august"
  | "codex"
  | "content"
  | "social"
  | "researcher"
  | "claude-code";

export interface JarvisDelegationAck {
  id: string;
  agent: JarvisPeerAgentId;
  status: "queued" | "failed";
  reachable: boolean;
  remainingQuotaThisMinute: number;
}

export interface JarvisDelegationRow {
  id: string;
  companyId: string;
  conversationId: string | null;
  agent: JarvisPeerAgentId;
  task: string;
  status: "queued" | "running" | "completed" | "failed";
  result: string | null;
  metadata: Record<string, unknown> | null;
  requestedByActorId: string | null;
  createdAt: string;
  completedAt: string | null;
  /**
   * Typed worker-status verdict (additive, migration 0131). Null until the
   * worker reports one via the deer-flow sub-agent contract. See
   * ui/src/lib/team-mode-contract.ts.
   */
  workerStatus?: string | null;
  /** Groups a leader-directed fan-out batch (additive, migration 0131). */
  teamRunId?: string | null;
}

export interface JarvisDelegationsResponse {
  delegations: JarvisDelegationRow[];
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

export type JarvisCapabilityStatus = "ready" | "needs_install" | "needs_permission" | "unsupported";
export type JarvisCapabilityGroup = "machine" | "phone" | "apps" | "paperclip" | "web";

export interface JarvisCapability {
  id: string;
  group: JarvisCapabilityGroup;
  label: string;
  status: JarvisCapabilityStatus;
  detail?: string;
  installHint?: string;
  checkMs: number;
}

export interface JarvisCapabilitiesResponse {
  generatedAt: string;
  hostPlatform: string;
  capabilities: JarvisCapability[];
}

export interface JarvisConversationTurn {
  id: string;
  userTranscript: string;
  agentReply: string;
  llmProvider: string | null;
  llmModel: string | null;
  responseType: string | null;
  /** ISO timestamp the user barged in, or null if the reply played to completion. */
  interruptedAt: string | null;
  /** Characters of `agentReply` actually spoken before the cut. */
  interruptedAtChars: number | null;
  createdAt: string;
}

export interface JarvisConversationsResponse {
  conversations: JarvisConversationTurn[];
}

export interface JarvisDaddysHomeRequest {
  voiceTier?: JarvisVoiceTierId;
  source?: "manual" | "mac-wake" | "schedule";
}

export interface JarvisDaddysHomeResponse {
  briefingText: string;
  recommendedAction: string;
  tier: string;
  latencyMs: number;
  llmProvider: string | null;
  llmModel: string | null;
  personaVersion: string;
  personaSource: "file" | "fallback";
  responseType: "briefing";
  truncated: boolean;
  briefingPayload: Record<string, unknown>;
  conversationId: string | null;
}

export interface JarvisHealthResponse {
  ok: boolean;
  version: number;
  llm: { deepseek: boolean; openai: boolean; anthropic: boolean; moonshot: boolean };
  voice: { elevenlabs: boolean; openaiRealtime: boolean };
}

export interface JarvisRealtimeTokenResponse {
  ephemeralKey: string;
  /** Unix epoch seconds. */
  expiresAt: number;
  model: string;
  voice: string;
}

export interface JarvisCancelResponseBody {
  conversationId?: string | null;
  reason?: "user_speech" | "manual" | "timeout";
  /** Characters of TTS playback the client got through before pausing. */
  spokenChars?: number | null;
}

export interface JarvisCancelResponseResult {
  ok: boolean;
  interruptedAt: string;
  persisted: boolean;
}

export interface JarvisCompanySettings {
  /**
   * When true, opening /TYL/jarvis fires the Daddy's Home briefing
   * automatically if the 4-hour debounce has lapsed. Default false —
   * Tyler explicitly disabled this after the page kept auto-briefing
   * him when he just wanted to chat.
   */
  autoBriefOnLoad: boolean;
}

// All paths are RELATIVE to /api — the api client auto-prepends the
// /api base. Don't add "/api/" to these paths or they will double-prefix
// into /api/api/... and 404. This was the actual root cause of the
// "Jarvis is broken" report: every call below was 404ing silently, the
// catch blocks ate the failures, and the chat panel stayed on the
// MOCK_INITIAL_CHAT seed making it LOOK like the backend was responding.
export interface JarvisBrainstormKickoffResponse {
  roomId: string;
  roomName: string;
  title: string;
  brief: string;
}

export interface JarvisPlanApproveRequest {
  title: string;
  steps?: { n?: number; label: string; duration?: string }[];
  conversationId?: string;
  estimatedCompletion?: string;
  agentsInvolved?: number;
}

export interface JarvisPlanApproveResponse {
  ok: boolean;
  delegationId: string | null;
  agent: string;
  status: "queued" | "failed";
  reachable: boolean;
  remainingQuotaThisMinute: number;
  error: string | null;
}

export const jarvisApi = {
  /**
   * Sends a transcript to the server and returns the agent's reply.
   * Dispatched through Augi-as-brain with real cost-watcher /
   * blocked-issue / fleet data + LLM call.
   */
  voice: (companyId: string, body: JarvisVoiceRequest): Promise<JarvisVoiceResponse> =>
    api.post(`/companies/${companyId}/jarvis/voice`, body),

  daddysHome: (
    companyId: string,
    body: JarvisDaddysHomeRequest = {},
  ): Promise<JarvisDaddysHomeResponse> =>
    api.post(`/companies/${companyId}/jarvis/daddys-home`, body),

  /**
   * Reports which voice tiers are currently available based on configured
   * provider keys + their latency / monthly cost estimates.
   */
  voiceTiers: (companyId: string): Promise<JarvisVoiceTiersResponse> =>
    api.get(`/companies/${companyId}/jarvis/voice/tiers`),

  /** Lists available ElevenLabs voice characters (pre-made + cloned). */
  voices: (companyId: string): Promise<JarvisVoicesResponse> =>
    api.get(`/companies/${companyId}/jarvis/voices`),

  /** Uploads a 30s audio sample to ElevenLabs for cloning. Returns voice_id when configured. */
  cloneVoice: (
    companyId: string,
    body: { name: string; audioBase64: string; mimeType: string }
  ): Promise<{ status: string; voiceId?: string; message?: string }> =>
    api.post(`/companies/${companyId}/jarvis/voice/clone`, body),

  /** Returns an audio preview URL for a given voice (or null on browser-fallback). */
  voicePreview: (
    companyId: string,
    body: { voiceId: string }
  ): Promise<{ elevenlabsConfigured: boolean; previewAudioUrl: string | null }> =>
    api.post(`/companies/${companyId}/jarvis/voice/preview`, body),

  /**
   * Streams ElevenLabs Turbo v2.5 audio for the given text. Returns the raw
   * fetch Response so the caller can pipe `body` into a MediaSource / Audio
   * element without buffering the whole clip. Resolves with the Response
   * regardless of status — callers inspect `.ok` and surface non-2xx as a
   * fallback signal to browser TTS.
   */
  ttsStream: (
    companyId: string,
    body: { text: string; voiceId?: string; modelId?: string },
  ): Promise<Response> =>
    fetch(`/api/companies/${companyId}/jarvis/voice/tts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  /** Probes what Augi can actually do on this host. ?refresh=1 re-probes. */
  capabilities: (companyId: string, refresh = false): Promise<JarvisCapabilitiesResponse> =>
    api.get(`/companies/${companyId}/jarvis/capabilities${refresh ? "?refresh=1" : ""}`),

  /**
   * Returns the user's recent Jarvis conversation turns so the chat panel
   * hydrates with real history instead of mock data.
   */
  conversations: (
    companyId: string,
    limit = 20,
  ): Promise<JarvisConversationsResponse> =>
    api.get(`/companies/${companyId}/jarvis/conversations?limit=${limit}`),

  /**
   * Clears the War Room chat VIEW. Non-destructive: the server soft-hides the
   * caller's transcript rows (stamps cleared_at) so they stop rendering, but
   * never deletes them and never touches Hermes's memory layer. Returns how
   * many rows were hidden. Hermes keeps full continuity on the next turn.
   */
  clearConversations: (
    companyId: string,
  ): Promise<{ ok: boolean; cleared: number }> =>
    api.post(`/companies/${companyId}/jarvis/conversations/clear`, {}),

  /**
   * EXPLICIT "Send to Brainstorm" trigger. Hermes distills the current session
   * into a PROJECT BRIEF, opens a planning room, and starts the bounded
   * Hermes<->Brainstorm loop. Returns the room so the UI can stream it live.
   */
  brainstormKickoff: (
    companyId: string,
    body: { title?: string; brief?: string; seedText?: string } = {},
  ): Promise<JarvisBrainstormKickoffResponse> =>
    api.post(`/companies/${companyId}/jarvis/brainstorm/kickoff`, body),


  /**
   * Zeus Plan kickoff — from the Tasks board IntentBox.
   * Sends the intent to Zeus (DeepSeek / planner) who produces a draft plan,
   * then sends it to Brainstorm (GLM-5.2 / critic) for critique.
   * Both iterate to convergence. Returns a room ID to poll for final-plan.
   */
  zeusPlanKickoff: (
    companyId: string,
    body: { title: string; brief: string },
  ): Promise<JarvisBrainstormKickoffResponse> =>
    api.post(`/companies/${companyId}/jarvis/zeus/plan`, body),
  /**
   * Approve & send to team. Records the approval and hands the plan to Ares
   * (COO / distributor) over the real delegation/handoff path. Returns the
   * delegation id + reachability so the UI can show where the plan landed.
   */
  approvePlan: (
    companyId: string,
    body: JarvisPlanApproveRequest,
  ): Promise<JarvisPlanApproveResponse> =>
    api.post(`/companies/${companyId}/jarvis/plan/approve`, body),

  /**
   * Health probe — confirms /api/jarvis routes are mounted and reports
   * which LLM / voice provider keys are configured. Used by the UI to
   * surface "no real LLM wired" when every provider is missing.
   */
  health: (): Promise<JarvisHealthResponse> => api.get(`/jarvis/health`),

  /**
   * Mints a short-lived OpenAI Realtime ephemeral key. Returns null when
   * the server doesn't have an openai_realtime key configured (HTTP 501);
   * the caller degrades to local-VAD fallback in that case.
   */
  realtimeToken: async (
    companyId: string,
    body: { model?: string; voice?: string } = {},
  ): Promise<JarvisRealtimeTokenResponse | null> => {
    try {
      return await api.post<JarvisRealtimeTokenResponse>(
        `/companies/${companyId}/jarvis/realtime-token`,
        body,
      );
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status?: number }).status
          : null;
      if (status === 501) return null;
      throw err;
    }
  },

  /**
   * Reports that the user barged in mid-reply. Persists interruptedAt on
   * the conversation row (when conversationId is known) and broadcasts
   * the cancel signal on the server-side barge-in bus so any streaming
   * consumer tears down its pipe.
   */
  cancelResponse: (
    companyId: string,
    body: JarvisCancelResponseBody,
  ): Promise<JarvisCancelResponseResult> =>
    api.post(`/companies/${companyId}/jarvis/cancel-response`, body),

  /**
   * List delegations for the company. Filtered by status when provided so
   * the chat panel can poll `?status=running` cheaply on a 30s tick.
   */
  delegations: (
    companyId: string,
    opts: { status?: "queued" | "running" | "completed" | "failed"; limit?: number } = {},
  ): Promise<JarvisDelegationsResponse> => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set("status", opts.status);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const tail = qs.toString();
    return api.get(
      `/companies/${companyId}/jarvis/delegations${tail ? `?${tail}` : ""}`,
    );
  },

  /** Reachability probe for a single peer (server caches 30s). */
  peerReachable: (
    companyId: string,
    peer: JarvisPeerAgentId,
  ): Promise<{ reachable: boolean; error?: string }> =>
    api.get(
      `/companies/${companyId}/jarvis/delegations/peers/${peer}/reachable`,
    ),

  /** Read the company's Jarvis settings — auto-brief opt-in, etc. */
  settings: (companyId: string): Promise<JarvisCompanySettings> =>
    api.get(`/companies/${companyId}/jarvis/settings`),

  /** Patch one or more settings; returns the resulting row. */
  updateSettings: (
    companyId: string,
    body: Partial<JarvisCompanySettings>,
  ): Promise<JarvisCompanySettings> =>
    api.patch(`/companies/${companyId}/jarvis/settings`, body),

  /** Archive a room and return its full transcript. */
  completeRoom: (
    companyId: string,
    roomId: string,
  ): Promise<{
    ok: boolean;
    roomId: string;
    roomName: string;
    completedAt: string;
    transcript: {
      senderId: string;
      senderName: string | null;
      senderType: string;
      content: string;
      createdAt: string;
    }[];
    messageCount: number;
  }> => api.post(`/companies/${companyId}/jarvis/rooms/${roomId}/complete`, {}),
};

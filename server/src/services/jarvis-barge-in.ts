/**
 * In-process barge-in event bus + OpenAI Realtime ephemeral-key helper.
 *
 * Two responsibilities:
 *
 *   1. A tiny pub/sub keyed by (companyId, conversationId) that broadcasts
 *      "cancel" signals when the client reports a barge-in. Any SSE
 *      streaming endpoint can subscribe and tear down its stream as soon
 *      as the user interrupts. The bus is in-memory only — barge-in is
 *      a UX-critical, sub-second concern; persisting through a queue
 *      would defeat the purpose.
 *
 *   2. mintRealtimeEphemeralKey(): wraps OpenAI's
 *      POST /v1/realtime/sessions with the company's stored
 *      openai_realtime key so the browser never sees the long-lived
 *      secret. The returned client_secret is good for 60 seconds — long
 *      enough to open a WebRTC SDP exchange.
 */
import { EventEmitter } from "node:events";
import { getRawKey } from "./provider-api-keys/index.js";

export interface BargeInCancelEvent {
  conversationId: string | null;
  reason: "user_speech" | "manual" | "timeout";
  atMs: number;
  /** Optional character-position the client reached in TTS playback. */
  spokenChars?: number | null;
}

class BargeInBus {
  private emitter = new EventEmitter();

  constructor() {
    // Cancel signals can fan out to multiple stream listeners (the voice
    // endpoint + a debugger SSE, for example). Default 10 listener limit
    // is too tight; bump it once and forget.
    this.emitter.setMaxListeners(64);
  }

  private channel(companyId: string, conversationId: string | null): string {
    return `${companyId}:${conversationId ?? "*"}`;
  }

  emit(companyId: string, event: BargeInCancelEvent): void {
    // Emit on both the specific-conversation channel and the company
    // wildcard so listeners that don't know the conversationId yet (the
    // streaming endpoint that just started) still receive it.
    this.emitter.emit(this.channel(companyId, event.conversationId), event);
    this.emitter.emit(this.channel(companyId, null), event);
  }

  subscribe(
    companyId: string,
    conversationId: string | null,
    handler: (event: BargeInCancelEvent) => void,
  ): () => void {
    const ch = this.channel(companyId, conversationId);
    this.emitter.on(ch, handler);
    return () => this.emitter.off(ch, handler);
  }
}

export const bargeInBus = new BargeInBus();

export interface RealtimeEphemeralKey {
  /** Short-lived bearer token the browser uses to authenticate WebRTC SDP. */
  ephemeralKey: string;
  /** Unix epoch seconds; the client refreshes before this if a session is still active. */
  expiresAt: number;
  model: string;
  voice: string;
}

/**
 * Mints a short-lived ephemeral key for OpenAI's Realtime API by calling
 * POST /v1/realtime/sessions with the long-lived org key. The browser
 * uses the returned client_secret as a one-shot Bearer for the SDP
 * offer/answer exchange — it can't be replayed after expiry (~60s).
 *
 * Returns null when no openai_realtime key is configured; the caller
 * surfaces that as a 501 so the UI degrades to local VAD fallback.
 */
export async function mintRealtimeEphemeralKey(opts: {
  model?: string;
  voice?: string;
}): Promise<RealtimeEphemeralKey | null> {
  const apiKey = await getRawKey("openai_realtime").catch(() => null);
  if (!apiKey) return null;

  const model = opts.model ?? "gpt-4o-realtime-preview-2024-12-17";
  const voice = opts.voice ?? "alloy";

  const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      // The barge-in session only listens — we configure server-side VAD
      // so the client doesn't have to do any silence detection itself.
      modalities: ["audio", "text"],
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200,
      },
      instructions:
        "You are Jarvis's interrupt channel. When the user starts speaking, " +
        "respond with a 1-3 word acknowledgment like 'one second', 'got it', " +
        "'on it', or 'sure'. Never compose long answers. The real reply is " +
        "handled by another model. After the brief ack, stay silent and " +
        "wait for the next interruption.",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenAI Realtime session mint failed (${resp.status}): ${body.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    client_secret?: { value?: string; expires_at?: number };
  };
  const value = json.client_secret?.value;
  const expiresAt = json.client_secret?.expires_at;
  if (!value || !expiresAt) {
    throw new Error("OpenAI Realtime session response missing client_secret");
  }

  return {
    ephemeralKey: value,
    expiresAt,
    model,
    voice,
  };
}

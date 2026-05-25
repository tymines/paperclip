import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBargeInController } from "./jarvis-barge-in";

/**
 * Verifies the barge-in controller's contract: it must fire onSpeechStart
 * within the same microtask the underlying VAD emits a "speech detected"
 * event, set interrupted=true, and report the cut to the server. The
 * "TTS pauses within 500ms" guarantee comes from the page calling
 * voice.cancelSpeak() inside the onSpeechStart handler — so verifying
 * the handler fires synchronously is what matters here.
 */
describe("createBargeInController", () => {
  let dataChannelHandler: ((ev: { data: string }) => void) | null = null;
  let trackHandler: ((ev: { streams: MediaStream[] }) => void) | null = null;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    dataChannelHandler = null;
    trackHandler = null;

    // Mock the realtime token + SDP fetches.
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/jarvis/realtime-token")) {
        return new Response(
          JSON.stringify({
            ephemeralKey: "ek_test",
            expiresAt: Math.floor(Date.now() / 1000) + 60,
            model: "gpt-4o-realtime-preview-2024-12-17",
            voice: "alloy",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("openai.com/v1/realtime")) {
        return new Response("v=0\nfake-sdp", { status: 200 });
      }
      if (u.endsWith("/cancel-response")) {
        return new Response(
          JSON.stringify({ ok: true, interruptedAt: new Date().toISOString(), persisted: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // Mock getUserMedia.
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({
            getTracks: () => [{ stop: vi.fn() }],
          })),
        },
      },
      configurable: true,
    });

    // Stub HTMLAudioElement under node (jsdom isn't configured here).
    (globalThis as unknown as { Audio: unknown }).Audio = function (this: Record<string, unknown>) {
      this.autoplay = false;
      this.srcObject = null;
      return this;
    } as unknown as typeof Audio;

    // Mock RTCPeerConnection.
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = function (this: Record<string, unknown>) {
      const channel = {
        addEventListener: (name: string, handler: (ev: { data: string }) => void) => {
          if (name === "message") dataChannelHandler = handler;
        },
      };
      const pc = {
        close: vi.fn(),
        addTrack: vi.fn(),
        createDataChannel: () => channel,
        createOffer: async () => ({ sdp: "v=0\nfake-offer" }),
        setLocalDescription: async () => {},
        setRemoteDescription: async () => {},
        get ontrack() {
          return trackHandler;
        },
        set ontrack(handler: ((ev: { streams: MediaStream[] }) => void) | null) {
          trackHandler = handler;
        },
      };
      Object.assign(this, pc);
      return this;
    } as unknown as typeof RTCPeerConnection;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("opens a realtime session and fires onSpeechStart on the speech_started frame", async () => {
    const onSpeechStart = vi.fn();
    const onModeChange = vi.fn();
    const controller = createBargeInController({
      companyId: "00000000-0000-0000-0000-000000000001",
      onSpeechStart,
      onModeChange,
    });

    const mode = await controller.start();
    expect(mode).toBe("realtime");
    expect(onModeChange).toHaveBeenCalledWith("realtime");

    // Simulate the OpenAI Realtime "user started talking" frame.
    expect(dataChannelHandler).not.toBeNull();
    const before = performance.now();
    dataChannelHandler?.({
      data: JSON.stringify({ type: "input_audio_buffer.speech_started" }),
    });
    const elapsed = performance.now() - before;

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    // The handler ran synchronously inside the data-channel callback —
    // so "pause TTS within 500ms" is trivially satisfied.
    expect(elapsed).toBeLessThan(50);
    expect(controller.isInterrupted()).toBe(true);
  });

  it("dedupes repeated speech_started frames until clearInterrupt is called", async () => {
    const onSpeechStart = vi.fn();
    const controller = createBargeInController({
      companyId: "00000000-0000-0000-0000-000000000001",
      onSpeechStart,
    });
    await controller.start();

    dataChannelHandler?.({
      data: JSON.stringify({ type: "input_audio_buffer.speech_started" }),
    });
    dataChannelHandler?.({
      data: JSON.stringify({ type: "input_audio_buffer.speech_started" }),
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);

    controller.clearInterrupt();
    dataChannelHandler?.({
      data: JSON.stringify({ type: "input_audio_buffer.speech_started" }),
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
  });

  it("forwards Realtime final transcripts via onSpeechEnd", async () => {
    const onSpeechEnd = vi.fn();
    const controller = createBargeInController({
      companyId: "00000000-0000-0000-0000-000000000001",
      onSpeechStart: vi.fn(),
      onSpeechEnd,
    });
    await controller.start();

    dataChannelHandler?.({
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "walk me through everything blocked",
      }),
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("walk me through everything blocked");
  });

  it("reportInterrupt posts conversationId + spokenChars to cancel-response", async () => {
    const controller = createBargeInController({
      companyId: "00000000-0000-0000-0000-000000000001",
      onSpeechStart: vi.fn(),
    });
    await controller.start();

    await controller.reportInterrupt({
      conversationId: "11111111-1111-1111-1111-111111111111",
      spokenChars: 42,
    });

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const cancelCall = calls.find((c) => String(c[0]).endsWith("/cancel-response"));
    expect(cancelCall).toBeDefined();
    const body = JSON.parse((cancelCall![1] as { body: string }).body);
    expect(body).toMatchObject({
      conversationId: "11111111-1111-1111-1111-111111111111",
      spokenChars: 42,
      reason: "user_speech",
    });
  });

  it("ensures stop() is safe to call before start()", () => {
    const controller = createBargeInController({
      companyId: "00000000-0000-0000-0000-000000000001",
      onSpeechStart: vi.fn(),
    });
    expect(() => controller.stop()).not.toThrow();
    expect(controller.isActive()).toBe(false);
  });
});

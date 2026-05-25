/**
 * Full-duplex barge-in controller for Jarvis.
 *
 * Runs alongside the main TTS playback path. Has two strategies:
 *
 *   - **Realtime mode** (preferred): opens a WebRTC session against
 *     OpenAI's Realtime API using a short-lived ephemeral key. Server-side
 *     VAD fires `input_audio_buffer.speech_started` ~200ms after the user
 *     starts speaking, the controller emits onSpeechStart, and the
 *     Realtime model itself responds with a 1-3 word acknowledgment
 *     ("got it", "one second") via its own audio output channel so Tyler
 *     never hears dead air.
 *
 *   - **Local-VAD fallback**: when no openai_realtime key is configured,
 *     captures the mic with `getUserMedia`, runs the stream through an
 *     AnalyserNode, and fires onSpeechStart when the RMS amplitude
 *     crosses a threshold for ~80ms. No acknowledgment — main TTS just
 *     pauses until the next reply is composed.
 *
 * The controller is *idempotent*: start() can be called repeatedly with
 * no side effects, stop() always tears down both strategies. The main
 * page owns the lifetime — it starts when speaking begins and stops
 * when the orb returns to idle / listening.
 */
import { jarvisApi, type JarvisRealtimeTokenResponse } from "@/api/jarvis";

export type BargeInMode = "realtime" | "local-vad" | "disabled";

export interface BargeInOptions {
  companyId: string;
  /**
   * Called with the controller mode the moment a session actually opens.
   * Useful for surfacing "Premium barge-in active" UI hints.
   */
  onModeChange?: (mode: BargeInMode) => void;
  /**
   * Fired the instant user speech is detected. The page pauses main TTS
   * playback here. May fire multiple times across a session; subsequent
   * fires are no-ops if isInterrupted() is already true (the page
   * handles re-arming via clearInterrupt()).
   */
  onSpeechStart: () => void;
  /**
   * Fired when the user stops speaking and the Realtime API has a final
   * transcript. Plumb back into the main loop as a follow-up turn.
   * Never fires in local-VAD fallback (no STT in that path).
   */
  onSpeechEnd?: (transcript: string) => void;
  /** Surfaces non-fatal errors. Realtime session drops fall back here. */
  onError?: (err: Error) => void;
}

export interface BargeInController {
  /** True once a session has opened (either realtime or fallback). */
  isActive: () => boolean;
  /** Current mode — useful for the orb's "Premium" badge. */
  mode: () => BargeInMode;
  /**
   * Has speech-start fired since the last clearInterrupt()? Lets the
   * page suppress duplicate "barge-in" events while it's still
   * unwinding the previous one.
   */
  isInterrupted: () => boolean;
  clearInterrupt: () => void;
  /**
   * Opens a barge-in session. Idempotent — calling start() twice
   * doesn't open two sessions. If the realtime mint fails, falls back
   * to local-VAD. Returns the mode that was actually opened.
   */
  start: () => Promise<BargeInMode>;
  /** Tears down all transport. Safe to call multiple times. */
  stop: () => void;
  /**
   * Reports the in-flight reply position to the server. Called by the
   * page when interrupt fires so the conversation row tracks how far
   * playback got before the cut. conversationId is nullable because
   * the reply may not have a row yet when the user barges in mid-stream.
   */
  reportInterrupt: (opts: {
    conversationId: string | null;
    spokenChars: number;
  }) => Promise<void>;
}

interface RealtimeSession {
  pc: RTCPeerConnection;
  micStream: MediaStream;
  remoteAudio: HTMLAudioElement;
  dataChannel: RTCDataChannel;
}

interface LocalVadSession {
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  micStream: MediaStream;
  rafHandle: number | null;
}

const REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";

export function createBargeInController(opts: BargeInOptions): BargeInController {
  let mode: BargeInMode = "disabled";
  let interrupted = false;
  let realtime: RealtimeSession | null = null;
  let localVad: LocalVadSession | null = null;
  let starting: Promise<BargeInMode> | null = null;

  function setMode(next: BargeInMode) {
    if (mode === next) return;
    mode = next;
    opts.onModeChange?.(next);
  }

  function fireSpeechStart() {
    if (interrupted) return;
    interrupted = true;
    try {
      opts.onSpeechStart();
    } catch (err) {
      opts.onError?.(err as Error);
    }
  }

  async function openRealtime(): Promise<boolean> {
    let token: JarvisRealtimeTokenResponse | null;
    try {
      token = await jarvisApi.realtimeToken(opts.companyId);
    } catch (err) {
      opts.onError?.(err as Error);
      return false;
    }
    if (!token) return false;

    // Acquire the mic first so a user-gesture-prompt happens up front,
    // not at the moment Tyler tries to barge in.
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      opts.onError?.(err as Error);
      return false;
    }

    const pc = new RTCPeerConnection();
    const remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    // Route the Realtime ack to the same speaker stack as the main TTS.
    // It's intentionally a separate <audio> element so pausing the main
    // playback doesn't silence the acknowledgment.
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) remoteAudio.srcObject = stream;
    };

    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

    const dataChannel = pc.createDataChannel("oai-events");

    dataChannel.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          transcript?: string;
        };
        if (!msg || typeof msg.type !== "string") return;
        switch (msg.type) {
          case "input_audio_buffer.speech_started":
            fireSpeechStart();
            break;
          case "conversation.item.input_audio_transcription.completed":
          case "input_audio_buffer.committed": {
            const text = (msg.transcript ?? "").trim();
            if (text) opts.onSpeechEnd?.(text);
            break;
          }
          default:
            break;
        }
      } catch {
        // Ignore unknown frames — the Realtime event stream is rich and
        // we only care about three of them.
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let answerSdp: string;
    try {
      const resp = await fetch(`${REALTIME_BASE_URL}?model=${encodeURIComponent(token.model)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`OpenAI Realtime SDP exchange failed (${resp.status}): ${errBody.slice(0, 200)}`);
      }
      answerSdp = await resp.text();
    } catch (err) {
      opts.onError?.(err as Error);
      micStream.getTracks().forEach((t) => t.stop());
      pc.close();
      return false;
    }

    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    realtime = { pc, micStream, remoteAudio, dataChannel };
    setMode("realtime");
    return true;
  }

  async function openLocalVad(): Promise<boolean> {
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      opts.onError?.(err as Error);
      return false;
    }
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    // Threshold tuned empirically. RMS ranges ~0-128 (uint8 centered),
    // breath/keyboard noise sits ~3-5, mid-room speech ~12+. 8 is a
    // conservative cutoff with prefix-padding to avoid mic clicks.
    const threshold = 8;
    let aboveSince = 0;
    let rafHandle: number | null = null;

    const tick = () => {
      if (!localVad) return;
      analyser.getByteTimeDomainData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] ?? 128) - 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      const now = performance.now();
      if (rms > threshold) {
        if (aboveSince === 0) aboveSince = now;
        else if (now - aboveSince > 80) {
          fireSpeechStart();
        }
      } else {
        aboveSince = 0;
      }
      rafHandle = window.requestAnimationFrame(tick);
    };

    localVad = { audioCtx, analyser, micStream, rafHandle: null };
    rafHandle = window.requestAnimationFrame(tick);
    localVad.rafHandle = rafHandle;
    setMode("local-vad");
    return true;
  }

  async function start(): Promise<BargeInMode> {
    if (mode !== "disabled") return mode;
    if (starting) return starting;
    starting = (async () => {
      const realtimeOk = await openRealtime();
      if (!realtimeOk) {
        const localOk = await openLocalVad();
        if (!localOk) {
          setMode("disabled");
        }
      }
      return mode;
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  function stop(): void {
    if (realtime) {
      try {
        realtime.pc.close();
      } catch {}
      try {
        realtime.micStream.getTracks().forEach((t) => t.stop());
      } catch {}
      realtime.remoteAudio.srcObject = null;
      realtime = null;
    }
    if (localVad) {
      if (localVad.rafHandle !== null) {
        window.cancelAnimationFrame(localVad.rafHandle);
      }
      try {
        localVad.micStream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        void localVad.audioCtx.close();
      } catch {}
      localVad = null;
    }
    setMode("disabled");
  }

  async function reportInterrupt(input: {
    conversationId: string | null;
    spokenChars: number;
  }): Promise<void> {
    try {
      await jarvisApi.cancelResponse(opts.companyId, {
        conversationId: input.conversationId,
        reason: "user_speech",
        spokenChars: input.spokenChars,
      });
    } catch (err) {
      opts.onError?.(err as Error);
    }
  }

  return {
    isActive: () => mode !== "disabled",
    mode: () => mode,
    isInterrupted: () => interrupted,
    clearInterrupt: () => {
      interrupted = false;
    },
    start,
    stop,
    reportInterrupt,
  };
}

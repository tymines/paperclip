import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbAudioController } from "./useOrbAudio";
import type { JarvisVoiceTierId } from "@/api/jarvis";

/**
 * Voice flow for Jarvis. Routes TTS by tier:
 *
 *   premium  → ElevenLabs Turbo v2.5 streaming (mp3) via /jarvis/voice/tts
 *   standard → ElevenLabs streaming as well (we share the proxy until the
 *              OpenAI TTS-1 adapter lands — better than dropping straight
 *              to robotic browser speech)
 *   browser-native → window.speechSynthesis
 *
 * Premium/Standard fall back to browser TTS only when the server returns
 * 401/402/5xx or the network outright fails. The fallback reason is
 * exposed via onProviderChange so the UI can flip the "Voice Models"
 * badge from ELEVENLABS to BROWSER TTS and explain why.
 *
 * STT: Web SpeechRecognition (chunked partial + final transcripts).
 *
 * The browser's speech-synth audio cannot be routed through an AnalyserNode
 * (no public API exposes the synthesized PCM stream). To keep the orb
 * looking alive during browser TTS, we kick off a synthesized speech-like
 * envelope on the existing OrbAudioController for the duration of the
 * utterance. ElevenLabs playback uses an HTMLAudioElement source so the
 * real PCM drives the analyser.
 */
export type ActiveVoiceProvider = "elevenlabs" | "browser-tts" | "none";

export interface VoiceCapability {
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
  hasMediaRecorder: boolean;
}

export interface UseJarvisVoiceOptions {
  orb: OrbAudioController;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
  /** Optional company id for the ElevenLabs TTS proxy. */
  companyId?: string | null;
  /** "premium" / "standard" / "browser-native". Defaults to browser. */
  voiceTier?: JarvisVoiceTierId;
  /** ElevenLabs voice id. Falls back to Adam server-side when omitted. */
  voiceId?: string;
  /**
   * Fires whenever the actively-played provider changes (or when a
   * tier-1/2 speak() degrades to browser TTS). The UI uses this to keep
   * the "Voice Models" status badge honest.
   */
  onProviderChange?: (
    provider: ActiveVoiceProvider,
    detail?: { reason?: string; status?: number },
  ) => void;
}

export interface UseJarvisVoiceResult {
  capability: VoiceCapability;
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => void;
  stopListening: () => Promise<{ transcript: string; audioBlob: Blob | null }>;
  speak: (text: string) => Promise<void>;
  cancelSpeak: () => void;
  /** Most recent provider used. UI surfaces this in the System Status row. */
  activeProvider: ActiveVoiceProvider;
}

// Some browsers (Chrome, Edge) expose webkitSpeechRecognition.
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultList>;
}
interface SpeechRecognitionResultList extends ArrayLike<{ transcript: string; confidence: number }> {
  isFinal: boolean;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

function detectSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useJarvisVoice({
  orb,
  onTranscript,
  onError,
  companyId,
  voiceTier,
  voiceId,
  onProviderChange,
}: UseJarvisVoiceOptions): UseJarvisVoiceResult {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ActiveVoiceProvider>("none");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>("");
  const finishedDeferredRef = useRef<{
    resolve: (v: { transcript: string; audioBlob: Blob | null }) => void;
  } | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  // Keep the latest tier/voice/companyId visible inside speak() without
  // re-binding it on every render (which would force consumers to wrap it
  // in a useCallback for stability).
  const tierRef = useRef<JarvisVoiceTierId | undefined>(voiceTier);
  const voiceIdRef = useRef<string | undefined>(voiceId);
  const companyIdRef = useRef<string | null | undefined>(companyId);
  useEffect(() => {
    tierRef.current = voiceTier;
  }, [voiceTier]);
  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);
  useEffect(() => {
    companyIdRef.current = companyId;
  }, [companyId]);

  const capability: VoiceCapability = {
    hasSpeechRecognition: detectSpeechRecognition() !== null,
    hasSpeechSynthesis: typeof window !== "undefined" && "speechSynthesis" in window,
    hasMediaRecorder: typeof window !== "undefined" && "MediaRecorder" in window,
  };

  const reportProvider = useCallback(
    (provider: ActiveVoiceProvider, detail?: { reason?: string; status?: number }) => {
      setActiveProvider(provider);
      onProviderChange?.(provider, detail);
    },
    [onProviderChange],
  );

  const startListening = useCallback(() => {
    transcriptRef.current = "";
    chunksRef.current = [];

    // Always best-effort: SR first, MediaRecorder if available.
    const Ctor = detectSpeechRecognition();
    if (Ctor) {
      try {
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (e) => {
          let interim = "";
          let finalText = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const result = e.results[i] as SpeechRecognitionResultList;
            const text = result[0]?.transcript ?? "";
            if (result.isFinal) finalText += text;
            else interim += text;
          }
          if (finalText) {
            transcriptRef.current = (transcriptRef.current + " " + finalText).trim();
            onTranscript(transcriptRef.current, true);
          } else if (interim) {
            onTranscript((transcriptRef.current + " " + interim).trim(), false);
          }
        };
        rec.onerror = (e) => {
          // "no-speech" / "aborted" are routine, only surface real failures.
          if (e.error !== "no-speech" && e.error !== "aborted") {
            onError?.(new Error(`SpeechRecognition: ${e.error}`));
          }
        };
        rec.onend = () => {
          // SR can end on its own; we only honor stopListening's resolution.
        };
        rec.start();
        recognitionRef.current = rec;
      } catch (err) {
        onError?.(err as Error);
      }
    }

    // MediaRecorder captures raw audio for higher-quality STT paths (Whisper / OpenAI Realtime).
    if (capability.hasMediaRecorder) {
      navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          mediaStreamRef.current = stream;
          const mr = new MediaRecorder(stream);
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          mr.start(250);
          mediaRecorderRef.current = mr;
        })
        .catch((err) => {
          // Mic permission denied — not fatal for browser SR path
          onError?.(err as Error);
        });
    }

    setIsListening(true);
  }, [capability.hasMediaRecorder, onError, onTranscript]);

  const stopListening = useCallback((): Promise<{ transcript: string; audioBlob: Blob | null }> => {
    setIsListening(false);

    return new Promise((resolve) => {
      finishedDeferredRef.current = { resolve };

      const mr = mediaRecorderRef.current;
      const settle = () => {
        const transcript = transcriptRef.current;
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: mr?.mimeType ?? "audio/webm" })
            : null;
        chunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        finishedDeferredRef.current?.resolve({ transcript, audioBlob: blob });
        finishedDeferredRef.current = null;
      };

      try {
        recognitionRef.current?.stop();
      } catch {}
      recognitionRef.current = null;

      if (mr && mr.state !== "inactive") {
        mr.onstop = settle;
        mr.stop();
      } else {
        settle();
      }
    });
  }, []);

  const teardownAudioEl = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {}
    }
    if (audioObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      } catch {}
      audioObjectUrlRef.current = null;
    }
    audioElRef.current = null;
  }, []);

  const cancelSpeak = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      ttsAbortRef.current?.abort();
    } catch {}
    ttsAbortRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    teardownAudioEl();
    orb.stopDemo();
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, [orb, teardownAudioEl]);

  const speakBrowser = useCallback(
    (text: string, reason?: { detail?: string; status?: number }): Promise<void> => {
      if (!text || !capability.hasSpeechSynthesis) {
        reportProvider("none");
        return Promise.resolve();
      }
      reportProvider("browser-tts", {
        reason: reason?.detail,
        status: reason?.status,
      });
      return new Promise<void>((resolve) => {
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 1.0;
        utt.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => /Daniel|Alex|Microsoft (David|Mark)/.test(v.name)) ||
          voices.find((v) => v.lang.startsWith("en"));
        if (preferred) utt.voice = preferred;

        utt.onstart = () => {
          setIsSpeaking(true);
          // Estimate utterance duration to drive the orb's synthetic
          // envelope (browser TTS PCM isn't routable to AnalyserNode).
          // ~3.5 chars/word, ~155 wpm → ~22.5 chars/sec.
          const estSec = Math.min(Math.max(text.length / 22, 0.6), 18);
          orb.playDemoSpeech(estSec);
        };
        utt.onend = () => {
          setIsSpeaking(false);
          utteranceRef.current = null;
          resolve();
        };
        utt.onerror = () => {
          setIsSpeaking(false);
          orb.stopDemo();
          utteranceRef.current = null;
          resolve();
        };
        utteranceRef.current = utt;
        window.speechSynthesis.speak(utt);
      });
    },
    [capability.hasSpeechSynthesis, orb, reportProvider],
  );

  const speakElevenLabs = useCallback(
    async (text: string): Promise<void> => {
      const cid = companyIdRef.current;
      if (!cid) {
        return speakBrowser(text, { detail: "no-company" });
      }
      const ac = new AbortController();
      ttsAbortRef.current = ac;
      let resp: Response;
      try {
        resp = await fetch(`/api/companies/${cid}/jarvis/voice/tts`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voiceId: voiceIdRef.current,
            modelId: "eleven_turbo_v2_5",
          }),
          signal: ac.signal,
        });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          return;
        }
        return speakBrowser(text, { detail: `network: ${(err as Error).message}` });
      }
      if (!resp.ok || !resp.body) {
        // 401 → key invalid OR per-key quota cap hit, 402 → out of quota,
        // 501 → no key configured. Try to surface the upstream `code` so
        // the badge can show "quota exceeded" instead of just "HTTP 401".
        const status = resp.status;
        let detail = "";
        try {
          const parsed = await resp.clone().json();
          // Server wraps the upstream error in { error, status, detail }
          // where `detail` is the verbatim ElevenLabs body as a string.
          if (parsed && typeof parsed.detail === "string") {
            try {
              const upstream = JSON.parse(parsed.detail) as {
                detail?: { code?: string; message?: string };
              };
              detail =
                upstream.detail?.code || upstream.detail?.message || parsed.error || "";
            } catch {
              detail = parsed.error || "";
            }
          } else {
            detail = (parsed && (parsed.message || parsed.error)) || "";
          }
        } catch {
          try {
            detail = (await resp.text()).slice(0, 200);
          } catch {}
        }
        return speakBrowser(text, { status, detail: detail || `http_${status}` });
      }

      // Buffer the streamed mp3 into a Blob so we can hand it to an
      // HTMLAudioElement source. (MediaSource + audio/mpeg is supported in
      // Safari but flaky in Firefox — a Blob is the simplest cross-browser
      // path and still streams the upstream connection.)
      let blob: Blob;
      try {
        blob = await resp.blob();
      } catch (err) {
        return speakBrowser(text, { detail: `stream: ${(err as Error).message}` });
      }

      const url = URL.createObjectURL(blob);
      audioObjectUrlRef.current = url;
      const el = new Audio();
      el.src = url;
      el.crossOrigin = "anonymous";
      audioElRef.current = el;

      // Pipe the element through the orb analyser so the reactor reacts
      // to the real PCM instead of the synthetic envelope.
      try {
        orb.attachAudioElement(el);
      } catch {
        // analyser attach can fail when the AudioContext isn't ready
        // (e.g. before user gesture); the visualizer just won't react.
      }

      reportProvider("elevenlabs");
      setIsSpeaking(true);

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          setIsSpeaking(false);
          teardownAudioEl();
          resolve();
        };
        el.onended = cleanup;
        el.onerror = () => {
          // Mid-playback decode error — fall back gracefully.
          teardownAudioEl();
          setIsSpeaking(false);
          void speakBrowser(text, { detail: "audio-decode" }).then(resolve);
        };
        el.play().catch(() => {
          teardownAudioEl();
          setIsSpeaking(false);
          // Autoplay blocked — only browser TTS will work, but that also
          // needs a gesture in some browsers. Try it anyway.
          void speakBrowser(text, { detail: "autoplay-blocked" }).then(resolve);
        });
      });
      ttsAbortRef.current = null;
    },
    [orb, reportProvider, speakBrowser, teardownAudioEl],
  );

  const speak = useCallback(
    (text: string): Promise<void> => {
      if (!text) return Promise.resolve();
      const tier = tierRef.current ?? "browser-native";
      // Premium and Standard both route through ElevenLabs for now —
      // Standard's OpenAI TTS-1 adapter ships in a follow-up; falling
      // back to browser TTS for Standard would feel like a regression
      // since the user actively picked a non-free tier.
      if (tier === "premium" || tier === "standard") {
        return speakElevenLabs(text);
      }
      return speakBrowser(text);
    },
    [speakBrowser, speakElevenLabs],
  );

  // Cancel any in-flight speech on unmount
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {}
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      try {
        ttsAbortRef.current?.abort();
      } catch {}
      const el = audioElRef.current;
      if (el) {
        try {
          el.pause();
        } catch {}
      }
      if (audioObjectUrlRef.current) {
        try {
          URL.revokeObjectURL(audioObjectUrlRef.current);
        } catch {}
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    capability,
    isListening,
    isSpeaking,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
    activeProvider,
  };
}

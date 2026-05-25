import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbAudioController } from "./useOrbAudio";

/**
 * Browser-native voice flow for Jarvis (Tier 3 — Free).
 *
 * STT: Web SpeechRecognition (chunked partial + final transcripts).
 * TTS: Web SpeechSynthesis.
 *
 * The browser's speech-synth audio cannot be routed through an AnalyserNode
 * (no public API exposes the synthesized PCM stream). To keep the orb
 * looking alive during browser TTS, we kick off a synthesized speech-like
 * envelope on the existing OrbAudioController for the duration of the
 * utterance. Once Commit 5 lands ElevenLabs, an HTMLAudioElement source
 * routes through the same analyser and the synthetic envelope is bypassed.
 *
 * MediaRecorder is also captured during the listen window — it isn't sent
 * anywhere in Commit 2 (SpeechRecognition handles the transcript), but the
 * blob is exposed so Commit 5 can upload it to Whisper or OpenAI Realtime
 * without any flow changes here.
 */
export interface VoiceCapability {
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
  hasMediaRecorder: boolean;
}

export interface UseJarvisVoiceOptions {
  orb: OrbAudioController;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
}

export interface UseJarvisVoiceResult {
  capability: VoiceCapability;
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => void;
  stopListening: () => Promise<{ transcript: string; audioBlob: Blob | null }>;
  speak: (text: string) => Promise<void>;
  cancelSpeak: () => void;
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
}: UseJarvisVoiceOptions): UseJarvisVoiceResult {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>("");
  const finishedDeferredRef = useRef<{
    resolve: (v: { transcript: string; audioBlob: Blob | null }) => void;
  } | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const capability: VoiceCapability = {
    hasSpeechRecognition: detectSpeechRecognition() !== null,
    hasSpeechSynthesis: typeof window !== "undefined" && "speechSynthesis" in window,
    hasMediaRecorder: typeof window !== "undefined" && "MediaRecorder" in window,
  };

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

    // MediaRecorder captures raw audio for Commit 5 (Whisper / OpenAI Realtime).
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

  const cancelSpeak = useCallback(() => {
    if (typeof window === "undefined") return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    orb.stopDemo();
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, [orb]);

  const speak = useCallback(
    (text: string): Promise<void> => {
      if (!text || !capability.hasSpeechSynthesis) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 1.0;
        utt.pitch = 1.0;
        // Voice tuning belongs in Commit 6's voice picker; default voice
        // selection here is intentionally minimal.
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
    [capability.hasSpeechSynthesis, orb]
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
  };
}

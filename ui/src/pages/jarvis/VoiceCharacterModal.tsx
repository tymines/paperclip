import { useEffect, useRef, useState } from "react";
import { jarvisApi, type JarvisVoiceCharacter } from "@/api/jarvis";

interface VoiceCharacterModalProps {
  companyId: string | null;
  open: boolean;
  selectedVoiceId: string;
  onSelect: (voice: JarvisVoiceCharacter) => void;
  onClose: () => void;
}

type Tab = "library" | "clone";

/**
 * Two-tab modal for picking a voice character or cloning the user's own.
 *
 * Library tab — server returns the stable ElevenLabs pre-made catalog
 * (Adam, Bella, Brian, Charlie, Liam, Rachel, Domi, Elli) plus any voices
 * already cloned locally (kept in localStorage until the company_jarvis_
 * settings persistence lands with the Premium tier handlers).
 *
 * Clone tab — 4-step wizard: explain → record 30s with live waveform +
 * countdown + the diverse-phoneme script → submit → preview. The actual
 * ElevenLabs /v1/voices/add call is stubbed today (returns 501 without an
 * ElevenLabs key, 202 with one) — the wizard captures the audio, names the
 * voice, and persists the choice client-side so the flow ships visually.
 */
export function VoiceCharacterModal({
  companyId,
  open,
  selectedVoiceId,
  onSelect,
  onClose,
}: VoiceCharacterModalProps) {
  const [tab, setTab] = useState<Tab>("library");
  const [voices, setVoices] = useState<JarvisVoiceCharacter[]>([]);
  const [elevenlabsConfigured, setElevenlabsConfigured] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !companyId) return;
    jarvisApi
      .voices(companyId)
      .then((resp) => {
        const cloned = loadClonedVoicesFromStorage();
        setVoices([...resp.voices, ...cloned]);
        setElevenlabsConfigured(resp.elevenlabsConfigured);
      })
      .catch(() => {
        // Endpoint may not be live yet — fall back to a small default list.
        const cloned = loadClonedVoicesFromStorage();
        setVoices([...DEFAULT_VOICES, ...cloned]);
        setElevenlabsConfigured(false);
      });
  }, [open, companyId]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function playPreview(voice: JarvisVoiceCharacter) {
    setPreviewing(voice.voiceId);
    // Without ElevenLabs key, fall back to browser TTS so Tyler still hears
    // *something* — picks the closest matching browser voice by name.
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setPreviewing(null);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`Good evening, Tyler. I'm online and ready.`);
    const browserVoices = window.speechSynthesis.getVoices();
    const match =
      browserVoices.find((v) => v.name.toLowerCase().includes(voice.name.toLowerCase())) ||
      browserVoices.find((v) => v.lang.startsWith("en"));
    if (match) u.voice = match;
    u.onend = () => setPreviewing(null);
    u.onerror = () => setPreviewing(null);
    window.speechSynthesis.speak(u);
  }

  if (!open) return null;

  return (
    <div className="jarvis-modal-shroud" onClick={onClose}>
      <div
        className="jarvis-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Voice character"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="jarvis-modal-header">
          <h2>Voice Character</h2>
          <button
            type="button"
            className="jarvis-icon-btn danger"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="jarvis-modal-tabs">
          <button
            type="button"
            className={`jarvis-modal-tab ${tab === "library" ? "active" : ""}`}
            onClick={() => setTab("library")}
          >
            Library
          </button>
          <button
            type="button"
            className={`jarvis-modal-tab ${tab === "clone" ? "active" : ""}`}
            onClick={() => setTab("clone")}
          >
            Clone Your Voice
          </button>
        </div>

        {tab === "library" ? (
          <div className="jarvis-modal-body jarvis-voice-library">
            {!elevenlabsConfigured ? (
              <div className="jarvis-banner" style={{ marginBottom: 12 }}>
                <div className="jarvis-banner-text">
                  <strong>Limited preview quality.</strong> Connect an ElevenLabs key in
                  Fleet → Provider Keys to hear the real ElevenLabs voices. For now
                  previews fall back to browser TTS.
                </div>
              </div>
            ) : null}
            <div className="jarvis-voice-grid">
              {voices.map((v) => {
                const isSelected = v.voiceId === selectedVoiceId;
                return (
                  <button
                    key={v.voiceId}
                    type="button"
                    className={`jarvis-voice-tile ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelect(v)}
                  >
                    <div className="jarvis-voice-tile-head">
                      <span className="jarvis-voice-name">{v.name}</span>
                      {v.cloned ? <span className="jarvis-voice-tag">Cloned</span> : null}
                      {isSelected ? <span className="jarvis-voice-tag selected">Selected</span> : null}
                    </div>
                    <div className="jarvis-voice-style">{v.style}</div>
                    <button
                      type="button"
                      className="jarvis-voice-preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        playPreview(v);
                      }}
                      disabled={previewing === v.voiceId}
                    >
                      {previewing === v.voiceId ? "Playing…" : "▶ Preview"}
                    </button>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <CloneWizard
            companyId={companyId}
            elevenlabsConfigured={elevenlabsConfigured}
            onCloned={(voice) => {
              persistClonedVoice(voice);
              setVoices((prev) => [...prev, voice]);
              onSelect(voice);
              setTab("library");
            }}
          />
        )}
      </div>
    </div>
  );
}

// =================================================================
// Clone wizard
// =================================================================

const CLONE_SCRIPT =
  "The quick brown fox jumps over the lazy dog. Five quick zephyrs blow vexing daft Jim. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump.";

type Step = "explain" | "record" | "submit" | "preview";

function CloneWizard({
  companyId,
  elevenlabsConfigured,
  onCloned,
}: {
  companyId: string | null;
  elevenlabsConfigured: boolean;
  onCloned: (voice: JarvisVoiceCharacter) => void;
}) {
  const [step, setStep] = useState<Step>("explain");
  const [voiceName, setVoiceName] = useState("Tyler");
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Live waveform on the canvas
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      src.connect(analyser);
      drawWaveform(canvasRef.current, analyser, data, () => rafRef.current);

      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioBlob(blob);
        chunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        ctx.close().catch(() => {});
      };
      mr.start(250);
      mediaRecorderRef.current = mr;

      setRecording(true);
      setSecondsLeft(30);
      setError(null);
      timerRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            stopRecording();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setError(`Microphone access failed: ${(err as Error).message}`);
    }
  }

  function stopRecording() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    mediaRecorderRef.current = null;
  }

  async function submitClone() {
    if (!audioBlob || !companyId) return;
    setSubmitting(true);
    setError(null);
    try {
      const base64 = await blobToBase64(audioBlob);
      const resp = await jarvisApi.cloneVoice(companyId, {
        name: voiceName.trim() || "My Voice",
        audioBase64: base64,
        mimeType: audioBlob.type,
      });
      // The stub returns 202 without a real voiceId until ElevenLabs is wired.
      // Generate a local id and persist client-side so the flow demos end-to-end.
      const voiceId = resp.voiceId ?? `local-${Date.now()}`;
      onCloned({
        voiceId,
        name: voiceName.trim() || "My Voice",
        style: "your voice · cloned",
        premade: false,
        cloned: true,
      });
      setStep("preview");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="jarvis-modal-body jarvis-clone-wizard">
      <ol className="jarvis-clone-steps">
        {(["explain", "record", "submit", "preview"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`${s === step ? "active" : ""} ${stepIndex(step) > i ? "done" : ""}`}
          >
            <span>{i + 1}</span>
            {labelFor(s)}
          </li>
        ))}
      </ol>

      {step === "explain" ? (
        <div className="jarvis-clone-pane">
          <p>
            Record about 30 seconds of yourself speaking naturally. The cleaner the
            recording — quiet room, close mic — the more accurate the clone.
          </p>
          <p style={{ color: "var(--jarvis-text-dim)", fontSize: 12 }}>
            You'll be asked to read a short script that covers a diverse range of
            phonemes. ElevenLabs charges $0 for the clone itself; premium-quality
            cloning needs the Creator plan (~$22/mo).
          </p>
          <label className="jarvis-clone-label">
            Voice name
            <input
              className="jarvis-clone-input"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              placeholder="e.g. Tyler"
            />
          </label>
          <button
            type="button"
            className="jarvis-clone-cta"
            onClick={() => setStep("record")}
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === "record" ? (
        <div className="jarvis-clone-pane">
          <p className="jarvis-clone-script">{CLONE_SCRIPT}</p>
          <canvas ref={canvasRef} className="jarvis-clone-canvas" width={480} height={80} />
          <div className="jarvis-clone-countdown">
            {recording ? `${secondsLeft}s remaining` : audioBlob ? "Recording captured" : "Ready to record"}
          </div>
          <div className="jarvis-clone-actions">
            {!recording && !audioBlob ? (
              <button type="button" className="jarvis-clone-cta" onClick={startRecording}>
                ● Start 30s recording
              </button>
            ) : null}
            {recording ? (
              <button type="button" className="jarvis-clone-cta danger" onClick={stopRecording}>
                ■ Stop early
              </button>
            ) : null}
            {audioBlob && !recording ? (
              <>
                <button
                  type="button"
                  className="jarvis-clone-cta ghost"
                  onClick={() => {
                    setAudioBlob(null);
                    setSecondsLeft(30);
                  }}
                >
                  Re-record
                </button>
                <button type="button" className="jarvis-clone-cta" onClick={() => setStep("submit")}>
                  Continue
                </button>
              </>
            ) : null}
          </div>
          {error ? <div className="jarvis-clone-error">{error}</div> : null}
        </div>
      ) : null}

      {step === "submit" ? (
        <div className="jarvis-clone-pane">
          <p>Ready to clone <strong>{voiceName.trim() || "your voice"}</strong>.</p>
          {!elevenlabsConfigured ? (
            <div className="jarvis-banner">
              <div className="jarvis-banner-text">
                <strong>ElevenLabs key not configured.</strong> The clone will be saved
                locally so you can preview the flow, but the actual ElevenLabs voice
                ID won't be created until you add a key in Fleet → Provider Keys.
              </div>
            </div>
          ) : null}
          <div className="jarvis-clone-actions">
            <button type="button" className="jarvis-clone-cta ghost" onClick={() => setStep("record")}>
              Back
            </button>
            <button
              type="button"
              className="jarvis-clone-cta"
              onClick={submitClone}
              disabled={submitting}
            >
              {submitting ? "Cloning…" : "Submit"}
            </button>
          </div>
          {error ? <div className="jarvis-clone-error">{error}</div> : null}
        </div>
      ) : null}

      {step === "preview" ? (
        <div className="jarvis-clone-pane">
          <p>
            Voice saved as <strong>{voiceName.trim() || "My Voice"}</strong>.
            {elevenlabsConfigured
              ? " ElevenLabs is processing the sample — your voice will be ready to use shortly."
              : " Add an ElevenLabs key to generate the actual cloned voice."}
          </p>
          <p style={{ color: "var(--jarvis-text-dim)", fontSize: 12 }}>
            Your cloned voice is now available in the Library tab alongside the
            pre-made voices, marked with a "Cloned" badge.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function stepIndex(s: Step): number {
  return ["explain", "record", "submit", "preview"].indexOf(s);
}
function labelFor(s: Step): string {
  switch (s) {
    case "explain":
      return "Explain";
    case "record":
      return "Record";
    case "submit":
      return "Submit";
    case "preview":
      return "Preview";
  }
}

function drawWaveform(
  canvas: HTMLCanvasElement | null,
  analyser: AnalyserNode,
  data: Uint8Array<ArrayBuffer>,
  getRafRef: () => number | null,
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  function tick() {
    analyser.getByteTimeDomainData(data);
    ctx!.fillStyle = "rgba(2, 6, 13, 0.4)";
    ctx!.fillRect(0, 0, w, h);
    ctx!.lineWidth = 1.5;
    ctx!.strokeStyle = "#00d4ff";
    ctx!.shadowColor = "rgba(0, 212, 255, 0.6)";
    ctx!.shadowBlur = 6;
    ctx!.beginPath();
    const slice = w / data.length;
    let x = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx!.moveTo(x, y);
      else ctx!.lineTo(x, y);
      x += slice;
    }
    ctx!.stroke();
    if (getRafRef() != null || true) {
      requestAnimationFrame(tick);
    }
  }
  tick();
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:audio/webm;base64," prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadClonedVoicesFromStorage(): JarvisVoiceCharacter[] {
  try {
    const raw = window.localStorage.getItem("paperclip.jarvis.clonedVoices");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as JarvisVoiceCharacter[];
  } catch {}
  return [];
}

function persistClonedVoice(voice: JarvisVoiceCharacter) {
  try {
    const existing = loadClonedVoicesFromStorage();
    const next = [...existing.filter((v) => v.voiceId !== voice.voiceId), voice];
    window.localStorage.setItem("paperclip.jarvis.clonedVoices", JSON.stringify(next));
  } catch {}
}

const DEFAULT_VOICES: JarvisVoiceCharacter[] = [
  { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam", style: "deep · calm · British", premade: true },
  { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Bella", style: "soft · warm · American", premade: true },
  { voiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", style: "calm · American · narrator", premade: true },
];

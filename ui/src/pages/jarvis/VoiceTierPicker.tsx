import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@/lib/router";
import type { JarvisVoiceTier, JarvisVoiceTierId } from "@/api/jarvis";

interface VoiceTierPickerProps {
  tiers: JarvisVoiceTier[] | null;
  selected: JarvisVoiceTierId;
  onSelect: (id: JarvisVoiceTierId) => void;
}

/**
 * Pill button + dropdown for switching Jarvis voice quality. Greyed rows
 * deep-link to /instance/settings/provider-keys with the right tab focused.
 */
export function VoiceTierPicker({ tiers, selected, onSelect }: VoiceTierPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = tiers?.find((t) => t.id === selected);
  const label = current?.label ?? labelFor(selected);

  return (
    <div className="jarvis-tier-picker" ref={ref}>
      <button
        type="button"
        className="jarvis-tier-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="jarvis-tier-pill-prefix">Voice</span>
        <span className="jarvis-tier-pill-label">{label}</span>
        <svg viewBox="0 0 24 24" width={10} height={10} fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="jarvis-tier-menu" role="listbox" aria-label="Voice quality">
          {(tiers ?? defaultTiers()).map((tier) => {
            const isSelected = tier.id === selected;
            return (
              <button
                key={tier.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`jarvis-tier-row ${isSelected ? "selected" : ""} ${tier.available ? "" : "unavailable"}`}
                onClick={() => {
                  if (!tier.available) {
                    navigate("/instance/settings/provider-keys");
                    setOpen(false);
                    return;
                  }
                  onSelect(tier.id);
                  setOpen(false);
                }}
              >
                <div className="jarvis-tier-row-head">
                  <span className="jarvis-tier-row-name">{tier.label}</span>
                  <TierAvailabilityIcon available={tier.available} />
                </div>
                <div className="jarvis-tier-row-meta">
                  <span>~{Math.round(tier.latencyEstimateMs)}ms</span>
                  <span>·</span>
                  <span>
                    {tier.monthlyCostUsdAt5min === 0
                      ? "$0/mo"
                      : `~$${tier.monthlyCostUsdAt5min}/mo @ 5min/day`}
                  </span>
                </div>
                <div className="jarvis-tier-row-desc">{tier.description}</div>
                {!tier.available ? (
                  <div className="jarvis-tier-row-cta">
                    Configure keys →
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TierAvailabilityIcon({ available }: { available: boolean }) {
  if (available) {
    return (
      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" aria-label="Available">
        <path d="M5 12l4.5 4.5L19 7" stroke="#4fffb0" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" aria-label="Needs key">
      <path d="M12 4v9M12 17.5v.2" stroke="#ffb547" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function labelFor(id: JarvisVoiceTierId): string {
  switch (id) {
    case "premium":
      return "Premium";
    case "standard":
      return "Standard";
    case "browser-native":
    default:
      return "Free";
  }
}

function defaultTiers(): JarvisVoiceTier[] {
  return [
    {
      id: "premium",
      label: "Premium",
      available: false,
      latencyEstimateMs: 800,
      monthlyCostUsdAt5min: 45,
      costPerMinUsd: 0.04,
      providers: ["openai_realtime", "elevenlabs"],
      description: "OpenAI Realtime STT + ElevenLabs Turbo v2.5 TTS. Sub-1s voice-to-voice.",
    },
    {
      id: "standard",
      label: "Standard",
      available: false,
      latencyEstimateMs: 1500,
      monthlyCostUsdAt5min: 8,
      costPerMinUsd: 0.007,
      providers: ["openai"],
      description: "OpenAI Whisper STT + TTS-1. ~1.5s voice-to-voice.",
    },
    {
      id: "browser-native",
      label: "Free",
      available: true,
      latencyEstimateMs: 1800,
      monthlyCostUsdAt5min: 0,
      costPerMinUsd: 0,
      providers: [],
      description: "Browser SpeechRecognition + SpeechSynthesis. No keys needed.",
    },
  ];
}

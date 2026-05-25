import { useEffect, useRef, useState, useCallback, type FormEvent } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { jarvisApi } from "@/api/jarvis";
import { Reactor } from "./Reactor";
import { useOrbAudio } from "./useOrbAudio";
import { useJarvisVoice } from "./useJarvisVoice";
import {
  MOCK_BRIEFING,
  MOCK_CAPABILITIES,
  MOCK_INITIAL_CHAT,
  type JarvisChatMessage,
} from "./mock-data";
import "./Jarvis.css";

type HudState = "idle" | "listening" | "processing" | "speaking";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap";

/**
 * Lazy-load Jarvis-specific Google fonts so they don't block first paint
 * for the rest of the app. Removed on unmount.
 */
function useJarvisFonts() {
  useEffect(() => {
    const existing = document.querySelector(`link[data-jarvis-fonts]`);
    if (existing) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    pre1.setAttribute("data-jarvis-fonts", "preconnect-1");
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    pre2.setAttribute("data-jarvis-fonts", "preconnect-2");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    link.setAttribute("data-jarvis-fonts", "stylesheet");
    document.head.appendChild(pre1);
    document.head.appendChild(pre2);
    document.head.appendChild(link);
    return () => {
      document
        .querySelectorAll('link[data-jarvis-fonts]')
        .forEach((el) => el.remove());
    };
  }, []);
}

interface JarvisRouteTarget {
  label: string;
  to: string;
}

const MODE_TABS: JarvisRouteTarget[] = [
  { label: "Dashboard", to: "/jarvis" },
  { label: "Memory", to: "/knowledge-graph" },
  { label: "Knowledge", to: "/skills" },
  { label: "Tools", to: "/skills" },
  { label: "Automations", to: "/routines" },
];

export function JarvisPage() {
  useJarvisFonts();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();

  const reactorRef = useRef<HTMLDivElement | null>(null);
  const tickGroupRef = useRef<SVGGElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const interimMsgIdRef = useRef<string | null>(null);

  const [state, setState] = useState<HudState>("idle");
  const [messages, setMessages] = useState<JarvisChatMessage[]>(
    MOCK_INITIAL_CHAT
  );
  const [composer, setComposer] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const orb = useOrbAudio({ reactorRef, tickGroupRef, state });

  const voice = useJarvisVoice({
    orb,
    onTranscript: (transcript, isFinal) => {
      // Render interim transcript as a live user bubble; promote to permanent
      // on the final.
      setMessages((prev) => {
        const id = interimMsgIdRef.current;
        const stamp = formatNow();
        if (id) {
          const next = prev.map((m) =>
            m.id === id ? { ...m, text: transcript, authorLabel: `You · ${stamp}` } : m
          );
          if (isFinal) interimMsgIdRef.current = null;
          return next;
        }
        const newId = `u-live-${Date.now()}`;
        interimMsgIdRef.current = isFinal ? null : newId;
        return [
          ...prev,
          {
            id: newId,
            author: "user",
            authorLabel: `You · ${stamp}`,
            text: transcript,
            timestamp: stamp,
          },
        ];
      });
    },
  });

  // Capture the SVG <g> with rim ticks for the orb hook to read.
  useEffect(() => {
    if (!reactorRef.current) return;
    tickGroupRef.current = reactorRef.current.querySelector(
      "g[data-tick-group]"
    );
  }, []);

  // Auto-scroll the chat to bottom whenever messages change.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const exit = useCallback(() => navigate("/home"), [navigate]);

  // Escape exits the takeover view.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") exit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  // Dispatch a finalized transcript: POST to /api/jarvis/voice, render the
  // reply as an agent bubble, speak it via browser TTS. Orb visuals follow
  // the HUD state and the TTS envelope inside useJarvisVoice.
  const dispatchTranscript = useCallback(
    async (transcript: string) => {
      if (!transcript.trim() || !selectedCompanyId) return;
      setState("processing");
      let reply = "";
      try {
        const resp = await jarvisApi.voice(selectedCompanyId, { transcript });
        reply = resp.reply;
      } catch (err) {
        reply = `Network error reaching Jarvis: ${(err as Error).message}`;
      }
      const stamp = formatNow();
      setMessages((prev) => [
        ...prev,
        {
          id: `r-${Date.now()}`,
          author: "agent",
          authorLabel: `Jarvis · ${stamp}`,
          text: reply,
          timestamp: stamp,
        },
      ]);
      setState("speaking");
      await voice.speak(reply);
      setState("idle");
    },
    [selectedCompanyId, voice]
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = composer.trim();
      if (!trimmed) return;
      const stamp = formatNow();
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          author: "user",
          authorLabel: `You · ${stamp}`,
          text: trimmed,
          timestamp: stamp,
        },
      ]);
      setComposer("");
      void dispatchTranscript(trimmed);
    },
    [composer, dispatchTranscript]
  );

  const onMicDown = useCallback(() => {
    if (voice.isSpeaking) voice.cancelSpeak();
    interimMsgIdRef.current = null;
    setState("listening");
    voice.startListening();
  }, [voice]);

  const onMicUp = useCallback(async () => {
    if (state !== "listening") return;
    const { transcript } = await voice.stopListening();
    interimMsgIdRef.current = null;
    const finalText = transcript.trim();
    if (!finalText) {
      setState("idle");
      return;
    }
    // The interim bubble (if any) was already promoted; if there is no
    // promoted bubble yet (interim path didn't fire), add the final.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.author === "user" && last.text === finalText) return prev;
      return [
        ...prev,
        {
          id: `u-${Date.now()}`,
          author: "user",
          authorLabel: `You · ${formatNow()}`,
          text: finalText,
          timestamp: formatNow(),
        },
      ];
    });
    await dispatchTranscript(finalText);
  }, [state, voice, dispatchTranscript]);

  function clearChat() {
    setMessages([]);
    inputRef.current?.focus();
  }

  return (
    <div className="jarvis-root" data-state={state}>
      <div className="jarvis-bg-glow" aria-hidden />
      <div className="jarvis-scanlines" aria-hidden />
      <div className="jarvis-vignette" aria-hidden />

      <header className="jarvis-topbar">
        <div className="jarvis-brand">
          <div className="jarvis-brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx={12} cy={12} r={6} fill="currentColor" />
              <circle cx={12} cy={12} r={9.5} stroke="currentColor" strokeWidth={1.5} />
            </svg>
          </div>
          <div className="jarvis-brand-text">
            <span className="jarvis-brand-name">JARVIS AI</span>
            <span className="jarvis-brand-tagline">Your Intelligent Assistant</span>
          </div>
        </div>

        <nav className="jarvis-mode-tabs" role="tablist" aria-label="Mode">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.label}
              className={`jarvis-mode-tab ${tab.label === "Dashboard" ? "active" : ""}`}
              onClick={() => {
                if (tab.label === "Dashboard") return;
                navigate(tab.to);
              }}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="jarvis-top-actions">
          <span className="jarvis-online-pill">Online</span>
          <button className="jarvis-icon-btn" title="Settings" type="button">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx={12} cy={12} r={3} stroke="currentColor" strokeWidth={1.6} />
              <path
                d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 00-2-1.2L14.2 3h-4.4l-.3 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 002 1.2l.3 2.6h4.4l.3-2.6a7 7 0 002-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"
                stroke="currentColor"
                strokeWidth={1.35}
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="jarvis-tier-badge">MAX</span>
          <button
            className="jarvis-icon-btn danger"
            title="Exit Jarvis mode (Esc)"
            aria-label="Exit"
            type="button"
            onClick={exit}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <main className="jarvis-stage">
        {/* LEFT RAIL */}
        <aside className="jarvis-left-rail" aria-label="Agent">
          <section className="jarvis-panel">
            <span className="jarvis-corner-tr" /><span className="jarvis-corner-bl" />
            <div className="jarvis-panel-header">
              <h3>Active Agent</h3>
              <span className="jarvis-meta">Connected</span>
            </div>
            <div className="jarvis-panel-body">
              <div className="jarvis-agent-id-row">
                <div className="jarvis-hex-avatar">
                  <svg viewBox="0 0 64 64" aria-hidden>
                    <defs>
                      <radialGradient id="jarvis-hex-grad" cx="50%" cy="40%" r="50%">
                        <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.55} />
                        <stop offset="70%" stopColor="#003c66" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#02060d" stopOpacity={0.9} />
                      </radialGradient>
                    </defs>
                    <polygon
                      points="32,4 58,18 58,46 32,60 6,46 6,18"
                      fill="url(#jarvis-hex-grad)"
                      stroke="#00d4ff"
                      strokeWidth={1.6}
                      style={{ filter: "drop-shadow(0 0 8px rgba(0, 212, 255, 0.55))" }}
                    />
                    <polygon
                      points="32,12 51,22 51,42 32,52 13,42 13,22"
                      fill="none"
                      stroke="#00d4ff"
                      strokeWidth={0.7}
                      opacity={0.45}
                    />
                  </svg>
                  <span className="jarvis-hex-mark">AU</span>
                </div>
                <div className="jarvis-agent-meta">
                  <span className="jarvis-agent-name">Augi</span>
                  <span className="jarvis-agent-status">Connected</span>
                  <span className="jarvis-agent-model">{MOCK_BRIEFING.agentModel}</span>
                </div>
              </div>
              <div className="jarvis-agent-focus">
                <span className="jarvis-focus-label">Active Focus</span>
                <span className="jarvis-focus-text">{MOCK_BRIEFING.agentFocus}</span>
              </div>
            </div>
          </section>

          <section className="jarvis-panel">
            <span className="jarvis-corner-tr" /><span className="jarvis-corner-bl" />
            <div className="jarvis-panel-header">
              <h3>Capabilities</h3>
              <span className="jarvis-meta">{MOCK_CAPABILITIES.length} / {MOCK_CAPABILITIES.length}</span>
            </div>
            <div className="jarvis-panel-body">
              <div className="jarvis-caps-list">
                {MOCK_CAPABILITIES.map((c) => (
                  <div key={c.label} className="jarvis-cap">
                    <span className="jarvis-cap-label">{c.label}</span>
                    <span className="jarvis-cap-val">{c.value}%</span>
                    <div
                      className="jarvis-cap-bar"
                      style={{ ["--fill" as string]: `${c.value}%` }}
                    />
                  </div>
                ))}
              </div>
              <a
                className="jarvis-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/agents/augi");
                }}
              >
                View Agent Profile
              </a>
            </div>
          </section>

          <section className="jarvis-panel">
            <span className="jarvis-corner-tr" /><span className="jarvis-corner-bl" />
            <div className="jarvis-panel-header">
              <h3>System Status</h3>
              <span className="jarvis-meta">Nominal</span>
            </div>
            <div className="jarvis-panel-body">
              <div className="jarvis-sys-list">
                <SysRow label="Listening" value="Ready" tone="ok" />
                <SysRow label="Thinking Engine" value="Online" tone="ok" />
                <SysRow label="Voice Models" value="Browser TTS" tone="ok" />
                <SysRow label="Knowledge Base" value="3,412 docs" tone="ok" />
                <SysRow
                  label="Voice Tier"
                  value={MOCK_BRIEFING.voiceTierLabel}
                  tone="gold"
                />
              </div>
              <div className="jarvis-sys-stats">
                <div className="jarvis-sys-stat">
                  <div className="jarvis-stat-label">Session</div>
                  <div className="jarvis-stat-value">{MOCK_BRIEFING.uptime}</div>
                </div>
                <div className="jarvis-sys-stat">
                  <div className="jarvis-stat-label">Latency</div>
                  <div className="jarvis-stat-value" style={{ color: "var(--jarvis-success)" }}>
                    412<span style={{ fontSize: 11, color: "var(--jarvis-muted)" }}>ms</span>
                  </div>
                </div>
              </div>
              <a className="jarvis-link" href="#" onClick={(e) => e.preventDefault()}>
                Run Diagnostics
              </a>
            </div>
          </section>
        </aside>

        {/* CENTER */}
        <section className="jarvis-center" aria-label="HUD">
          <div className="jarvis-reactor-shell">
            <div className="jarvis-stat-overlay tl">
              <div className="jarvis-stat-value-big">{MOCK_BRIEFING.uptime}</div>
              <div className="jarvis-stat-label-small">Uptime</div>
            </div>
            <div className="jarvis-stat-overlay tr">
              <div className="jarvis-stat-value-big">{MOCK_BRIEFING.contextSize}</div>
              <div className="jarvis-stat-label-small">Context</div>
            </div>
            <div className="jarvis-reactor" ref={reactorRef}>
              <Reactor />
            </div>
            <div className="jarvis-reactor-label">JARVIS PRIME ONLINE</div>
          </div>

          <div className="jarvis-quick-actions">
            <QuickAction
              label="Launch Task"
              hint="Start a new run with voice context"
              onClick={() => navigate("/inbox")}
              icon={
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 19l5-2 9-9-3-3-9 9-2 5z" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
                  <path d="M14 5l5 5M14 19l4 0M16 17l0 4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              }
            />
            <QuickAction
              label="Analyze"
              hint="Insights over Paperclip data"
              onClick={() => navigate("/cost-watcher")}
              icon={
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 20V8M9 20V4M14 20v-8M19 20v-14" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
              }
            />
            <QuickAction
              label="Search"
              hint="Issues, agents, rooms"
              onClick={() => {
                inputRef.current?.focus();
                setComposer("search ");
              }}
              icon={
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx={11} cy={11} r={6} stroke="currentColor" strokeWidth={1.8} />
                  <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
              }
            />
            <QuickAction
              label="Automate"
              hint="Spin up a Routine"
              onClick={() => navigate("/routines")}
              icon={
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 4a4 4 0 014 4v1a3 3 0 010 6v1a4 4 0 11-8 0v-1a3 3 0 010-6V8a4 4 0 014-4z"
                    stroke="currentColor"
                    strokeWidth={1.6}
                  />
                  <path d="M9 12h6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              }
            />
          </div>

          <div className="jarvis-input-shell">
            <form className="jarvis-input-bar" onSubmit={onSubmit}>
              <button className="jarvis-input-attach" type="button" title="Attach">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M14 8.5l-6 6a3 3 0 104.2 4.2L18.5 12a5 5 0 10-7-7l-6.5 6.5"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <input
                ref={inputRef}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="Ask me anything, JARVIS is here to help…"
                autoComplete="off"
              />
              <button
                className="jarvis-input-mic"
                type="button"
                title="Hold to talk"
                onMouseDown={onMicDown}
                onMouseUp={onMicUp}
                onMouseLeave={onMicUp}
                onTouchStart={(e) => {
                  e.preventDefault();
                  onMicDown();
                }}
                onTouchEnd={onMicUp}
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x={9} y={3} width={6} height={11} rx={3} stroke="currentColor" strokeWidth={1.8} />
                  <path
                    d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button className="jarvis-input-send" type="submit" title="Send">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 12l16-8-7 16-2-7-7-1z" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
                </svg>
              </button>
            </form>
            <div className="jarvis-input-footer">
              <span>End-to-end Encrypted</span> ·
              <a href="#" onClick={(e) => e.preventDefault()}>Report a Bug</a> ·
              <a href="#" onClick={(e) => e.preventDefault()}>Privacy Policy</a>
            </div>
          </div>
        </section>

        {/* RIGHT RAIL */}
        <aside className="jarvis-right-rail" aria-label="Conversation">
          {!voice.capability.hasSpeechRecognition && !bannerDismissed ? (
            <div className="jarvis-banner">
              <div className="jarvis-banner-text">
                <strong>Limited voice quality.</strong> This browser doesn't expose
                SpeechRecognition — text input still works. Connect a Whisper /
                ElevenLabs adapter in Fleet → Provider Keys for premium voice.
              </div>
              <button
                className="jarvis-icon-btn"
                type="button"
                aria-label="Dismiss"
                onClick={() => setBannerDismissed(true)}
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : null}
          <section className="jarvis-panel jarvis-chat-panel">
            <span className="jarvis-corner-tr" /><span className="jarvis-corner-bl" />
            <div className="jarvis-panel-header">
              <h3>Conversation</h3>
              <button
                className="jarvis-icon-btn"
                title="Clear conversation"
                aria-label="Clear"
                type="button"
                onClick={clearChat}
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className="jarvis-chat-scroll" ref={chatScrollRef}>
              {messages.map((m) => (
                <div key={m.id} className={`jarvis-msg ${m.author}`}>
                  <span className="jarvis-msg-author">{m.authorLabel}</span>
                  <div className="jarvis-msg-bubble">{m.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="jarvis-panel jarvis-perf-card">
            <span className="jarvis-corner-tr" /><span className="jarvis-corner-bl" />
            <div className="jarvis-panel-header" style={{ padding: "0 0 6px" }}>
              <h3>Performance Metrics</h3>
              <span className="jarvis-meta">Last 24h</span>
            </div>
            <div className="jarvis-perf-grid">
              <div className="jarvis-perf-tile">
                <div className="label">Latency</div>
                <div className="value-row">
                  <span className="value">412ms</span>
                  <span className="delta">↓ 12%</span>
                </div>
                <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
                  <path d="M0,18 L10,14 L20,20 L30,12 L40,15 L50,8 L60,11 L70,6 L80,9 L90,5 L100,7" />
                </svg>
              </div>
              <div className="jarvis-perf-tile warn">
                <div className="label">Success</div>
                <div className="value-row">
                  <span className="value">97.4%</span>
                  <span className="delta">→ steady</span>
                </div>
                <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
                  <path d="M0,8 L10,9 L20,7 L30,10 L40,8 L50,9 L60,7 L70,10 L80,8 L90,9 L100,8" />
                </svg>
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function QuickAction({
  label,
  hint,
  onClick,
  icon,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button className="jarvis-qa-card" type="button" onClick={onClick}>
      <span className="jarvis-qa-icon">{icon}</span>
      <div>
        <div className="jarvis-qa-label">{label}</div>
        <div className="jarvis-qa-hint">{hint}</div>
      </div>
    </button>
  );
}

function SysRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warm" | "alert" | "gold";
}) {
  return (
    <div className={`jarvis-sys-row ${tone}`}>
      <span className="jarvis-sys-icon">
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none">
          <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      </span>
      <span className="jarvis-sys-label">{label}</span>
      <span className="jarvis-sys-value">{value}</span>
    </div>
  );
}

function formatNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

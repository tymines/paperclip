import { useEffect, useRef, useState, useCallback, useMemo, type FormEvent } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import {
  jarvisApi,
  type JarvisCapability,
  type JarvisCompanySettings,
  type JarvisConversationTurn,
  type JarvisResponseType,
  type JarvisVoiceCharacter,
  type JarvisVoiceTier,
  type JarvisVoiceTierId,
} from "@/api/jarvis";
import { Reactor } from "./Reactor";
import { useOrbAudio } from "./useOrbAudio";
import { useJarvisVoice } from "./useJarvisVoice";
import { VoiceTierPicker } from "./VoiceTierPicker";
import { VoiceCharacterModal } from "./VoiceCharacterModal";
import {
  MOCK_BRIEFING,
  MOCK_CAPABILITIES,
  type JarvisChatMessage,
} from "./mock-data";
import {
  createBargeInController,
  type BargeInController,
  type BargeInMode,
} from "@/lib/jarvis-barge-in";
import "./Jarvis.css";

const TIER_STORAGE_KEY = "paperclip.jarvis.voiceTier";
const VOICE_CHARACTER_STORAGE_KEY = "paperclip.jarvis.voiceCharacter";

const DEFAULT_VOICE: JarvisVoiceCharacter = {
  voiceId: "pNInz6obpgDQGcFmaJgB",
  name: "Adam",
  style: "deep · calm · British",
  premade: true,
};

// Static defaults so the cost hint + System Status row show meaningful values
// before /jarvis/voice/tiers responds (or when the older server doesn't
// expose it). The picker dropdown uses its own internal defaults via the
// same shape.
function defaultTier(id: JarvisVoiceTierId): JarvisVoiceTier {
  switch (id) {
    case "premium":
      return {
        id: "premium",
        label: "Premium",
        available: false,
        latencyEstimateMs: 800,
        monthlyCostUsdAt5min: 45,
        costPerMinUsd: 0.04,
        providers: ["openai_realtime", "elevenlabs"],
        description: "OpenAI Realtime STT + ElevenLabs Turbo v2.5 TTS.",
      };
    case "standard":
      return {
        id: "standard",
        label: "Standard",
        available: false,
        latencyEstimateMs: 1500,
        monthlyCostUsdAt5min: 8,
        costPerMinUsd: 0.007,
        providers: ["openai"],
        description: "OpenAI Whisper STT + TTS-1.",
      };
    case "browser-native":
    default:
      return {
        id: "browser-native",
        label: "Free",
        available: true,
        latencyEstimateMs: 1800,
        monthlyCostUsdAt5min: 0,
        costPerMinUsd: 0,
        providers: [],
        description: "Browser SpeechRecognition + SpeechSynthesis.",
      };
  }
}

type HudState = "idle" | "listening" | "processing" | "speaking" | "interrupted";

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
  // Tracking for barge-in: the message id of the currently-speaking
  // agent reply, the timestamp the speak started (so we can estimate
  // chars spoken before the cut), and the full reply text.
  const speakingMsgIdRef = useRef<string | null>(null);
  const speakingStartedAtRef = useRef<number>(0);
  const speakingTextRef = useRef<string>("");
  const speakingConversationIdRef = useRef<string | null>(null);
  const bargeInRef = useRef<BargeInController | null>(null);

  const [state, setState] = useState<HudState>("idle");
  const [bargeInMode, setBargeInMode] = useState<BargeInMode>("disabled");
  // Start empty — real history is fetched from /api/companies/:id/jarvis/conversations
  // on mount. Empty state ("Tap the mic or type to start") is rendered when
  // there is no prior conversation for this user.
  const [messages, setMessages] = useState<JarvisChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [composer, setComposer] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [tiers, setTiers] = useState<JarvisVoiceTier[] | null>(null);
  const [voiceTier, setVoiceTier] = useState<JarvisVoiceTierId>(() => {
    try {
      const stored = window.localStorage.getItem(TIER_STORAGE_KEY);
      if (stored === "premium" || stored === "standard" || stored === "browser-native") {
        return stored;
      }
    } catch {}
    return "browser-native";
  });
  const [voiceCharacter, setVoiceCharacter] = useState<JarvisVoiceCharacter>(() => {
    try {
      const stored = window.localStorage.getItem(VOICE_CHARACTER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed.voiceId === "string") {
          return parsed as JarvisVoiceCharacter;
        }
      }
    } catch {}
    return DEFAULT_VOICE;
  });
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<JarvisCompanySettings>({ autoBriefOnLoad: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  // Tracks per-message replay state so each agent bubble can show its own
  // "Speaking…" indicator while the saved reply is being re-played.
  const [replayingMsgId, setReplayingMsgId] = useState<string | null>(null);
  // 2-second debounce on the topbar "Brief me" button so a double-click
  // can't fire two manual briefings before the server-side dedupe window
  // is even consulted.
  const briefMeRef = useRef<number>(0);
  // Track strict-mode double-mount of the auto-fire effect — the first
  // mount stamps this ref so the second cleanup → re-mount returns early
  // before it queues a second fireBriefing().
  const autoBriefEffectRanRef = useRef(false);
  const [capabilities, setCapabilities] = useState<JarvisCapability[] | null>(null);
  const [capabilitiesGeneratedAt, setCapabilitiesGeneratedAt] = useState<string | null>(null);
  const [capabilitiesRefreshing, setCapabilitiesRefreshing] = useState(false);
  // Surfaces the "want me to..." follow-up from the last Daddy's Home
  // briefing as a clickable CTA over the orb. Cleared on click + after 60s.
  const [recommendedAction, setRecommendedAction] = useState<string | null>(null);

  // Probe the real capability surface once per page load (server caches it
  // for 10 min). "Run Diagnostics" forces a refresh.
  const refreshCapabilities = useCallback(
    async (force = false) => {
      if (!selectedCompanyId) return;
      setCapabilitiesRefreshing(true);
      try {
        const resp = await jarvisApi.capabilities(selectedCompanyId, force);
        setCapabilities(resp.capabilities);
        setCapabilitiesGeneratedAt(resp.generatedAt);
      } catch {
        // Older server without the endpoint — keep the mock list.
      } finally {
        setCapabilitiesRefreshing(false);
      }
    },
    [selectedCompanyId]
  );

  useEffect(() => {
    void refreshCapabilities(false);
  }, [refreshCapabilities]);

  // Load per-company Jarvis settings (auto-brief opt-in, etc). Older servers
  // without the endpoint default to autoBriefOnLoad:false so the page-load
  // auto-fire stays disabled — this matches Tyler's "respond when I ask"
  // expectation regardless of which server version answers.
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    setSettingsLoaded(false);
    jarvisApi
      .settings(selectedCompanyId)
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSettings({ autoBriefOnLoad: false });
        setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  // Hydrate the chat panel with the user's real conversation history. If
  // the endpoint 404s on older servers, silently fall through to the empty
  // state — never resurrect the mock chat.
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    setHistoryLoaded(false);
    jarvisApi
      .conversations(selectedCompanyId, 20)
      .then((resp) => {
        if (cancelled) return;
        setMessages(conversationsToMessages(resp.conversations));
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  // Track delegation rows we've already chimed for so the soft bell only
  // fires once per completion, even if the result row sits in the table
  // for a while before the user sees it.
  const chimedDelegationsRef = useRef<Set<string>>(new Set());

  // Poll active delegations every 30s. When a delegation row flips to
  // completed / failed, update the chip on its originating bubble AND
  // append a Jarvis follow-up message with the result, then fire a
  // subtle audio cue so Tyler knows something landed.
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        // Pull both running and recently-completed rows so we catch the
        // queued→completed flip even if the poll missed the running step
        // (some peers skip the running update entirely).
        const [running, recent] = await Promise.all([
          jarvisApi.delegations(selectedCompanyId!, { status: "running" }),
          jarvisApi.delegations(selectedCompanyId!, { limit: 20 }),
        ]);
        if (cancelled) return;
        const byId = new Map<string, import("@/api/jarvis").JarvisDelegationRow>();
        for (const r of running.delegations) byId.set(r.id, r);
        for (const r of recent.delegations) byId.set(r.id, r);

        setMessages((prev) => {
          let mutated = false;
          const next = prev.slice();
          const followUps: JarvisChatMessage[] = [];
          for (let i = 0; i < next.length; i++) {
            const msg = next[i];
            if (!msg?.delegationId) continue;
            const row = byId.get(msg.delegationId);
            if (!row) continue;
            if (msg.delegationStatus !== row.status) {
              next[i] = { ...msg, delegationStatus: row.status };
              mutated = true;
            }
            if (
              (row.status === "completed" || row.status === "failed") &&
              !chimedDelegationsRef.current.has(row.id)
            ) {
              chimedDelegationsRef.current.add(row.id);
              playSoftBell();
              const stamp = formatNow();
              const verb = row.status === "completed" ? "landed" : "failed";
              const body =
                row.result?.trim() || (row.status === "failed" ? "(no error detail)" : "(empty result)");
              followUps.push({
                id: `r-${row.id}-done`,
                author: "agent",
                authorLabel: `Jarvis · ${stamp}`,
                text: `${row.agent} ${verb}: ${body}`,
                timestamp: stamp,
              });
            }
          }
          if (followUps.length > 0) {
            return [...next, ...followUps];
          }
          return mutated ? next : prev;
        });
      } catch {
        /* swallow — next tick will retry */
      }
    }

    void tick();
    timer = setInterval(() => {
      void tick();
    }, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selectedCompanyId]);

  // Debounced "Brief me" handler — 2 second floor between manual fires so a
  // double-click can't queue two briefings before the server-side dedupe
  // window (5 minutes) is consulted.
  const onBriefMe = useCallback(() => {
    const now = Date.now();
    if (now - briefMeRef.current < 2000) return;
    briefMeRef.current = now;
    void fireBriefing({ source: "manual" });
  }, []);

  const onToggleAutoBrief = useCallback(
    async (next: boolean) => {
      if (!selectedCompanyId) return;
      setSettings((prev) => ({ ...prev, autoBriefOnLoad: next }));
      setSettingsSaving(true);
      try {
        const updated = await jarvisApi.updateSettings(selectedCompanyId, {
          autoBriefOnLoad: next,
        });
        setSettings(updated);
      } catch {
        // Roll back optimistic update on failure.
        setSettings((prev) => ({ ...prev, autoBriefOnLoad: !next }));
      } finally {
        setSettingsSaving(false);
      }
    },
    [selectedCompanyId],
  );

  const onVoiceCharacterSelect = useCallback((voice: JarvisVoiceCharacter) => {
    setVoiceCharacter(voice);
    try {
      window.localStorage.setItem(VOICE_CHARACTER_STORAGE_KEY, JSON.stringify(voice));
    } catch {}
    setVoiceModalOpen(false);
  }, []);

  // Fetch tier availability + pick the highest available as default if the
  // user hasn't explicitly chosen one. We treat "no stored choice" and the
  // legacy default "browser-native" the same way — both auto-upgrade to the
  // top available tier (Premium when ElevenLabs + Realtime keys are present)
  // so Tyler isn't stuck on Free after wiring up the keys.
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    jarvisApi
      .voiceTiers(selectedCompanyId)
      .then((resp) => {
        if (cancelled) return;
        setTiers(resp.tiers);
        try {
          const stored = window.localStorage.getItem(TIER_STORAGE_KEY) as JarvisVoiceTierId | null;
          const userPickedKey = `${TIER_STORAGE_KEY}.userPicked`;
          const userPicked = window.localStorage.getItem(userPickedKey) === "1";
          const storedTier = resp.tiers.find((t) => t.id === stored);
          const top = resp.tiers.find((t) => t.available);
          // Auto-upgrade if: no stored tier, stored tier is unavailable, or
          // user never explicitly picked (so the previous default came from
          // the localStorage seed rather than a real choice).
          if (!userPicked || !storedTier || !storedTier.available) {
            if (top && top.id !== voiceTier) setVoiceTier(top.id);
          }
        } catch {}
      })
      .catch(() => {
        if (cancelled) return;
        // Endpoint might not exist yet (older server) — fall back silently.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  const onTierSelect = useCallback((id: JarvisVoiceTierId) => {
    setVoiceTier(id);
    try {
      window.localStorage.setItem(TIER_STORAGE_KEY, id);
      // Mark this as a real user choice so the auto-upgrade pass on next
      // mount honors the pick instead of bumping back to top-available.
      window.localStorage.setItem(`${TIER_STORAGE_KEY}.userPicked`, "1");
    } catch {}
  }, []);

  const currentTier = useMemo(
    () => tiers?.find((t) => t.id === voiceTier) ?? defaultTier(voiceTier),
    [tiers, voiceTier]
  );

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

  // Replay the saved reply for an agent message. No LLM round-trip — just
  // hands the stored text back through the same TTS adapter the user has
  // selected via voiceTier. Cancels any in-flight TTS first so we never
  // end up with two utterances stacked on each other.
  const onReplayMessage = useCallback(
    async (msgId: string, text: string) => {
      if (!text.trim()) return;
      try {
        voice.cancelSpeak();
      } catch {}
      setReplayingMsgId(msgId);
      try {
        await voice.speak(text);
      } finally {
        setReplayingMsgId((cur) => (cur === msgId ? null : cur));
      }
    },
    [voice],
  );

  // Capture the SVG <g> with rim ticks for the orb hook to read.
  useEffect(() => {
    if (!reactorRef.current) return;
    tickGroupRef.current = reactorRef.current.querySelector(
      "g[data-tick-group]"
    );
  }, []);

  // Fires the Daddy's Home briefing: server returns prose + a recommended
  // follow-up action. Reused by the 4hr auto-trigger and the manual
  // "Brief me" topbar button — the latter passes source:"manual" so the
  // server can tag the conversation row.
  const fireBriefing = useCallback(
    async (opts: { source?: "manual" | "mac-wake" | "schedule" } = {}) => {
      if (!selectedCompanyId) return;
      setState("processing");
      try {
        const resp = await jarvisApi.daddysHome(selectedCompanyId, {
          voiceTier,
          source: opts.source,
        });
        const stamp = formatNow();
        setMessages((prev) => [
          ...prev,
          {
            id: `r-briefing-${Date.now()}`,
            author: "agent",
            authorLabel: `Jarvis · ${stamp}`,
            text: resp.briefingText,
            timestamp: stamp,
          },
        ]);
        // Surface the CTA only when it's actually distinct from the briefing
        // tail — server already guarantees that, but cheap to double-check.
        if (resp.recommendedAction && resp.recommendedAction.trim()) {
          setRecommendedAction(resp.recommendedAction.trim());
        }
        // Stamp the debounce timestamp ONLY on success so a failed network
        // call retries on the next mount instead of silently swallowing the
        // briefing for 4 hours.
        try {
          window.localStorage.setItem(
            `paperclip.jarvis.lastBriefingTimestamp.${selectedCompanyId}`,
            String(Date.now()),
          );
        } catch {}
        setState("speaking");
        await voice.speak(resp.briefingText);
      } catch (err) {
        const stamp = formatNow();
        setMessages((prev) => [
          ...prev,
          {
            id: `r-briefing-err-${Date.now()}`,
            author: "agent",
            authorLabel: `Jarvis · ${stamp}`,
            text: `Briefing failed: ${(err as Error).message}`,
            timestamp: stamp,
          },
        ]);
      } finally {
        setState((cur) => (cur === "interrupted" ? "interrupted" : "idle"));
      }
    },
    [selectedCompanyId, voice, voiceTier],
  );

  // Initialize the barge-in controller once per company. The controller's
  // start() is idempotent and only opens transport on the first call;
  // dispatchTranscript triggers start() right before each speak() turn so
  // mic permission is requested in response to a user gesture.
  useEffect(() => {
    if (!selectedCompanyId) return;
    const controller = createBargeInController({
      companyId: selectedCompanyId,
      onModeChange: (m) => setBargeInMode(m),
      onSpeechStart: () => {
        // Tyler is talking. Stop the TTS pipe, mark the in-flight reply
        // as interrupted, and flag the row server-side so the chat
        // history shows the cut.
        const startedAt = speakingStartedAtRef.current;
        const elapsedSec = startedAt ? (performance.now() - startedAt) / 1000 : 0;
        // 155 wpm × ~5 chars/word ≈ 12.9 chars/sec. Slightly conservative
        // (we want to underestimate spokenChars rather than claim Jarvis
        // spoke more than he did).
        const spokenChars = Math.min(
          Math.round(elapsedSec * 12.5),
          speakingTextRef.current.length,
        );
        try {
          voice.cancelSpeak();
        } catch {}
        const msgId = speakingMsgIdRef.current;
        if (msgId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, interrupted: true, interruptedAtChars: spokenChars }
                : m
            )
          );
        }
        setState("interrupted");
        void controller.reportInterrupt({
          conversationId: speakingConversationIdRef.current,
          spokenChars,
        });
        // Drop back to "listening" once the amber flash has played so
        // the Realtime ack ("got it") feels like it leads into a fresh
        // listening window rather than a stuck UI state.
        window.setTimeout(() => {
          setState((cur) => (cur === "interrupted" ? "listening" : cur));
        }, 240);
      },
      onSpeechEnd: (transcript) => {
        // Realtime returned a final transcript — route it through the
        // main loop as the next turn. Skip if the user immediately
        // stopped speaking with no recognized words.
        const text = transcript.trim();
        if (!text) {
          controller.clearInterrupt();
          return;
        }
        const stamp = formatNow();
        setMessages((prev) => [
          ...prev,
          {
            id: `u-${Date.now()}`,
            author: "user",
            authorLabel: `You · ${stamp}`,
            text,
            timestamp: stamp,
          },
        ]);
        controller.clearInterrupt();
        void dispatchTranscript(text, { voiceMode: true });
      },
      onError: () => {
        // Surface barge-in failures silently for now — they're non-fatal.
        // The orb's badge already reflects mode "disabled" if the
        // session never opens, so the UI still tells Tyler something
        // went wrong.
      },
    });
    bargeInRef.current = controller;
    return () => {
      controller.stop();
      bargeInRef.current = null;
    };
    // dispatchTranscript / voice are stable per-company; intentionally
    // re-running only on companyId change so the controller stays put
    // across speak() turns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  // Tear down the barge-in transport when we return to idle/processing
  // (no point holding the mic open while Jarvis composes). Re-opens
  // each time a speak() starts via dispatchTranscript -> start().
  useEffect(() => {
    if (state === "idle" || state === "processing") {
      bargeInRef.current?.stop();
      setBargeInMode("disabled");
    }
  }, [state]);

  // Auto-fire the Daddy's Home briefing on mount — only when the company
  // explicitly opted in via the settings toggle. Default is OFF: Tyler
  // wanted briefings on ask only, not on page load. Mac-wake + the
  // scheduled cron remain the hands-free triggers.
  //
  // Strict-mode safety: the effectRan ref guards against React's
  // dev-mode double-mount re-firing the briefing.
  // Pre-stamp safety: the localStorage timestamp is set *before* the
  // call kicks off so even if the effect somehow re-runs, the second
  // pass sees a fresh timestamp and bails inside the 4-hour debounce.
  useEffect(() => {
    if (!selectedCompanyId) return;
    if (!settingsLoaded) return;
    if (!settings.autoBriefOnLoad) return;
    if (autoBriefEffectRanRef.current) return;
    autoBriefEffectRanRef.current = true;

    const storageKey = `paperclip.jarvis.lastBriefingTimestamp.${selectedCompanyId}`;
    const lastMs = (() => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        return raw ? Number(raw) : 0;
      } catch {
        return 0;
      }
    })();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    if (lastMs && Date.now() - lastMs < FOUR_HOURS) return;

    // Pre-stamp synchronously so any subsequent effect run (or a parallel
    // route in another tab) sees the cooldown immediately, without waiting
    // for the network round trip. fireBriefing re-stamps on success too.
    try {
      window.localStorage.setItem(storageKey, String(Date.now()));
    } catch {}

    const t = window.setTimeout(() => {
      void fireBriefing();
    }, 800);
    return () => window.clearTimeout(t);
  }, [selectedCompanyId, fireBriefing, settingsLoaded, settings.autoBriefOnLoad]);

  // Auto-hide the recommended-action CTA after 60s so it doesn't linger
  // forever if Tyler walks away from the desk.
  useEffect(() => {
    if (!recommendedAction) return;
    const t = window.setTimeout(() => setRecommendedAction(null), 60_000);
    return () => window.clearTimeout(t);
  }, [recommendedAction]);

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
  //
  // voiceMode flag tells the server to strip markdown + tighten prose; we
  // set it true when the input came from the mic, false on text submits.
  // responseType is an optional hint — the morning auto-greet sets
  // "briefing"; the rest let the server infer from the transcript.
  const dispatchTranscript = useCallback(
    async (
      transcript: string,
      opts: { voiceMode?: boolean; responseType?: JarvisResponseType } = {}
    ) => {
      if (!transcript.trim() || !selectedCompanyId) return;
      setState("processing");
      const voiceMode = opts.voiceMode ?? false;
      let reply = "";
      let conversationId: string | null = null;
      let delegation: import("@/api/jarvis").JarvisDelegationAck | null = null;
      try {
        const resp = await jarvisApi.voice(selectedCompanyId, {
          transcript,
          voiceTier,
          voiceMode,
          responseType: opts.responseType,
        });
        reply = resp.reply;
        conversationId = resp.conversationId;
        delegation = resp.delegation ?? null;
      } catch (err) {
        reply = `Network error reaching Jarvis: ${(err as Error).message}`;
      }
      const stamp = formatNow();
      const msgId = `r-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          author: "agent",
          authorLabel: `Jarvis · ${stamp}`,
          text: reply,
          timestamp: stamp,
          delegationId: delegation?.id ?? null,
          delegationAgent: delegation?.agent ?? null,
          delegationStatus: delegation ? delegation.status : null,
        },
      ]);
      // Stash so barge-in handler can mark this message interrupted and
      // post conversation-cancel with an accurate spokenChars value.
      speakingMsgIdRef.current = msgId;
      speakingStartedAtRef.current = performance.now();
      speakingTextRef.current = reply;
      speakingConversationIdRef.current = conversationId;
      setState("speaking");
      // Spin up the barge-in controller (idempotent — second-and-later
      // calls just confirm the existing session). The mode the
      // controller resolves to drives the Premium/Local-VAD badge.
      void bargeInRef.current?.start().then((m) => setBargeInMode(m));
      bargeInRef.current?.clearInterrupt();
      await voice.speak(reply);
      // If barge-in fired during speak(), state was already set to
      // "interrupted" by the handler — don't stomp back to idle.
      speakingMsgIdRef.current = null;
      speakingTextRef.current = "";
      speakingConversationIdRef.current = null;
      setState((cur) => (cur === "interrupted" ? "interrupted" : "idle"));
    },
    [selectedCompanyId, voice, voiceTier]
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
      void dispatchTranscript(trimmed, { voiceMode: false });
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
    await dispatchTranscript(finalText, { voiceMode: true });
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
          <button
            type="button"
            className="jarvis-topbar__brief-me"
            onClick={onBriefMe}
            title="Run the Daddy's Home briefing now"
          >
            Brief me
          </button>
          <VoiceTierPicker tiers={tiers} selected={voiceTier} onSelect={onTierSelect} />
          <button
            type="button"
            className="jarvis-voice-character-btn"
            onClick={() => setVoiceModalOpen(true)}
            title="Change voice character"
          >
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" aria-hidden>
              <rect x={9} y={3} width={6} height={11} rx={3} stroke="currentColor" strokeWidth={1.8} />
              <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
            <span className="name">{voiceCharacter.name}</span>
          </button>
          <button
            className="jarvis-icon-btn"
            title="Settings"
            type="button"
            aria-label="Open Jarvis settings"
            onClick={() => setSettingsOpen((cur) => !cur)}
          >
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
              <span className="jarvis-meta">
                {capabilities
                  ? `${capabilities.filter((c) => c.status === "ready").length} / ${capabilities.length}`
                  : `${MOCK_CAPABILITIES.length} / ${MOCK_CAPABILITIES.length}`}
              </span>
            </div>
            <div className="jarvis-panel-body">
              {capabilities && capabilities.length > 0 ? (
                <CapabilityList capabilities={capabilities} />
              ) : (
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
              )}
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
                  value={
                    currentTier
                      ? `${currentTier.label === "Free" ? "Tier 3" : currentTier.label === "Standard" ? "Tier 2" : "Tier 1"} · ${currentTier.label}`
                      : MOCK_BRIEFING.voiceTierLabel
                  }
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
              <a
                className="jarvis-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void refreshCapabilities(true);
                }}
              >
                {capabilitiesRefreshing ? "Probing…" : "Run Diagnostics"}
              </a>
              {capabilitiesGeneratedAt ? (
                <div className="jarvis-cap-asof">
                  Last probe: {new Date(capabilitiesGeneratedAt).toLocaleTimeString()}
                </div>
              ) : null}
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
              {recommendedAction ? (
                <button
                  type="button"
                  className="jarvis-orb__cta"
                  onClick={() => {
                    const action = recommendedAction;
                    setRecommendedAction(null);
                    void dispatchTranscript(action, { voiceMode: true });
                  }}
                >
                  {recommendedAction}
                </button>
              ) : null}
            </div>
            <div className="jarvis-reactor-label">
              JARVIS PRIME ONLINE
              <span
                className="jarvis-bargein-badge"
                data-mode={bargeInMode}
                title={
                  bargeInMode === "realtime"
                    ? "OpenAI Realtime barge-in active — talk over me anytime."
                    : bargeInMode === "local-vad"
                      ? "Local-VAD barge-in active. Configure openai_realtime for Premium."
                      : "Barge-in inactive."
                }
              >
                <span className="dot" />
                {bargeInMode === "realtime"
                  ? "Barge-in · Premium"
                  : bargeInMode === "local-vad"
                    ? "Barge-in · Local"
                    : ""}
              </span>
            </div>
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
              <span>End-to-end Encrypted</span>
              {currentTier ? (
                <span className="jarvis-cost-hint">
                  · <strong>{currentTier.label} voice</strong> ·
                  {currentTier.costPerMinUsd > 0
                    ? ` ~$${currentTier.costPerMinUsd.toFixed(3)}/min`
                    : " $0/min"}
                </span>
              ) : null}
              <span> · </span>
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
              {messages.length === 0 ? (
                <div className="jarvis-chat-empty">
                  {historyLoaded
                    ? "Tap the mic or type to start. Your conversation lives here once you say something."
                    : "Loading conversation…"}
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`jarvis-msg ${m.author}${m.interrupted ? " interrupted" : ""}`}
                  >
                    <span className="jarvis-msg-author">
                      {m.authorLabel}
                      {m.interrupted ? (
                        <span className="jarvis-msg-interrupt-tag">— interrupted</span>
                      ) : null}
                    </span>
                    <div className="jarvis-msg-bubble">
                      <div className="jarvis-msg-bubble__text">{m.text}</div>
                      {m.author === "agent" && m.text.trim() ? (
                        <button
                          type="button"
                          className="jarvis-msg-replay"
                          aria-label="Replay this message"
                          title="Replay this message"
                          disabled={replayingMsgId === m.id}
                          onClick={() => void onReplayMessage(m.id, m.text)}
                        >
                          {replayingMsgId === m.id ? (
                            <span className="jarvis-msg-replay__speaking">Speaking…</span>
                          ) : (
                            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
                              <path
                                d="M4 12a8 8 0 1 1 2.34 5.66"
                                stroke="currentColor"
                                strokeWidth={1.8}
                                strokeLinecap="round"
                                fill="none"
                              />
                              <path
                                d="M4 6v6h6"
                                stroke="currentColor"
                                strokeWidth={1.8}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                              />
                            </svg>
                          )}
                        </button>
                      ) : null}
                      {m.delegationId && (
                        <DelegationChip
                          agent={m.delegationAgent ?? "peer"}
                          status={m.delegationStatus ?? "queued"}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
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

      <VoiceCharacterModal
        companyId={selectedCompanyId ?? null}
        open={voiceModalOpen}
        selectedVoiceId={voiceCharacter.voiceId}
        onSelect={onVoiceCharacterSelect}
        onClose={() => setVoiceModalOpen(false)}
      />

      {settingsOpen ? (
        <JarvisSettingsPopover
          autoBriefOnLoad={settings.autoBriefOnLoad}
          saving={settingsSaving}
          onToggleAutoBrief={onToggleAutoBrief}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function JarvisSettingsPopover({
  autoBriefOnLoad,
  saving,
  onToggleAutoBrief,
  onClose,
}: {
  autoBriefOnLoad: boolean;
  saving: boolean;
  onToggleAutoBrief: (next: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="jarvis-settings-backdrop" onClick={onClose} aria-hidden />
      <div
        className="jarvis-settings-popover"
        role="dialog"
        aria-label="Jarvis settings"
      >
        <span className="jarvis-corner-tr" />
        <span className="jarvis-corner-bl" />
        <div className="jarvis-settings-header">
          <h3>Settings</h3>
          <button
            type="button"
            className="jarvis-icon-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="jarvis-settings-body">
          <label className="jarvis-settings-row">
            <span className="jarvis-settings-row__label">
              <strong>Auto-brief on page load</strong>
              <span className="jarvis-settings-row__hint">
                Fire the Daddy's Home briefing when you open this page.
                Off by default — use the <em>Brief me</em> button to ask
                on demand. Mac wake + the 7am routine still run.
              </span>
            </span>
            <input
              type="checkbox"
              className="jarvis-settings-toggle"
              checked={autoBriefOnLoad}
              disabled={saving}
              onChange={(e) => onToggleAutoBrief(e.target.checked)}
            />
          </label>
        </div>
      </div>
    </>
  );
}

function CapabilityList({ capabilities }: { capabilities: JarvisCapability[] }) {
  // Group + summarize: show one row per (group, status) bucket with a count.
  // Full per-capability detail is in the tooltip — keeps the rail compact.
  const ordered: JarvisCapability["group"][] = ["machine", "apps", "phone", "paperclip", "web"];
  const groupLabels: Record<JarvisCapability["group"], string> = {
    machine: "Local machine",
    apps: "Mac apps",
    phone: "iPhone bridge",
    paperclip: "Paperclip data",
    web: "Web",
  };
  return (
    <div className="jarvis-caps-list">
      {ordered.map((group) => {
        const inGroup = capabilities.filter((c) => c.group === group);
        if (inGroup.length === 0) return null;
        const ready = inGroup.filter((c) => c.status === "ready").length;
        const needsInstall = inGroup.filter((c) => c.status === "needs_install").length;
        const needsPerm = inGroup.filter((c) => c.status === "needs_permission").length;
        const fillPct = Math.round((ready / inGroup.length) * 100);
        const detail =
          needsInstall + needsPerm > 0
            ? inGroup
                .filter((c) => c.status !== "ready")
                .map((c) =>
                  c.installHint
                    ? `${c.label} — ${c.installHint}`
                    : `${c.label} (${c.status.replace("_", " ")})`
                )
                .join("\n")
            : inGroup.map((c) => c.label).join(", ");
        return (
          <div key={group} className="jarvis-cap" title={detail}>
            <span className="jarvis-cap-label">{groupLabels[group]}</span>
            <span className="jarvis-cap-val">
              {ready}/{inGroup.length}
              {needsInstall > 0 ? <span className="jarvis-cap-warn"> · {needsInstall} install</span> : null}
              {needsPerm > 0 ? <span className="jarvis-cap-warn"> · {needsPerm} grant</span> : null}
            </span>
            <div
              className="jarvis-cap-bar"
              style={{ ["--fill" as string]: `${fillPct}%` }}
            />
          </div>
        );
      })}
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

/**
 * Subtle audio cue fired when a delegation lands. WebAudio so we don't
 * have to ship an asset; the envelope is intentionally short + soft so
 * it's a quiet "ping" rather than a notification klaxon.
 */
function playSoftBell() {
  try {
    const Ctx =
      typeof window !== "undefined"
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : null;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    /* environment doesn't support WebAudio — silent fallback */
  }
}

function conversationsToMessages(turns: JarvisConversationTurn[]): JarvisChatMessage[] {
  const out: JarvisChatMessage[] = [];
  for (const t of turns) {
    const stamp = formatStampFromIso(t.createdAt);
    out.push({
      id: `u-${t.id}`,
      author: "user",
      authorLabel: `You · ${stamp}`,
      text: t.userTranscript,
      timestamp: stamp,
    });
    out.push({
      id: `r-${t.id}`,
      author: "agent",
      authorLabel: `Jarvis · ${stamp}`,
      text: t.agentReply,
      timestamp: stamp,
      interrupted: t.interruptedAt != null,
      interruptedAtChars: t.interruptedAtChars ?? undefined,
    });
  }
  return out;
}

function formatStampFromIso(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

/**
 * Compact pill rendered on agent-side bubbles that triggered a peer-agent
 * delegation. Color follows status: amber while queued/running, green on
 * completion, red on failure. Tapping the chip is a future hook
 * (delegation detail drawer) — for now it surfaces status + agent.
 */
function DelegationChip({
  agent,
  status,
}: {
  agent: string;
  status: "queued" | "running" | "completed" | "failed";
}) {
  const label =
    status === "queued"
      ? `Delegated → ${agent} · queued`
      : status === "running"
        ? `Delegated → ${agent} · running`
        : status === "completed"
          ? `Delegated → ${agent} · done`
          : `Delegated → ${agent} · failed`;
  const tone =
    status === "completed"
      ? "ok"
      : status === "failed"
        ? "err"
        : "wait";
  return (
    <span className={`jarvis-delegation-chip jarvis-delegation-chip-${tone}`}>
      {label}
    </span>
  );
}

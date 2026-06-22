import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  MoreHorizontal,
  Paperclip,
  Mic,
  Repeat,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { jarvisApi, type JarvisConversationTurn } from "@/api/jarvis";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialogActions } from "@/context/DialogContext";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked) — shared with the Home        */
/* redesign. Applied locally so the War Room is self-contained and does not   */
/* mutate global theme variables used by other pages.                         */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
} as const;

const MONO =
  'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid rgba(255,255,255,0.06)`,
  borderRadius: 20,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */
interface PlanStep {
  /** 1-based step number. */
  n: number;
  label: string;
  /** Duration string exactly as proposed, e.g. "2 days". */
  duration: string;
}

interface ProposedPlan {
  title: string;
  version?: string;
  steps: PlanStep[];
  /** Optional meta — only rendered when present (data-honesty). */
  agentsInvolved?: number;
  parallel?: boolean;
  estimatedCompletion?: string;
  totalLabel?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "hermes";
  text: string;
  /** Clock label, e.g. "9:31 AM". */
  ts: string;
  /** Inline proposed-plan card parsed from (or attached to) a Hermes turn. */
  plan?: ProposedPlan | null;
  /** True while a Hermes reply is in flight (renders the typing indicator). */
  pending?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Plan parsing (real wiring) — extracts a structured plan from a Hermes turn */
/* when the message contains a recognizable PROPOSED PLAN block or a fenced   */
/* ```plan / ```json payload. Returns null otherwise (no fabrication).        */
/* -------------------------------------------------------------------------- */
function parsePlan(text: string): ProposedPlan | null {
  if (!text) return null;

  // 1) Fenced JSON plan: ```plan { ... } ``` or ```json { ...steps... } ```
  const fence = text.match(/```(?:plan|json)\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const raw = JSON.parse(fence[1]!.trim()) as Record<string, unknown>;
      const stepsRaw = (raw.steps as unknown[]) ?? [];
      const steps: PlanStep[] = stepsRaw.map((s, i) => {
        const o = s as Record<string, unknown>;
        return {
          n: i + 1,
          label: String(o.label ?? o.step ?? o.title ?? ""),
          duration: String(o.duration ?? o.estimate ?? o.time ?? ""),
        };
      });
      if (steps.length > 0) {
        return {
          title: String(raw.title ?? "Proposed plan"),
          version: raw.version ? String(raw.version) : undefined,
          steps,
          agentsInvolved:
            typeof raw.agentsInvolved === "number"
              ? raw.agentsInvolved
              : undefined,
          parallel: typeof raw.parallel === "boolean" ? raw.parallel : undefined,
          estimatedCompletion: raw.estimatedCompletion
            ? String(raw.estimatedCompletion)
            : undefined,
          totalLabel: raw.total ? `Total: ${String(raw.total)}` : undefined,
        };
      }
    } catch {
      /* fall through to prose parsing */
    }
  }

  // 2) Prose plan: a "PROPOSED PLAN" header followed by numbered steps with a
  //    trailing duration ("1. Finalize core flows & UI — 2 days").
  if (!/proposed plan/i.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const steps: PlanStep[] = [];
  const stepRe = /^\s*(\d+)[.)]\s+(.+?)\s+[—–-]\s+(\d+\s*(?:days?|hrs?|hours?|weeks?|wks?))\.?\s*$/i;
  for (const line of lines) {
    const m = line.match(stepRe);
    if (m) {
      steps.push({ n: steps.length + 1, label: m[2]!.trim(), duration: m[3]!.trim() });
    }
  }
  if (steps.length === 0) return null;

  const titleLine = lines.find((l) => /proposed plan/i.test(l)) ?? "";
  const title =
    titleLine.replace(/[—–-].*proposed plan.*/i, "").replace(/proposed plan/i, "").replace(/[:—–-]/g, " ").trim() ||
    "Proposed plan";
  const totalMatch = text.match(/total:\s*([^\n]+)/i);

  return {
    title: title.toUpperCase(),
    steps,
    totalLabel: totalMatch ? `Total: ${totalMatch[1]!.trim()}` : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Illustrative preview (?demo=1) — shown ONLY behind the demo flag and       */
/* clearly labelled as a preview. Never injected into real conversations.     */
/* -------------------------------------------------------------------------- */
const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: "demo-u1",
    role: "user",
    text: "I want to launch the mobile app MVP this month. Let's ship something great.",
    ts: "9:31 AM",
  },
  {
    id: "demo-h1",
    role: "hermes",
    text: "Understood, Tyler. Here's the plan to deliver a high-quality MVP in 18 days.",
    ts: "9:32 AM",
    plan: {
      title: "MOBILE APP MVP — PROPOSED PLAN",
      version: "v1",
      steps: [
        { n: 1, label: "Finalize core flows & UI", duration: "2 days" },
        { n: 2, label: "Build authentication & onboarding", duration: "3 days" },
        { n: 3, label: "Integrate payments (Stripe)", duration: "2 days" },
        { n: 4, label: "Core feature build", duration: "6 days" },
        { n: 5, label: "QA & performance testing", duration: "3 days" },
        { n: 6, label: "Beta release to 50 users", duration: "2 days" },
      ],
      agentsInvolved: 5,
      parallel: true,
      estimatedCompletion: "May 30",
      totalLabel: "Total: 18 days",
    },
  },
  {
    id: "demo-u2",
    role: "user",
    text: "Looks good. For payments, let's add Apple Pay as well. Also include analytics (Mixpanel).",
    ts: "9:34 AM",
  },
  {
    id: "demo-h2",
    role: "hermes",
    text: "Got it. I'll update the plan with Apple Pay + Mixpanel and adjust the timeline.",
    ts: "9:35 AM",
  },
];

/* -------------------------------------------------------------------------- */
/* Time helpers                                                               */
/* -------------------------------------------------------------------------- */
function clockLabel(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function clockFromIso(iso: string): string {
  try {
    return clockLabel(new Date(iso));
  } catch {
    return "";
  }
}

function turnsToMessages(turns: JarvisConversationTurn[]): ChatMessage[] {
  // API returns most-recent-first in some deployments; render oldest-first.
  const ordered = [...turns].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const out: ChatMessage[] = [];
  for (const t of ordered) {
    const ts = clockFromIso(t.createdAt);
    if (t.userTranscript?.trim()) {
      out.push({ id: `u-${t.id}`, role: "user", text: t.userTranscript, ts });
    }
    if (t.agentReply?.trim()) {
      out.push({
        id: `h-${t.id}`,
        role: "hermes",
        text: t.agentReply,
        ts,
        plan: parsePlan(t.agentReply),
      });
    }
  }
  return out;
}

/* ========================================================================== */
/* War Room                                                                   */
/* ========================================================================== */
export function JarvisPage() {
  const navigate = useNavigate();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialogActions();
  const companyPrefix = selectedCompany?.issuePrefix;

  const isDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1";

  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(isDemo ? DEMO_MESSAGES : []);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "War Room" }]);
  }, [setBreadcrumbs]);

  // Real conversation history. Mapped to the flat thread; plans parsed from
  // Hermes turns when present. Skipped in demo mode.
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["jarvis", "conversations", selectedCompanyId, 30],
    queryFn: () => jarvisApi.conversations(selectedCompanyId!, 30),
    enabled: !!selectedCompanyId && !isDemo,
  });

  useEffect(() => {
    if (isDemo || !history) return;
    setMessages(turnsToMessages(history.conversations));
  }, [history, isDemo]);

  // Auto-scroll the thread to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !selectedCompanyId) return;
      const now = new Date();
      const userMsg: ChatMessage = {
        id: `u-${now.getTime()}`,
        role: "user",
        text,
        ts: clockLabel(now),
      };
      const pendingId = `h-pending-${now.getTime()}`;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: pendingId, role: "hermes", text: "", ts: clockLabel(now), pending: true },
      ]);
      setComposer("");
      setSending(true);
      try {
        const resp = await jarvisApi.voice(selectedCompanyId, {
          transcript: text,
          voiceMode: false,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: pendingId,
                  role: "hermes",
                  text: resp.reply,
                  ts: clockLabel(new Date()),
                  plan: parsePlan(resp.reply),
                }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  pending: false,
                  text: `Couldn't reach Hermes: ${(err as Error).message}`,
                }
              : m,
          ),
        );
      } finally {
        setSending(false);
        composerRef.current?.focus();
      }
    },
    [selectedCompanyId],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void send(composer);
    },
    [composer, send],
  );

  // Approve & send to team — routes through the real Hermes dispatch path so
  // Ares can assign agents. (Structured plan→approval wiring is flagged.)
  const onApprove = useCallback(
    (msgId: string, plan: ProposedPlan) => {
      setApproved((prev) => new Set(prev).add(msgId));
      void send(
        `Approved — send "${plan.title}" to the team and have Ares assign agents to each step.`,
      );
    },
    [send],
  );

  const onAdjust = useCallback(() => {
    composerRef.current?.focus();
    setComposer((c) => (c ? c : ""));
  }, []);

  // Lightweight browser speech-to-text feeding the composer (voice input).
  const toggleMic = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      try {
        (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
      } catch {
        /* noop */
      }
      setListening(false);
      return;
    }
    const rec = new Ctor() as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      start: () => void;
      onresult: ((e: unknown) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    };
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
      let transcript = "";
      for (let i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i]![0]!.transcript;
      }
      setComposer(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  const micSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!(
        (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
      ),
    [],
  );

  const route = (path: string) => (companyPrefix ? `/${companyPrefix}${path}` : path);

  const showEmpty = !isDemo && messages.length === 0 && !historyLoading;

  return (
    <div
      className="-mx-4 flex h-full min-h-0 flex-col md:-mx-6"
      style={{ background: DS.canvas, color: DS.text }}
      data-pp-page-v2="war-room"
    >
      {/* Header */}
      <header
        className="flex shrink-0 items-start justify-between gap-4 px-8 pb-4 pt-6"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight" style={{ color: DS.text }}>
            War Room
          </h1>
          <p className="mt-0.5 text-[14px]" style={{ color: DS.textMuted }}>
            Talk to Hermes. Plan, refine, and approve work before it moves.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isDemo ? (
            <span
              className="rounded-full px-3 py-1 text-[11px] font-medium"
              style={{
                background: "rgba(244,185,64,0.12)",
                border: `1px solid rgba(244,185,64,0.4)`,
                color: DS.warning,
              }}
              title="Illustrative preview — the proposed-plan content is sample data pending server wiring."
            >
              Illustrative preview
            </span>
          ) : null}
          <span
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium"
            style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.text }}
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{ background: DS.primary }}
            >
              <Sparkles className="h-3 w-3" style={{ color: "#fff" }} />
            </span>
            Hermes
            <span className="flex items-center gap-1 text-[11px]" style={{ color: DS.success }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: DS.success }} />
              Online
            </span>
          </span>
        </div>
      </header>

      {/* Conversation thread (full width) */}
      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
        aria-label="Conversation with Hermes"
      >
        <div className="w-full max-w-[880px]">
          <DayDivider label="Today" />
          {showEmpty ? (
            <EmptyThread />
          ) : (
            <div className="flex flex-col gap-7">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  msg={m}
                  approved={approved.has(m.id)}
                  onApprove={onApprove}
                  onAdjust={onAdjust}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer + quick actions */}
      <div className="shrink-0 px-8 pb-6 pt-2" style={{ borderTop: `1px solid ${DS.border}` }}>
        <div className="w-full max-w-[880px]">
          <form onSubmit={onSubmit} style={surfaceCard} className="flex flex-col gap-2 p-3">
            <textarea
              ref={composerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(composer);
                }
              }}
              rows={1}
              placeholder="Message Hermes…"
              className="max-h-40 min-h-[28px] w-full resize-none bg-transparent px-2 pt-1 text-[15px] outline-none"
              style={{ color: DS.text }}
              aria-label="Message Hermes"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <IconButton title="Attach" ariaLabel="Attach a file">
                  <Paperclip className="h-4 w-4" />
                </IconButton>
                <IconButton
                  title={
                    micSupported
                      ? listening
                        ? "Stop listening"
                        : "Speak to Hermes"
                      : "Voice input unavailable in this browser"
                  }
                  ariaLabel="Voice input"
                  onClick={micSupported ? toggleMic : undefined}
                  active={listening}
                  disabled={!micSupported}
                >
                  <Mic className="h-4 w-4" />
                </IconButton>
              </div>
              <button
                type="submit"
                disabled={!composer.trim() || sending}
                className="flex h-9 w-9 items-center justify-center rounded-[12px] transition-opacity disabled:opacity-40"
                style={{ background: DS.primary, color: "#fff" }}
                aria-label="Send message"
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </form>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QuickAction
              label="Launch Task"
              hint="Create a new task"
              accent={DS.primary}
              onClick={() => openNewIssue()}
              icon={<SquarePen className="h-[18px] w-[18px]" />}
            />
            <QuickAction
              label="Search"
              hint="Find anything"
              accent="#A56EFF"
              onClick={() => navigate(route("/search"))}
              icon={<SearchIcon className="h-[18px] w-[18px]" />}
            />
            <QuickAction
              label="Automate"
              hint="Build a routine"
              accent={DS.success}
              onClick={() => navigate(route("/routines"))}
              icon={<Repeat className="h-[18px] w-[18px]" />}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Day divider                                                                */
/* -------------------------------------------------------------------------- */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="mb-7 flex items-center gap-4">
      <span className="h-px flex-1" style={{ background: DS.border }} />
      <span className="text-[12px] font-medium" style={{ color: DS.textFaint }}>
        {label}
      </span>
      <span className="h-px flex-1" style={{ background: DS.border }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty thread                                                               */
/* -------------------------------------------------------------------------- */
function EmptyThread() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: DS.primary }}
      >
        <Sparkles className="h-6 w-6" style={{ color: "#fff" }} />
      </span>
      <div className="text-[16px] font-semibold" style={{ color: DS.text }}>
        Start the conversation with Hermes
      </div>
      <p className="max-w-[420px] text-[13px]" style={{ color: DS.textMuted }}>
        Describe what you want the fleet to work on. Hermes proposes a plan with
        steps and timing — you approve before anything moves.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Message row (flat, full width)                                             */
/* -------------------------------------------------------------------------- */
function MessageRow({
  msg,
  approved,
  onApprove,
  onAdjust,
}: {
  msg: ChatMessage;
  approved: boolean;
  onApprove: (msgId: string, plan: ProposedPlan) => void;
  onAdjust: () => void;
}) {
  const isHermes = msg.role === "hermes";
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      {isHermes ? (
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: DS.primary }}
          aria-hidden
        >
          <Sparkles className="h-4 w-4" style={{ color: "#fff" }} />
        </span>
      ) : (
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
          style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
          aria-hidden
        >
          You
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* Author line */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: isHermes ? DS.primary : DS.text }}>
            {isHermes ? "Hermes" : "You"}
          </span>
          {isHermes ? (
            <span className="text-[12px]" style={{ color: DS.textFaint }}>
              Chief of Staff
            </span>
          ) : null}
          {msg.ts ? (
            <span className="text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
              {msg.ts}
            </span>
          ) : null}
        </div>

        {/* Body */}
        {msg.pending ? (
          <TypingDots />
        ) : (
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: DS.text }}>
            {planPreface(msg.text)}
          </div>
        )}

        {/* Inline proposed-plan card */}
        {msg.plan ? (
          <PlanCard
            plan={msg.plan}
            approved={approved}
            onApprove={() => onApprove(msg.id, msg.plan!)}
            onAdjust={onAdjust}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Strip a fenced plan block / numbered plan body from the prose so the card
 *  is the single source of truth for the steps. */
function planPreface(text: string): string {
  let t = text.replace(/```(?:plan|json)[\s\S]*?```/i, "").trim();
  // Drop the "PROPOSED PLAN" header + numbered step lines if they were prose.
  if (/proposed plan/i.test(t)) {
    const lines = t.split(/\r?\n/);
    const kept = lines.filter(
      (l) =>
        !/proposed plan/i.test(l) &&
        !/^\s*\d+[.)]\s+.+[—–-]\s*\d+\s*(days?|hrs?|hours?|weeks?|wks?)/i.test(l) &&
        !/^\s*total:/i.test(l) &&
        !/agents? involved|parallel execution|estimated completion/i.test(l),
    );
    t = kept.join("\n").trim();
  }
  return t;
}

/* -------------------------------------------------------------------------- */
/* Typing indicator                                                           */
/* -------------------------------------------------------------------------- */
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="Hermes is typing">
      <Dot delay="0ms" />
      <Dot delay="160ms" />
      <Dot delay="320ms" />
      <style>{`@keyframes wr-bounce{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  );
}
function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full"
      style={{ background: DS.primary, animation: `wr-bounce 1.2s ${delay} infinite ease-in-out` }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Proposed-plan card                                                         */
/* -------------------------------------------------------------------------- */
function PlanCard({
  plan,
  approved,
  onApprove,
  onAdjust,
}: {
  plan: ProposedPlan;
  approved: boolean;
  onApprove: () => void;
  onAdjust: () => void;
}) {
  const meta: string[] = [];
  if (typeof plan.agentsInvolved === "number") meta.push(`${plan.agentsInvolved} agents involved`);
  if (plan.parallel) meta.push("Parallel execution");
  if (plan.estimatedCompletion) meta.push(`Estimated completion: ${plan.estimatedCompletion}`);

  return (
    <div className="mt-3 overflow-hidden" style={surfaceCard}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 pb-3 pt-4"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="text-[12px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: DS.text }}
          >
            {plan.title}
          </span>
          {plan.version ? (
            <span
              className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
            >
              {plan.version}
            </span>
          ) : null}
        </div>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: DS.textFaint }}
        >
          Est. time
        </span>
      </div>

      {/* Steps */}
      <div className="px-5 py-1">
        {plan.steps.map((s, i) => (
          <div
            key={s.n}
            className="flex items-center justify-between gap-4 py-2.5"
            style={{ borderBottom: i === plan.steps.length - 1 ? "none" : `1px solid ${DS.border}` }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="w-4 shrink-0 text-right text-[13px] tabular-nums"
                style={{ color: DS.textFaint, fontFamily: MONO }}
              >
                {s.n}
              </span>
              <span className="truncate text-[14px]" style={{ color: DS.text }}>
                {s.label}
              </span>
            </div>
            <span
              className="shrink-0 text-[13px] tabular-nums"
              style={{ color: DS.textMuted, fontFamily: MONO }}
            >
              {s.duration}
            </span>
          </div>
        ))}
      </div>

      {/* Meta + total */}
      {meta.length > 0 ? (
        <div className="flex items-center gap-2 px-5 pt-3 text-[12px]" style={{ color: DS.textFaint }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: DS.success }} />
          {meta.join("  ·  ")}
        </div>
      ) : null}
      {plan.totalLabel ? (
        <div className="px-5 pb-1 pt-2 text-[13px] font-semibold" style={{ color: DS.text }}>
          {plan.totalLabel}
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex items-center gap-2 px-5 pb-4 pt-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={approved}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: DS.primary, color: "#fff" }}
        >
          {approved ? <Check className="h-4 w-4" /> : <ArrowUp className="h-4 w-4 rotate-45" />}
          {approved ? "Sent to team" : "Approve & send to team"}
        </button>
        <button
          type="button"
          onClick={onAdjust}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2 text-[13px] font-medium transition-colors"
          style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.text }}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Adjust plan
        </button>
        <button
          type="button"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-[12px] transition-colors"
          style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
          aria-label="More plan options"
          title="More"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick action card                                                          */
/* -------------------------------------------------------------------------- */
function QuickAction({
  label,
  hint,
  icon,
  accent,
  onClick,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={surfaceCard}
      className="group flex items-center gap-3 px-4 py-3 text-left transition-colors"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: accent }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold" style={{ color: DS.text }}>
          {label}
        </span>
        <span className="block text-[12px]" style={{ color: DS.textFaint }}>
          {hint}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Icon button (composer toolbar)                                             */
/* -------------------------------------------------------------------------- */
function IconButton({
  children,
  title,
  ariaLabel,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode;
  title: string;
  ariaLabel: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors disabled:opacity-40"
      style={{
        color: active ? DS.primary : DS.textMuted,
        background: active ? "rgba(59,130,255,0.12)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

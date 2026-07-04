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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  Copy,
  Eraser,
  Eye,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Mic,
  Repeat,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  StopCircle,
  X,
} from "lucide-react";
import { jarvisApi, type JarvisConversationTurn } from "@/api/jarvis";
import { roomsApi } from "@/api/rooms";
import type { Room, RoomMessage } from "@paperclipai/shared";
import TeamModeBoard from "./TeamModeBoard";
import LiveActivityFeed from "./LiveActivityFeed";
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
  role: "user" | "zeus";
  text: string;
  /** Clock label, e.g. "9:31 AM". */
  ts: string;
  /** Inline proposed-plan card parsed from (or attached to) a Zeus turn. */
  plan?: ProposedPlan | null;
  /** True while a Zeus reply is in flight (renders the typing indicator). */
  pending?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Plan parsing (real wiring) — extracts a structured plan from a Zeus turn */
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
    role: "zeus",
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
    role: "zeus",
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
        role: "zeus",
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
/* -------------------------------------------------------------------------- */
/* Rooms tab — fold the room list into the War Room.                          */
/* Reuses roomsApi, same DS tokens as the rest of this page.                  */
/* -------------------------------------------------------------------------- */
function WarRoomRoomsList({ companyId }: { companyId: string | null }) {
  const navigate = useNavigate();
  const { data: rooms, isLoading } = useQuery({
    queryKey: ["jarvis", "rooms-tab", companyId],
    queryFn: () => roomsApi.list(companyId!),
    enabled: !!companyId,
  });

  if (!companyId) {
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: DS.textMuted }}>
        Select a company to view rooms.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-8 py-10 text-[13px]" style={{ color: DS.textMuted }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rooms…
      </div>
    );
  }

  const list = rooms ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold" style={{ color: DS.text }}>
          Agent Rooms
        </h2>
        <p className="mt-0.5 text-[13px]" style={{ color: DS.textMuted }}>
          Shared spaces where agents collaborate.
        </p>
      </div>
      {list.length === 0 ? (
        <div
          className="rounded-xl px-5 py-6 text-[13px]"
          style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
        >
          No rooms yet. Create one from the Rooms page to bring agents together.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((room) => (
            <div
              key={room.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/rooms/${room.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(`/rooms/${room.id}`); }}
              style={{
                background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
                border: `1px solid rgba(255,255,255,0.06)`,
                borderRadius: 20,
                boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
              }}
              className="cursor-pointer p-5 transition-colors hover:brightness-110"
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${DS.primary}1A`, border: `1px solid ${DS.border2}` }}
                >
                  <MessageSquare className="h-4 w-4" style={{ color: DS.primary }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold" style={{ color: DS.text }}>
                      {room.name}
                    </h3>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style={{
                        background: room.status === "active" ? `${DS.success}1F` : `${DS.textFaint}1F`,
                        color: room.status === "active" ? DS.success : DS.textFaint,
                      }}
                    >
                      {room.status}
                    </span>
                  </div>
                  {room.description && (
                    <p className="mt-1 line-clamp-2 text-xs" style={{ color: DS.textMuted }}>
                      {room.description}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
                    >
                      {room.type}
                    </span>
                    <span className="text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
                      Created {new Date(room.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Brainstorm — live Zeus <-> Brainstorm planning transcript.               */
/* Streams the planning room's messages (real room transport). When no        */
/* planning session is live yet, shows an honest empty state (never faked).   */
/* -------------------------------------------------------------------------- */
function BrainstormPanel({ companyId }: { companyId: string | null }) {
  const { data: rooms } = useQuery({
    queryKey: ["jarvis", "brainstorm", "rooms", companyId],
    queryFn: () => roomsApi.list(companyId!),
    enabled: !!companyId,
    refetchInterval: 15000,
  });
  const planningRoom = (rooms ?? []).find((r) =>
    /brainstorm|planning|plan loop|hermes.*plan/i.test(r.name),
  );
  const roomId = planningRoom?.id ?? null;

  const { data: page } = useQuery({
    queryKey: ["jarvis", "brainstorm", "messages", companyId, roomId],
    queryFn: () => roomsApi.listMessages(companyId!, roomId!, undefined, 100),
    enabled: !!companyId && !!roomId,
    refetchInterval: 3000,
  });
  const messages: RoomMessage[] = page?.messages ?? [];
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const speakerLabel = (m: RoomMessage): string => {
    const id = (m.senderId || "").toLowerCase();
    if (id.includes("hermes")) return "Zeus";
    if (id.includes("brainstorm") || id.includes("glm") || id.includes("atlas")) return "Brainstorm";
    if (m.senderType === "user") return "Tyler";
    if (m.senderType === "system") return "System";
    return m.senderId || "agent";
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6" aria-label="Zeus and Brainstorm planning">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold" style={{ color: DS.text }}>
          Zeus ↔ Brainstorm — live planning
        </h2>
        <p className="mt-0.5 text-[13px]" style={{ color: DS.textMuted }}>
          When you approve a project in Conversation, Zeus opens a planning loop with Brainstorm (GLM-5.2). Their exchange streams here live.
        </p>
      </div>
      {!companyId ? (
        <div className="text-[13px]" style={{ color: DS.textMuted }}>
          Select a company to view planning sessions.
        </div>
      ) : !roomId ? (
        <div
          className="rounded-xl px-5 py-6 text-[13px]"
          style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
        >
          <div className="flex items-center gap-2" style={{ color: DS.text }}>
            <Lightbulb className="h-4 w-4" style={{ color: DS.primary }} />
            <span className="font-medium">No live planning session yet</span>
          </div>
          <p className="mt-2">
            Approve a plan in the Conversation tab to kick off a Zeus ↔ Brainstorm planning loop. Their back-and-forth will appear here live as they converge on a plan.
          </p>
        </div>
      ) : messages.length === 0 ? (
        <div className="text-[13px]" style={{ color: DS.textMuted }}>
          Planning room <span style={{ color: DS.text }}>{planningRoom?.name}</span> is open — waiting for the first message…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => {
            const who = speakerLabel(m);
            const isZeus = who === "Zeus";
            return (
              <div
                key={m.id}
                className="rounded-xl px-4 py-3"
                style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: isZeus ? DS.primary : DS.text }}>
                    {who}
                  </span>
                  <span className="text-[11px]" style={{ color: DS.textMuted }}>
                    {clockFromIso(String(m.createdAt))}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: DS.text }}>
                  {m.content}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

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
  // Per-message approval feedback (where the plan landed / errors). Keyed by
  // message id so each card shows its own status line under the buttons.
  const [approvalInfo, setApprovalInfo] = useState<
    Record<string, { state: "sending" | "sent" | "queued" | "error"; detail: string }>
  >({});
  const recognitionRef = useRef<unknown>(null);
  // War Room view: the conversation cockpit vs the read-only Team Mode board.
  const [view, setView] = useState<"chat" | "brainstorm" | "team" | "rooms" | "live" | "history">("chat");
  // "Clear chat" control — soft-hides the on-screen transcript only.
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // End Session — archive the current Brainstorm room
  const [endingSession, setEndingSession] = useState(false);
  const { data: roomsForSession } = useQuery({
    queryKey: ["jarvis", "brainstorm", "rooms", selectedCompanyId],
    queryFn: () => roomsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });
  const activeRoom = (roomsForSession ?? []).find(
    (r) => /brainstorm|planning|plan loop|hermes.*plan/i.test(r.name) && r.status === "active"
  );

  const onEndSession = useCallback(async () => {
    if (!selectedCompanyId || !activeRoom || endingSession) return;
    setEndingSession(true);
    try {
      await jarvisApi.completeRoom(selectedCompanyId, activeRoom.id);
      showToast(`Session "${activeRoom.name}" archived to vault`, "success");
      void queryClient.invalidateQueries({ queryKey: ["jarvis", "brainstorm", "rooms"] });
    } catch (err) {
      showToast(`Failed to archive session: ${(err as Error).message}`, "error");
    } finally {
      setEndingSession(false);
    }
  }, [selectedCompanyId, activeRoom, endingSession, queryClient, showToast]);

  useEffect(() => {
    setBreadcrumbs([{ label: "War Room" }]);
  }, [setBreadcrumbs]);

  // Real conversation history. Mapped to the flat thread; plans parsed from
  // Zeus turns when present. Skipped in demo mode.
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
        { id: pendingId, role: "zeus", text: "", ts: clockLabel(now), pending: true },
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
                  role: "zeus",
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
                  text: `Couldn't reach Zeus: ${(err as Error).message}`,
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

  // Clear the visible conversation. NON-DESTRUCTIVE: hits the soft-hide
  // endpoint (stamps cleared_at server-side) and empties the local thread.
  // Zeus's memory is untouched — his next reply still has full continuity.
  const onClearChat = useCallback(async () => {
    if (!selectedCompanyId) return;
    setClearing(true);
    try {
      await jarvisApi.clearConversations(selectedCompanyId);
      setMessages([]);
      setApproved(new Set());
      // Drop cached history so any refetch reflects the now-hidden rows.
      void queryClient.invalidateQueries({
        queryKey: ["jarvis", "conversations"],
      });
    } catch {
      /* keep the view as-is if the clear call fails */
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }, [selectedCompanyId, queryClient]);

  // Approve & send to team — records the approval and hands the plan to Ares
  // (COO / distributor) over the REAL delegation/handoff path
  // (POST /jarvis/plan/approve -> dispatchDelegation -> bridge /jarvis/dispatch
  // as identity "ares"). The status line under the buttons shows where it
  // landed (Sent to Ares / queued / error) — no faked success toast.
  const onApprove = useCallback(
    async (msgId: string, plan: ProposedPlan) => {
      if (!selectedCompanyId) return;
      setApproved((prev) => new Set(prev).add(msgId));
      setApprovalInfo((prev) => ({
        ...prev,
        [msgId]: { state: "sending", detail: "Handing off to Ares…" },
      }));
      try {
        const r = await jarvisApi.approvePlan(selectedCompanyId, {
          title: plan.title,
          steps: plan.steps.map((s) => ({
            n: s.n,
            label: s.label,
            duration: s.duration,
          })),
          estimatedCompletion: plan.estimatedCompletion,
          agentsInvolved: plan.agentsInvolved,
        });
        if (r.status === "failed") {
          // Roll the button back so Tyler can retry.
          setApproved((prev) => {
            const n = new Set(prev);
            n.delete(msgId);
            return n;
          });
          setApprovalInfo((prev) => ({
            ...prev,
            [msgId]: {
              state: "error",
              detail: r.error
                ? `Couldn't hand off to Ares: ${r.error}`
                : "Couldn't hand off to Ares.",
            },
          }));
        } else if (!r.reachable) {
          setApprovalInfo((prev) => ({
            ...prev,
            [msgId]: {
              state: "queued",
              detail:
                "Ares' bridge is down — plan queued; it'll dispatch when the daemon's back up.",
            },
          }));
        } else {
          setApprovalInfo((prev) => ({
            ...prev,
            [msgId]: {
              state: "sent",
              detail: "Sent to Ares — fanning the steps out to the team.",
            },
          }));
        }
        // Reconcile against the REAL delegation row a couple seconds later. The
        // bridge POST is fire-and-forget, so the synchronous ack is optimistic;
        // if the bridge has no "ares" identity wired yet the row flips to
        // "failed" and we surface that honestly instead of a false success.
        if (r.delegationId && r.status !== "failed") {
          const delegationId = r.delegationId;
          window.setTimeout(() => {
            void jarvisApi
              .delegations(selectedCompanyId, { limit: 20 })
              .then((list) => {
                const row = list.delegations.find((d) => d.id === delegationId);
                if (!row) return;
                if (row.status === "failed") {
                  setApprovalInfo((prev) => ({
                    ...prev,
                    [msgId]: {
                      state: "queued",
                      detail:
                        "Handoff recorded and the bridge was reached, but Ares' dispatch endpoint isn't registered on the bridge yet — set JARVIS_PEER_ARES_URL/TOKEN so it lands.",
                    },
                  }));
                } else if (row.status === "running" || row.status === "completed") {
                  setApprovalInfo((prev) => ({
                    ...prev,
                    [msgId]: {
                      state: "sent",
                      detail: "Ares picked it up — fanning the steps out to the team.",
                    },
                  }));
                }
              })
              .catch(() => {
                /* keep the optimistic line if the poll fails */
              });
          }, 2200);
        }
      } catch (err) {
        setApproved((prev) => {
          const n = new Set(prev);
          n.delete(msgId);
          return n;
        });
        setApprovalInfo((prev) => ({
          ...prev,
          [msgId]: {
            state: "error",
            detail: `Couldn't hand off to Ares: ${(err as Error).message}`,
          },
        }));
      }
    },
    [selectedCompanyId],
  );

  // EXPLICIT "Send to Brainstorm". Two-step (arm -> confirm) so it never fires
  // on an accidental click. Hands the agreed plan to the server, which distills
  // the brief, opens the planning room, and runs the bounded Zeus<->Brainstorm
  // loop; we then switch to the Brainstorm tab to watch it stream live.
  const [kickoffArmedId, setKickoffArmedId] = useState<string | null>(null);
  const [kickoffBusy, setKickoffBusy] = useState(false);
  const onSendToBrainstorm = useCallback(
    async (msgId: string, plan: ProposedPlan) => {
      if (!selectedCompanyId || kickoffBusy) return;
      if (kickoffArmedId !== msgId) {
        setKickoffArmedId(msgId);
        return;
      }
      setKickoffBusy(true);
      try {
        const seedText =
          `${plan.title}\n` +
          plan.steps.map((s) => `${s.n}. ${s.label}`).join("\n");
        await jarvisApi.brainstormKickoff(selectedCompanyId, {
          title: plan.title,
          seedText,
        });
        setKickoffArmedId(null);
        setView("brainstorm");
      } catch {
        setKickoffArmedId(null);
      } finally {
        setKickoffBusy(false);
      }
    },
    [selectedCompanyId, kickoffArmedId, kickoffBusy],
  );

  // Adjust plan — seed the composer with a revision request scaffold referencing
  // the plan, focus it, and put the caret at the end. Tyler types what to change
  // and hits enter; that goes back to Zeus, who returns a revised plan card.
  const onAdjust = useCallback((plan?: ProposedPlan) => {
    if (plan?.title) {
      setComposer((c) =>
        c && c.trim() ? c : `Revise the "${plan.title}" plan — `,
      );
    }
    // Focus on the next tick so the seeded value is in the textarea first.
    window.setTimeout(() => {
      const el = composerRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, 0);
  }, []);

  // Dismiss a plan card — drops the inline plan from the message locally so the
  // card disappears. Non-destructive: the underlying Zeus turn text stays.
  const onDismissPlan = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, plan: null } : m)),
    );
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
        className="flex shrink-0 items-start justify-between gap-4 px-8 pt-6"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight" style={{ color: DS.text }}>
            War Room
          </h1>
          <p className="mt-0.5 text-[14px]" style={{ color: DS.textMuted }}>
            Talk to Zeus. Plan, refine, and approve work before it moves.
          </p>
        </div>
      </header>

      {/* Toast */}
      {toast ? (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-[13px] font-medium shadow-lg transition-opacity"
          style={{
            background: toast.type === "success" ? DS.success : DS.critical,
            color: "#fff",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      {/* Centered mode bar */}
      <div
        className="flex shrink-0 items-center justify-center gap-3 px-8 py-3"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >

          {/* View switch: Conversation cockpit ↔ read-only Team Mode board */}
          <div
            className="flex items-center rounded-full p-0.5"
            style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}
            role="tablist"
            aria-label="War Room view"
          >
            {([
              { id: "chat", label: "Conversation" },
              { id: "brainstorm", label: "Brainstorm" },
              { id: "team", label: "Team Mode" },
              { id: "history", label: "History" },
            ] as const).map((t) => {
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(t.id)}
                  className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background: active ? DS.primary : "transparent",
                    color: active ? "#fff" : DS.textMuted,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {view === "chat" && !isDemo ? (
            confirmClear ? (
              <div
                className="flex items-center gap-2 rounded-full px-2.5 py-1"
                style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}
              >
                <span className="text-[12px]" style={{ color: DS.textMuted }}>
                  Clear this view? Zeus keeps his memory.
                </span>
                <button
                  type="button"
                  onClick={() => void onClearChat()}
                  disabled={clearing}
                  className="rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors"
                  style={{ background: DS.primary, color: "#fff" }}
                  data-testid="warroom-clear-confirm"
                >
                  {clearing ? "Clearing\u2026" : "Clear view"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearing}
                  className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                  style={{ background: "transparent", color: DS.textMuted }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                title="Clear the on-screen conversation. Zeus keeps his memory."
                aria-label="Clear chat"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
                data-testid="warroom-clear-chat"
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear chat
              </button>
            )
          ) : null}
          {(view === "chat" || view === "brainstorm") && activeRoom ? (
            <button
              type="button"
              onClick={() => void onEndSession()}
              disabled={endingSession}
              title="Archive this session to the vault"
              aria-label="End session"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
              style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.warning }}
            >
              <StopCircle className="h-3.5 w-3.5" />
              {endingSession ? "Archiving…" : "End Session"}
            </button>
          ) : null}
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
            Zeus
            <span className="flex items-center gap-1 text-[11px]" style={{ color: DS.success }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: DS.success }} />
              Online
            </span>
          </span>
        
      </div>


      {view === "brainstorm" ? (
        <BrainstormPanel companyId={selectedCompanyId ?? null} />
      ) : view === "team" ? (
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Team Mode board">
          {selectedCompanyId ? (
            <TeamModeBoard companyId={selectedCompanyId} />
          ) : (
            <div className="px-8 py-10 text-[13px]" style={{ color: DS.textMuted }}>
              Select a company to see its team.
            </div>
          )}
        </div>
      ) : view === "history" ? (
        <HistoryPanel companyId={selectedCompanyId ?? null} />
      ) : (
        <>
      {/* Conversation thread (full width) */}
      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
        aria-label="Conversation with Zeus"
      >
        <div className="w-full ">
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
                  approvalInfo={approvalInfo[m.id] ?? null}
                  onApprove={onApprove}
                  onAdjust={onAdjust}
                  onDismiss={onDismissPlan}
                  onSendToBrainstorm={onSendToBrainstorm}
                  kickoffArmed={kickoffArmedId === m.id}
                  kickoffBusy={kickoffBusy}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer + quick actions */}
      <div className="shrink-0 px-8 pb-6 pt-2" style={{ borderTop: `1px solid ${DS.border}` }}>
        <div className="w-full ">
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
              placeholder="Message Zeus…"
              className="max-h-40 min-h-[28px] w-full resize-none bg-transparent px-2 pt-1 text-[15px] outline-none"
              style={{ color: DS.text }}
              aria-label="Message Zeus"
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
                        : "Speak to Zeus"
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
        </>
      )}
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
        Start the conversation with Zeus
      </div>
      <p className="max-w-[420px] text-[13px]" style={{ color: DS.textMuted }}>
        Describe what you want the fleet to work on. Zeus proposes a plan with
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
  approvalInfo,
  onApprove,
  onAdjust,
  onDismiss,
  onSendToBrainstorm,
  kickoffArmed,
  kickoffBusy,
}: {
  msg: ChatMessage;
  approved: boolean;
  approvalInfo: { state: "sending" | "sent" | "queued" | "error"; detail: string } | null;
  onApprove: (msgId: string, plan: ProposedPlan) => void;
  onAdjust: (plan?: ProposedPlan) => void;
  onDismiss: (msgId: string) => void;
  onSendToBrainstorm: (msgId: string, plan: ProposedPlan) => void;
  kickoffArmed: boolean;
  kickoffBusy: boolean;
}) {
  const isZeus = msg.role === "zeus";
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      {isZeus ? (
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
          <span className="text-[13px] font-semibold" style={{ color: isZeus ? DS.primary : DS.text }}>
            {isZeus ? "Zeus" : "You"}
          </span>
          {isZeus ? (
            <span className="text-[12px]" style={{ color: DS.textFaint }}>
              Top Orchestrator
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
            approvalInfo={approvalInfo}
            onApprove={() => onApprove(msg.id, msg.plan!)}
            onAdjust={() => onAdjust(msg.plan!)}
            onDismiss={() => onDismiss(msg.id)}
            onSendToBrainstorm={() => onSendToBrainstorm(msg.id, msg.plan!)}
            kickoffArmed={kickoffArmed}
            kickoffBusy={kickoffBusy}
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
    <div className="flex items-center gap-1.5 py-1" aria-label="Zeus is typing">
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
  approvalInfo,
  onApprove,
  onAdjust,
  onDismiss,
  onSendToBrainstorm,
  kickoffArmed,
  kickoffBusy,
}: {
  plan: ProposedPlan;
  approved: boolean;
  approvalInfo: { state: "sending" | "sent" | "queued" | "error"; detail: string } | null;
  onApprove: () => void;
  onAdjust: () => void;
  onDismiss: () => void;
  onSendToBrainstorm: () => void;
  kickoffArmed: boolean;
  kickoffBusy: boolean;
}) {
  // Overflow ("…") menu + "View full plan" expansion + copy feedback. Local to
  // the card so each plan card manages its own popover.
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta: string[] = [];
  if (typeof plan.agentsInvolved === "number") meta.push(`${plan.agentsInvolved} agents involved`);
  if (plan.parallel) meta.push("Parallel execution");
  if (plan.estimatedCompletion) meta.push(`Estimated completion: ${plan.estimatedCompletion}`);

  // Plain-text rendering of the whole plan — used by "View full plan" and
  // "Copy plan" in the overflow menu.
  const fullPlanText =
    `${plan.title}${plan.version ? ` (${plan.version})` : ""}\n` +
    plan.steps
      .map((s) => `${s.n}. ${s.label}${s.duration ? ` — ${s.duration}` : ""}`)
      .join("\n") +
    (meta.length ? `\n\n${meta.join("  ·  ")}` : "") +
    (plan.totalLabel ? `\n${plan.totalLabel}` : "");

  const copyPlan = () => {
    try {
      void navigator.clipboard?.writeText(fullPlanText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
    setMenuOpen(false);
  };

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
          onClick={onSendToBrainstorm}
          disabled={kickoffBusy}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2 text-[13px] font-medium transition-colors hover:opacity-90 disabled:opacity-60"
          style={
            kickoffArmed
              ? { background: DS.primary, color: "#fff" }
              : { background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.text }
          }
          title="Hand this agreed plan to Brainstorm (GLM-5.2) and watch Zeus and Brainstorm converge on a plan"
        >
          <Lightbulb className="h-4 w-4" />
          {kickoffBusy
            ? "Opening planning room…"
            : kickoffArmed
              ? "Confirm — start planning loop"
              : "Send to Brainstorm"}
        </button>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-[12px] transition-colors"
            style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
            aria-label="More plan options"
            title="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <>
              {/* Click-away backdrop */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
                style={{ background: "transparent" }}
              />
              <div
                role="menu"
                className="absolute bottom-full right-0 z-50 mb-2 w-52 overflow-hidden rounded-[12px] py-1"
                style={{
                  background: DS.surface2,
                  border: `1px solid ${DS.border2}`,
                  boxShadow: "0 12px 32px -12px rgba(0,0,0,0.8)",
                }}
              >
                <MenuItem
                  icon={<Eye className="h-4 w-4" />}
                  label={expanded ? "Hide full plan" : "View full plan"}
                  onClick={() => {
                    setExpanded((e) => !e);
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  label={copied ? "Copied" : "Copy plan"}
                  onClick={copyPlan}
                />
                <MenuItem
                  icon={<Lightbulb className="h-4 w-4" />}
                  label="Send to Brainstorm"
                  onClick={() => {
                    onSendToBrainstorm();
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon={<X className="h-4 w-4" />}
                  label="Dismiss"
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    onDismiss();
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Approval feedback — shows exactly where the plan landed (Sent to Ares /
          queued / error). Additive line; the card layout above is untouched. */}
      {approvalInfo ? (
        <div
          className="flex items-center gap-2 px-5 pb-4 text-[12px]"
          style={{
            color:
              approvalInfo.state === "error"
                ? DS.critical
                : approvalInfo.state === "queued"
                  ? DS.warning
                  : approvalInfo.state === "sent"
                    ? DS.success
                    : DS.textMuted,
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background:
                approvalInfo.state === "error"
                  ? DS.critical
                  : approvalInfo.state === "queued"
                    ? DS.warning
                    : approvalInfo.state === "sent"
                      ? DS.success
                      : DS.textFaint,
            }}
          />
          {approvalInfo.detail}
        </div>
      ) : null}

      {/* Full-plan expansion (toggled from the overflow menu). */}
      {expanded ? (
        <div
          className="px-5 pb-4 pt-1"
          style={{ borderTop: `1px solid ${DS.border}` }}
        >
          <pre
            className="whitespace-pre-wrap text-[12px] leading-relaxed"
            style={{ color: DS.textMuted, fontFamily: MONO, margin: 0 }}
          >
            {fullPlanText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/* Overflow-menu row. */
function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:opacity-90"
      style={{ color: danger ? DS.critical : DS.text, background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = DS.surface3)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="shrink-0" style={{ color: danger ? DS.critical : DS.textMuted }}>
        {icon}
      </span>
      {label}
    </button>
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

/* -------------------------------------------------------------------------- */
/* History panel — browse and read archived session transcripts             */
/* -------------------------------------------------------------------------- */
function HistoryPanel({ companyId }: { companyId: string | null }) {
  const [search, setSearch] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const { data: rooms } = useQuery({
    queryKey: ["jarvis", "history", "rooms", companyId],
    queryFn: () => roomsApi.list(companyId!),
    enabled: !!companyId,
  });
  const archived = (rooms ?? []).filter((r) => r.status === "archived");

  const { data: messagesPage } = useQuery({
    queryKey: ["jarvis", "history", "messages", companyId, selectedRoomId],
    queryFn: () => roomsApi.listMessages(companyId!, selectedRoomId!, undefined, 200),
    enabled: !!companyId && !!selectedRoomId,
  });
  const messages = messagesPage?.messages ?? [];

  const filtered = search.trim()
    ? archived.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : archived;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6" aria-label="Session history">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold" style={{ color: DS.text }}>
          Session History
        </h2>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="rounded-lg px-3 py-1.5 text-[13px] outline-none"
            style={{
              background: DS.surface2,
              border: `1px solid ${DS.border2}`,
              color: DS.text,
            }}
          />
        </div>
      </div>

      {!companyId ? (
        <div className="text-[13px]" style={{ color: DS.textMuted }}>
          Select a company to view session history.
        </div>
      ) : selectedRoomId ? (
        <div>
          <button
            type="button"
            onClick={() => setSelectedRoomId(null)}
            className="mb-4 flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
            style={{ color: DS.primary }}
          >
            ← Back to list
          </button>
          {messages.length === 0 ? (
            <div className="text-[13px]" style={{ color: DS.textMuted }}>
              No messages in this session.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl px-4 py-3"
                  style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color: m.senderType === "agent" ? DS.primary : DS.text }}
                    >
                      {m.senderName ?? m.senderId}
                    </span>
                    <span className="text-[11px]" style={{ color: DS.textMuted }}>
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: DS.text }}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-xl px-5 py-6 text-[13px]"
          style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
        >
          <div className="flex items-center gap-2" style={{ color: DS.text }}>
            <History className="h-4 w-4" style={{ color: DS.primary }} />
            <span className="font-medium">No archived sessions yet</span>
          </div>
          <p className="mt-2">
            End a brainstorming session to archive it here. You can then search and review past sessions.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedRoomId(r.id)}
              className="rounded-xl px-4 py-3 text-left transition-colors hover:opacity-90"
              style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold" style={{ color: DS.text }}>
                  {r.name}
                </span>
                <span className="text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
                  {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : ""}
                </span>
              </div>
              {r.description ? (
                <div className="mt-1 text-[12px]" style={{ color: DS.textMuted }}>
                  {r.description}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

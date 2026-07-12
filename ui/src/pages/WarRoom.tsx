// War Room — the chief-of-staff chat. The REAL Hermes conversation (converse
// first, approve before anything reaches the team). Replaces the decorative
// Jarvis tab per product spec §7. Styled to Design System v1.0.
//
// Layout is deliberately JUST the conversation (no context/agent rail): the
// dialogue with Hermes, an inline proposed-plan card (steps + durations only —
// NO agent names; agent assignment is Ares's job after approval and shows up in
// Fleet/Activity), "Approve & send to team", and a composer with three quick
// actions (Launch Task · Search · Automate).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, ListPlus, Search, Zap, Check, Pencil, X, ShieldCheck, Sparkles } from "lucide-react";
import { jarvisApi, type JarvisVoiceResponse } from "../api/jarvis";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useNavigate } from "@/lib/router";
import { useDialogActions } from "@/context/DialogContext";

/* Design System v1.0 — canonical tokens (charcoal & graphite; blue = signal). */
const DS = {
  canvas: "#06090F", surface1: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", border3: "#314158",
  text: "#F5F8FF", textMuted: "#A3B0C2", textFaint: "#68758A",
  primary: "#3B82FF", success: "#2FE38A", warning: "#F4B940", critical: "#FF5B5B",
  automation: "#A56EFF",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

interface PlanStep { n: number; label: string; duration: string }
interface ProposedPlan {
  title: string;
  version?: string;
  steps: PlanStep[];
  estimatedCompletion?: string;
  totalLabel?: string;
  agentsInvolved?: number; // kept for the approve payload; NOT rendered (spec §7)
}
interface ChatMessage {
  id: string;
  role: "user" | "hermes";
  text: string;
  ts: string;
  plan?: ProposedPlan | null;
  pending?: boolean;
}

const clock = (d = new Date()) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);

/* Extract a structured plan from a Hermes turn — fenced ```plan/```json first,
   then a prose "PROPOSED PLAN" + numbered "1. Label — 2 days" block. Returns
   null otherwise (never fabricates a plan). */
function parsePlan(text: string): ProposedPlan | null {
  if (!text) return null;
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
      }).filter((s) => s.label);
      if (steps.length > 0) {
        return {
          title: String(raw.title ?? "Proposed plan"),
          version: raw.version ? String(raw.version) : undefined,
          steps,
          estimatedCompletion: raw.estimatedCompletion ? String(raw.estimatedCompletion) : undefined,
          totalLabel: raw.total ? `Total: ${String(raw.total)}` : undefined,
          agentsInvolved: typeof raw.agentsInvolved === "number" ? raw.agentsInvolved : undefined,
        };
      }
    } catch { /* fall through */ }
  }
  if (!/proposed plan/i.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const steps: PlanStep[] = [];
  const stepRe = /^\s*(\d+)[.)]\s+(.+?)\s+[—–-]\s+(\d+\s*(?:days?|hrs?|hours?|weeks?|wks?|min(?:ute)?s?))\.?\s*$/i;
  for (const line of lines) {
    const m = line.match(stepRe);
    if (m) steps.push({ n: steps.length + 1, label: m[2]!.trim(), duration: m[3]!.trim() });
  }
  if (steps.length === 0) return null;
  const titleLine = lines.find((l) => /proposed plan/i.test(l)) ?? "";
  const title =
    titleLine.replace(/proposed plan/i, "").replace(/[:—–-]/g, " ").trim() || "Proposed plan";
  const totalMatch = text.match(/total:\s*([^\n]+)/i);
  return { title: title.toUpperCase(), steps, totalLabel: totalMatch ? `Total: ${totalMatch[1]!.trim()}` : undefined };
}

const EXAMPLE_PROMPTS = [
  "Plan the mobile app MVP so we can ship this month.",
  "What's waiting on me right now across the fleet?",
  "Draft a launch plan for the AI Influencer studio.",
  "Summarize where the Book Studio build stands.",
];

export function WarRoom() {
  const navigate = useNavigate();
  const { selectedCompanyId: cid, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const { openNewIssue } = useDialogActions();
  const companyPrefix = selectedCompany?.issuePrefix;
  const route = (p: string) => (companyPrefix ? `/${companyPrefix}${p}` : p);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [approvalInfo, setApprovalInfo] = useState<
    Record<string, { state: "sending" | "queued" | "error"; detail: string }>
  >({});
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { setBreadcrumbs([{ label: "War Room" }]); }, [setBreadcrumbs]);

  // Health — surface honestly when no real LLM is wired (data-honesty rule).
  const healthQ = useQuery({
    queryKey: ["jarvis-health"],
    queryFn: () => jarvisApi.health(),
    staleTime: 60_000,
  });
  const _llm = healthQ.data?.llm;
  const noLlm = _llm ? !(_llm.deepseek || _llm.openai || _llm.anthropic || _llm.moonshot) : false;

  // Hydrate the last conversation turns (real history).
  const historyQ = useQuery({
    queryKey: ["warroom-history", cid],
    queryFn: () => jarvisApi.conversations(cid!, 30),
    enabled: !!cid,
  });
  useEffect(() => {
    const turns = historyQ.data?.conversations;
    if (!turns || messages.length > 0) return;
    const hydrated: ChatMessage[] = [];
    for (const t of turns) {
      if (t.userTranscript) hydrated.push({ id: `${t.id}-u`, role: "user", text: t.userTranscript, ts: clock(new Date(t.createdAt)) });
      if (t.agentReply) hydrated.push({ id: `${t.id}-h`, role: "hermes", text: t.agentReply, ts: clock(new Date(t.createdAt)), plan: parsePlan(t.agentReply) });
    }
    if (hydrated.length) setMessages(hydrated);
  }, [historyQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending || !cid) return;
    setComposer("");
    const userMsg: ChatMessage = { id: uid(), role: "user", text: body, ts: clock() };
    const pendingId = uid();
    setMessages((m) => [...m, userMsg, { id: pendingId, role: "hermes", text: "", ts: clock(), pending: true }]);
    setSending(true);
    try {
      const res: JarvisVoiceResponse = await jarvisApi.voice(cid, { transcript: body, conversationId, responseType: "standard" });
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((m) => m.map((msg) =>
        msg.id === pendingId
          ? { ...msg, pending: false, text: res.reply || "(no reply)", plan: parsePlan(res.reply || "") }
          : msg));
    } catch {
      setMessages((m) => m.map((msg) =>
        msg.id === pendingId
          ? { ...msg, pending: false, text: "I couldn't reach the model just now. Try again in a moment." }
          : msg));
      pushToast({ title: "Hermes is unreachable right now", tone: "error" });
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };

  const approve = async (msgId: string, plan: ProposedPlan) => {
    if (!cid) return;
    setApprovalInfo((s) => ({ ...s, [msgId]: { state: "sending", detail: "Sending to Ares…" } }));
    try {
      const res = await jarvisApi.approvePlan(cid, {
        title: plan.title,
        steps: plan.steps.map((s) => ({ n: s.n, label: s.label, duration: s.duration })),
        conversationId,
        estimatedCompletion: plan.estimatedCompletion,
        agentsInvolved: plan.agentsInvolved,
      });
      setApproved((s) => new Set(s).add(msgId));
      if (res.ok && res.status === "queued" && res.reachable) {
        setApprovalInfo((s) => ({ ...s, [msgId]: { state: "queued", detail: "Approved — handed to Ares to assign the team." } }));
      } else if (res.ok && res.status === "queued" && !res.reachable) {
        setApprovalInfo((s) => ({ ...s, [msgId]: { state: "queued", detail: `Approved and queued — Ares's bridge is down right now (${res.error ?? "unreachable"}); it'll dispatch when the daemon is back.` } }));
      } else {
        setApprovalInfo((s) => ({ ...s, [msgId]: { state: "error", detail: res.error ?? "Couldn't hand off to the team." } }));
      }
    } catch {
      setApprovalInfo((s) => ({ ...s, [msgId]: { state: "error", detail: "Approval failed — try again." } }));
    }
  };

  const adjust = (plan: ProposedPlan) => {
    setComposer(`Revise the plan "${plan.title}": `);
    composerRef.current?.focus();
  };

  const canSend = composer.trim().length > 0 && !sending;
  const isEmpty = messages.length === 0 && !historyQ.isLoading;

  const quickActions = useMemo(() => ([
    { key: "task", label: "Launch Task", icon: ListPlus, run: () => openNewIssue() },
    { key: "search", label: "Search", icon: Search, run: () => navigate(route("/search")) },
    { key: "automate", label: "Automate", icon: Zap, run: () => navigate(route("/routines")) },
  ]), [openNewIssue, navigate, companyPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cid) {
    return <div style={{ background: DS.canvas, minHeight: "100vh", padding: 32, color: DS.textMuted }}>Select a company to open the War Room.</div>;
  }

  return (
    <div style={{ background: DS.canvas, minHeight: "100vh", color: DS.text, display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Header */}
      <div style={{ padding: "24px 32px 16px", borderBottom: `1px solid ${DS.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(140deg, ${DS.primary}, #2456C8)`, display: "grid", placeItems: "center", boxShadow: `0 0 0 1px ${DS.primary}44` }}>
            <ShieldCheck size={17} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>War Room</h1>
            <div style={{ fontSize: 12.5, color: DS.textFaint, marginTop: 2 }}>
              Your chief of staff. Talk in plain language — nothing reaches the team until you approve.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: DS.textMuted, background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 999, padding: "5px 11px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: noLlm ? DS.critical : DS.success, boxShadow: `0 0 8px ${noLlm ? DS.critical : DS.success}` }} />
            {noLlm ? "No model wired" : "Hermes online"}
          </div>
        </div>
      </div>

      {noLlm && (
        <div style={{ margin: "12px 32px 0", background: `${DS.warning}14`, border: `1px solid ${DS.warning}55`, borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: DS.warning }}>
          No LLM provider key is configured on the server, so Hermes can't reply yet. Add a provider key and reload.
        </div>
      )}

      {/* Thread */}
      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: "24px 0" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 32px" }}>
          {isEmpty ? (
            <div style={{ marginTop: "8vh", textAlign: "center" }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, margin: "0 auto 16px", background: `linear-gradient(140deg, ${DS.primary}, #2456C8)`, display: "grid", placeItems: "center" }}>
                <Sparkles size={22} color="#fff" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>What are we getting done?</div>
              <div style={{ fontSize: 13.5, color: DS.textFaint, marginTop: 6, maxWidth: 440, marginInline: "auto", lineHeight: 1.5 }}>
                Describe the outcome you want. Hermes shapes a plan with you; you approve before anything is handed to the team.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 22, maxWidth: 460, marginInline: "auto" }}>
                {EXAMPLE_PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)}
                    style={{ textAlign: "left", background: DS.surface1, border: `1px solid ${DS.border}`, color: DS.textMuted, borderRadius: 12, padding: "11px 14px", fontSize: 13, cursor: "pointer", transition: "border-color .15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = DS.border3)}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = DS.border)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 22 }}>
                <MessageBubble m={m} />
                {m.plan && m.plan.steps.length > 0 && (
                  <PlanCard
                    plan={m.plan}
                    approved={approved.has(m.id)}
                    info={approvalInfo[m.id]}
                    onApprove={() => approve(m.id, m.plan!)}
                    onAdjust={() => adjust(m.plan!)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${DS.border}`, padding: "14px 0 18px", background: DS.canvas }}>
        <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 32px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {quickActions.map((a) => (
              <button key={a.key} onClick={a.run}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted, borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer", transition: "all .15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = DS.primary; e.currentTarget.style.color = DS.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = DS.border2; e.currentTarget.style.color = DS.textMuted; }}>
                <a.icon size={13} /> {a.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, background: DS.surface1, border: `1px solid ${DS.border2}`, borderRadius: 16, padding: "10px 10px 10px 16px" }}>
            <textarea
              ref={composerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(composer); } }}
              placeholder="Message Hermes…  (Enter to send, Shift+Enter for a new line)"
              rows={1}
              style={{ flex: 1, resize: "none", background: "transparent", border: "none", outline: "none", color: DS.text, fontSize: 14, lineHeight: 1.5, maxHeight: 160, fontFamily: "inherit", padding: "4px 0" }}
            />
            <button
              onClick={() => send(composer)}
              disabled={!canSend}
              style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 11, border: "none", cursor: canSend ? "pointer" : "not-allowed", background: canSend ? DS.primary : DS.surface3, color: canSend ? "#fff" : DS.textFaint, display: "grid", placeItems: "center", transition: "background .15s" }}
              aria-label="Send">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        {!isUser && <span style={{ fontSize: 11.5, fontWeight: 600, color: DS.primary }}>Hermes</span>}
        <span style={{ fontSize: 10.5, color: DS.textFaint, fontFamily: DS.mono }}>{m.ts}</span>
      </div>
      {m.pending ? (
        <div style={{ display: "flex", gap: 4, padding: "12px 16px", background: DS.surface1, border: `1px solid ${DS.border}`, borderRadius: 14 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: DS.textFaint, animation: `wr-blink 1.2s ${i * 0.15}s infinite` }} />
          ))}
        </div>
      ) : (
        <div style={{
          maxWidth: "88%", padding: "11px 15px", borderRadius: 14, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
          background: isUser ? DS.primary : DS.surface1,
          color: isUser ? "#fff" : DS.text,
          border: isUser ? "none" : `1px solid ${DS.border}`,
          borderBottomRightRadius: isUser ? 4 : 14,
          borderBottomLeftRadius: isUser ? 14 : 4,
        }}>
          {stripPlanFence(m.text)}
        </div>
      )}
      <style>{`@keyframes wr-blink{0%,60%,100%{opacity:.25}30%{opacity:1}}`}</style>
    </div>
  );
}

/* Hide the raw ```plan/```json fence from the chat bubble — the parsed card
   renders it instead. */
function stripPlanFence(text: string): string {
  return text.replace(/```(?:plan|json)\s*[\s\S]*?```/gi, "").trim() || text;
}

function PlanCard({ plan, approved, info, onApprove, onAdjust }: {
  plan: ProposedPlan;
  approved: boolean;
  info?: { state: "sending" | "queued" | "error"; detail: string };
  onApprove: () => void;
  onAdjust: () => void;
}) {
  return (
    <div style={{ marginTop: 12, maxWidth: "88%", background: DS.surface2, border: `1px solid ${DS.border2}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.primary, background: `${DS.primary}1E`, padding: "3px 8px", borderRadius: 6 }}>Proposed plan</span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{plan.title}</span>
        {plan.version && <span style={{ fontSize: 11, color: DS.textFaint, fontFamily: DS.mono }}>{plan.version}</span>}
      </div>
      <div style={{ padding: "6px 16px 12px" }}>
        {plan.steps.map((s) => (
          <div key={s.n} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 0", borderBottom: `1px solid ${DS.border}` }}>
            <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, background: DS.surface3, color: DS.textMuted, fontSize: 11, fontFamily: DS.mono, display: "grid", placeItems: "center" }}>{s.n}</span>
            <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45 }}>{s.label}</span>
            <span style={{ flexShrink: 0, fontSize: 12, color: DS.textMuted, fontFamily: DS.mono }}>{s.duration}</span>
          </div>
        ))}
        {(plan.totalLabel || plan.estimatedCompletion) && (
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 12, color: DS.textMuted, fontFamily: DS.mono }}>
            <span>{plan.totalLabel ?? ""}</span>
            <span>{plan.estimatedCompletion ? `ETA ${plan.estimatedCompletion}` : ""}</span>
          </div>
        )}
      </div>
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${DS.border}`, background: DS.surface1 }}>
        {approved ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: info?.state === "error" ? DS.critical : DS.success }}>
            {info?.state === "error" ? <X size={14} /> : <Check size={14} />}
            {info?.detail ?? "Approved."}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onApprove} disabled={info?.state === "sending"}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, background: DS.primary, color: "#fff", border: "none", borderRadius: 10, padding: "9px 15px", fontSize: 13, fontWeight: 600, cursor: info?.state === "sending" ? "wait" : "pointer" }}>
              <ShieldCheck size={14} /> {info?.state === "sending" ? "Sending…" : "Approve & send to team"}
            </button>
            <button onClick={onAdjust}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: DS.textMuted, border: `1px solid ${DS.border2}`, borderRadius: 10, padding: "9px 13px", fontSize: 13, cursor: "pointer" }}>
              <Pencil size={13} /> Adjust
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default WarRoom;

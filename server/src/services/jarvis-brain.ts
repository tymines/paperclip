import type { Db } from "@paperclipai/db";
import {
  jarvisConversations,
  agentBridgeReplyAttempts,
  agentConfigRevisions,
  agents,
} from "@paperclipai/db";
import { desc, eq } from "drizzle-orm";
import { getCostWatcherPayload } from "./cost-watcher.js";
import { issueService } from "./issues.js";
import { agentService } from "./agents.js";
import { getRawKey } from "./provider-api-keys/index.js";
import {
  loadPersona,
  formatPersonaForCall,
  enforceLengthBudget,
  stripMarkdown,
  type ResponseType,
} from "./jarvis-persona.js";
import { getCapabilitySnapshot, summarizeForPersona } from "./jarvis-capabilities.js";
import {
  dispatchDelegation,
  naturalAcknowledgment,
  type DelegationDispatchResult,
  type PeerAgentId,
} from "./jarvis-delegation.js";
import {
  DELEGATION_TOOLS,
  TOOL_NAME_TO_PEER,
  toOpenAiTools,
} from "./jarvis-delegation-tools.js";
import {
  DESIGN_TOOL_DEF,
  DESIGN_BATCH_TOOL_DEF,
  DESIGN_PACK_TOOL_DEF,
  dispatchDesignTool,
  dispatchDesignBatch,
  dispatchDesignPack,
  designToolAcknowledgment,
  designBatchAcknowledgment,
  designPackAcknowledgment,
} from "./jarvis-design-tool.js";
import { logger } from "../middleware/logger.js";
import {
  buildTimeContext,
  formatTimeContextBlock,
} from "./jarvis-time-context.js";
import {
  fetchLearnedPreferences,
  fetchRecentTurns,
  formatLearnedPreferencesBlock,
  observeForPreferences,
  type RecentTurn,
} from "./jarvis-learning.js";

/**
 * The Jarvis brain.
 *
 * Composes a data-rich context briefing from existing Paperclip services
 * (cost-watcher totals, blocked issue count, fleet snapshot), then either:
 *
 *   - Calls a configured LLM (DeepSeek by default for speed/cost, OpenAI as
 *     fallback) with a Jarvis persona system prompt + the user's transcript +
 *     the context snapshot; OR
 *   - Falls back to a deterministic, data-driven template if no LLM key is
 *     configured. The template still uses the real numbers — Tyler always
 *     gets a useful answer, even with no keys.
 *
 * Every exchange is persisted to jarvis_conversations for replay + audit.
 *
 * Commit 5 will layer streaming (SSE) and tool-use (search, schedule,
 * delegate) on top of this same brain — the dispatch contract stays stable.
 */

export interface JarvisBrainInput {
  companyId: string;
  userActorId: string;
  transcript: string;
  voiceTier?: string;
  /** True when transcript came from the mic; false when typed in chat. */
  voiceMode?: boolean;
  /** Hint for the length-budget pass. Defaults to "standard". */
  responseType?: ResponseType;
  /**
   * Persistence tag — written to jarvis_conversations.source so we can
   * separate scheduled briefings from interactive turns later. Known values:
   * "voice" | "chat" | "daddys_home" | "mac-wake" | "schedule". Defaults to
   * null when omitted (legacy interactive turn).
   */
  source?: string;
  /**
   * When set, replaces the default compose{Standard,Briefing}Context output —
   * lets the daddys-home endpoint hand the brain a richer user prompt that's
   * been pre-composed from briefing-only data (shipped overnight, routine
   * failures, etc.). Persisted verbatim to contextSnapshot when paired with
   * customContextSnapshot.
   */
  customUserPrompt?: string;
  /** When set, replaces the ContextBriefing snapshot written to the row. */
  customContextSnapshot?: Record<string, unknown>;
  /** Conversation row to link any delegation to. */
  conversationId?: string;
  /**
   * Disable peer-agent delegation tools for this call. Defaults to true.
   * Set false for system probes or evals that should not trigger real
   * dispatches.
   */
  enableDelegation?: boolean;
}

export interface JarvisBrainOutput {
  reply: string;
  llmProvider: string | null;
  llmModel: string | null;
  contextSnapshot: Record<string, unknown>;
  latencyMs: number;
  personaVersion: string;
  personaSource: "file" | "fallback";
  truncated: boolean;
  responseType: ResponseType;
  /** When the brain dispatched a peer delegation in response to this turn. */
  delegation?: {
    id: string;
    agent: PeerAgentId;
    status: "queued" | "failed";
    reachable: boolean;
    remainingQuotaThisMinute: number;
  };
}

interface WorkItem {
  ref: string;
  title: string;
  status: string;
  priority: string | null;
  assignee: string | null;
}

interface DecisionItem {
  agentName: string;
  changed: string;
  source: string | null;
  at: string;
}

interface RosterItem {
  name: string;
  role: string | null;
  status: string;
  lastHeartbeatAt: string | null;
}

interface ContextBriefing {
  revenueMtdUsd: number | null;
  revenueDeltaPct: number | null;
  blockedIssueCount: number;
  topBurnAgentName: string | null;
  topBurnAgentSpendUsd: number | null;
  fleetTotal: number;
  fleetActive: number;
  costAlerts: number;
  /** Live work queue: active (non-terminal) issues, highest-signal first. */
  queue: WorkItem[];
  /** Issues currently blocked / needing Tyler's call. */
  blocked: WorkItem[];
  /** Recent agent config changes — closest thing to an upgrades/decisions log. */
  decisions: DecisionItem[];
  /** Full fleet roster with per-agent live status. */
  roster: RosterItem[];
  asOf: string;
}

/**
 * Loose intent classifier so the brain knows which length budget to apply
 * before the LLM round trip. The client can override via responseType in
 * the request body — this is just the fallback when nothing is hinted.
 */
function inferResponseType(transcript: string): ResponseType {
  const t = transcript.toLowerCase().trim();
  if (
    t.startsWith("brief") ||
    t.includes("morning briefing") ||
    t.includes("evening briefing") ||
    t.includes("give me today") ||
    t.includes("status report") ||
    t.includes("rundown")
  ) {
    return "briefing";
  }
  if (
    t.startsWith("walk me through") ||
    t.startsWith("explain ") ||
    t.startsWith("write ") ||
    t.startsWith("draft ") ||
    t.includes("detailed") ||
    t.includes("step by step")
  ) {
    return "detailed";
  }
  // Heuristic: short, single-fact questions → quick. Anything longer
  // defaults to the standard 2-3 sentence budget.
  if (t.length < 40 && (t.startsWith("how many") || t.startsWith("what is") || t.startsWith("what's") || t.startsWith("when") || t.startsWith("who"))) {
    return "quick";
  }
  return "standard";
}

const ACTIVE_ISSUE_STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
]);
const ISSUE_PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function toWorkItem(row: any): WorkItem {
  const ref =
    typeof row?.identifier === "string" && row.identifier
      ? row.identifier
      : row?.issueNumber != null
        ? `#${row.issueNumber}`
        : String(row?.id ?? "").slice(0, 8);
  return {
    ref,
    title: typeof row?.title === "string" && row.title ? row.title : "(untitled)",
    status: typeof row?.status === "string" ? row.status : "unknown",
    priority: typeof row?.priority === "string" ? row.priority : null,
    assignee: null,
  };
}

async function fetchRecentDecisions(
  db: Db,
  companyId: string,
  limit: number,
): Promise<DecisionItem[]> {
  const rows = await db
    .select({
      changedKeys: agentConfigRevisions.changedKeys,
      source: agentConfigRevisions.source,
      createdAt: agentConfigRevisions.createdAt,
      agentName: agents.name,
    })
    .from(agentConfigRevisions)
    .leftJoin(agents, eq(agentConfigRevisions.agentId, agents.id))
    .where(eq(agentConfigRevisions.companyId, companyId))
    .orderBy(desc(agentConfigRevisions.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const keys = Array.isArray(r.changedKeys)
      ? (r.changedKeys as unknown[]).map((k) => String(k))
      : [];
    return {
      agentName: r.agentName ?? "fleet",
      changed: keys.length > 0 ? keys.join(", ") : "config",
      source: r.source ?? null,
      at:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt ?? ""),
    };
  });
}

async function gatherContext(db: Db, companyId: string): Promise<ContextBriefing> {
  const [costPayload, blockedCount, agentList, openIssues, blockedIssues, decisions] =
    await Promise.all([
      safe(() => getCostWatcherPayload(db, companyId), null),
      safe(() => issueService(db).count(companyId, { attention: "blocked" }), 0),
      safe(() => agentService(db).list(companyId), [] as any[]),
      safe(() => issueService(db).list(companyId, { limit: 60 }), [] as any[]),
      safe(
        () => issueService(db).list(companyId, { attention: "blocked", limit: 12 }),
        [] as any[],
      ),
      safe(() => fetchRecentDecisions(db, companyId, 6), [] as DecisionItem[]),
    ]);

  let revenueMtdUsd: number | null = null;
  let revenueDeltaPct: number | null = null;
  let topBurnAgentName: string | null = null;
  let topBurnAgentSpendUsd: number | null = null;
  let costAlerts = 0;

  if (costPayload) {
    const p = costPayload as unknown as {
      totals?: { mtdUsd?: number; mtdDeltaPct?: number };
      topAgents?: Array<{ agentName?: string; agentId?: string; usdLast24h?: number }>;
      alerts?: unknown[];
    };
    if (typeof p.totals?.mtdUsd === "number") revenueMtdUsd = p.totals.mtdUsd;
    if (typeof p.totals?.mtdDeltaPct === "number") revenueDeltaPct = p.totals.mtdDeltaPct;
    const top = p.topAgents?.[0];
    if (top) {
      topBurnAgentName = top.agentName ?? top.agentId ?? null;
      topBurnAgentSpendUsd = typeof top.usdLast24h === "number" ? top.usdLast24h : null;
    }
    costAlerts = Array.isArray(p.alerts) ? p.alerts.length : 0;
  }

  const agents_ = agentList as Array<{
    id?: string;
    name?: string;
    role?: string | null;
    status?: string;
    lastHeartbeatAt?: unknown;
  }>;
  const nameById = new Map<string, string>();
  for (const a of agents_) {
    if (a && typeof a.id === "string" && typeof a.name === "string") nameById.set(a.id, a.name);
  }
  const resolveAssignee = (row: any): string | null => {
    const id = typeof row?.assigneeAgentId === "string" ? row.assigneeAgentId : null;
    return id && nameById.has(id) ? nameById.get(id)! : null;
  };

  const fleetTotal = agents_.length;
  const fleetActive = agents_.filter(
    (a) => a.status === "active" || a.status === "running",
  ).length;

  const roster: RosterItem[] = agents_.map((a) => ({
    name: typeof a.name === "string" ? a.name : "(unnamed)",
    role: typeof a.role === "string" ? a.role : null,
    status: typeof a.status === "string" ? a.status : "unknown",
    lastHeartbeatAt:
      a.lastHeartbeatAt instanceof Date
        ? a.lastHeartbeatAt.toISOString()
        : typeof a.lastHeartbeatAt === "string"
          ? a.lastHeartbeatAt
          : null,
  }));

  const queue: WorkItem[] = (openIssues as any[])
    .filter((r) => ACTIVE_ISSUE_STATUSES.has(String(r?.status)))
    .sort((a, b) => {
      const pa = ISSUE_PRIORITY_RANK[String(a?.priority)] ?? 9;
      const pb = ISSUE_PRIORITY_RANK[String(b?.priority)] ?? 9;
      if (pa !== pb) return pa - pb;
      const ta = new Date(a?.updatedAt ?? a?.createdAt ?? 0).getTime();
      const tb = new Date(b?.updatedAt ?? b?.createdAt ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, 12)
    .map((r) => ({ ...toWorkItem(r), assignee: resolveAssignee(r) }));

  const blocked: WorkItem[] = (blockedIssues as any[])
    .slice(0, 12)
    .map((r) => ({ ...toWorkItem(r), assignee: resolveAssignee(r) }));

  return {
    revenueMtdUsd,
    revenueDeltaPct,
    blockedIssueCount: blockedCount,
    topBurnAgentName,
    topBurnAgentSpendUsd,
    fleetTotal,
    fleetActive,
    costAlerts,
    queue,
    blocked,
    decisions,
    roster,
    asOf: new Date().toISOString(),
  };
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err }, "jarvis-brain: context lookup failed");
    return fallback;
  }
}

function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

/**
 * Deterministic fallback reply when no LLM key is configured. Persona
 * ordering: lead with WORK (blockers / fleet / projects), surface
 * revenue only on explicit ask or when alerts force it. End with one
 * concrete next-action suggestion. Length follows the response budget.
 */
function deterministicReply(
  transcript: string,
  ctx: ContextBriefing,
  responseType: ResponseType,
  recentTurns: RecentTurn[] = [],
): string {
  const lowered = transcript.toLowerCase().trim();
  const list = (items: WorkItem[], n: number): string =>
    items
      .slice(0, n)
      .map((w) => `${w.ref} ${w.title}`)
      .join("; ");

  // Greeting — greet, don't dump stats; vary by whether we already greeted so
  // we never repeat the same opener (the old bug).
  const isGreeting =
    /^(hi|hey|hello|yo|sup|howdy|good (morning|afternoon|evening))\b/.test(lowered);
  if (isGreeting && lowered.length <= 28) {
    const alreadyGreeted = recentTurns.some((t) =>
      /^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(
        (t.userTranscript || "").toLowerCase().trim(),
      ),
    );
    const hint =
      ctx.queue.length > 0
        ? ` We've got ${ctx.queue.length} active item${ctx.queue.length === 1 ? "" : "s"} in the queue${ctx.blocked.length > 0 ? ` and ${ctx.blocked.length} blocked` : ""}.`
        : ctx.blocked.length > 0
          ? ` ${ctx.blocked.length} item${ctx.blocked.length === 1 ? "" : "s"} blocked right now.`
          : "";
    return alreadyGreeted
      ? `Still here, Tyler.${hint} What do you want to dig into?`
      : `Hey Tyler.${hint} Want me to run through what's on the board, or do you have something specific in mind?`;
  }

  const asksFinance = /\b(revenue|kpi|spend|burn|money|cost|budget)\b/.test(lowered);
  if (asksFinance) {
    if (/\b(burn|expensive|cost)\b/.test(lowered)) {
      return ctx.topBurnAgentName
        ? `Top burn last 24 hours is ${ctx.topBurnAgentName} at ${formatUsd(ctx.topBurnAgentSpendUsd)}, with ${ctx.costAlerts} alerts open. Want me to pause it?`
        : `No notable burn in the last 24 hours, and the fleet's at ${ctx.fleetActive} of ${ctx.fleetTotal} active. Anything you want me to dig into?`;
    }
    const delta =
      ctx.revenueDeltaPct == null
        ? ""
        : ` ${ctx.revenueDeltaPct >= 0 ? "up" : "down"} ${Math.abs(ctx.revenueDeltaPct).toFixed(1)} percent`;
    return `Spend month-to-date is ${formatUsd(ctx.revenueMtdUsd)}${delta}, with ${ctx.costAlerts} active alerts. Want me to break it down by provider?`;
  }

  // "What should we work on" / priorities / next — used to collapse to the
  // generic line; now answers from the real queue.
  if (
    /\b(work on|what.*next|priorit|to ?do|backlog|tackle|focus|what should|what'?s on|get started|where do we|kick off)\b/.test(
      lowered,
    )
  ) {
    if (ctx.blocked.length > 0) {
      return `I'd clear the blocked queue first — ${ctx.blocked.length} waiting: ${list(ctx.blocked, 3)}. After that, top of the active queue is ${list(ctx.queue, 3) || "empty"}. Want me to open the first one?`;
    }
    if (ctx.queue.length > 0) {
      return `Top of the queue right now: ${list(ctx.queue, 4)}. ${ctx.fleetActive} of ${ctx.fleetTotal} agents are active. Want me to start the first one or reprioritize?`;
    }
    return `The active queue is empty and nothing's blocked. ${ctx.fleetActive} of ${ctx.fleetTotal} agents online — want me to pull in something new (research, content, or a build)?`;
  }

  if (/\b(block|stuck|waiting)\b/.test(lowered)) {
    return ctx.blocked.length > 0
      ? `${ctx.blocked.length} blocked: ${list(ctx.blocked, 4)}. Want me to walk through what each is waiting on?`
      : `Nothing's blocked right now. ${ctx.fleetActive} of ${ctx.fleetTotal} agents active. Want me to pull up the active queue?`;
  }

  if (/\b(fleet|agents?|roster|status|team)\b/.test(lowered) && !lowered.includes("morning")) {
    const names = ctx.roster
      .slice(0, 8)
      .map((r) => `${r.name}:${r.status}`)
      .join(", ");
    return `${ctx.fleetActive} of ${ctx.fleetTotal} agents active${names ? ` — ${names}` : ""}. ${ctx.blockedIssueCount} blocked issues open. Anything specific you want me to check?`;
  }

  if (/\b(decision|decided|upgrade|chang(e|ed)|revision|recent)\b/.test(lowered) && ctx.decisions.length > 0) {
    const d = ctx.decisions
      .slice(0, 3)
      .map((x) => `${x.agentName} (${x.changed})`)
      .join("; ");
    return `Recent config changes: ${d}. Want the full revision history on any of them?`;
  }

  if (responseType === "briefing" || /\b(brief|morning|evening|afternoon|rundown)\b/.test(lowered)) {
    const greeting = lowered.includes("morning")
      ? "Good morning, Tyler."
      : lowered.includes("evening")
        ? "Good evening, Tyler."
        : lowered.includes("afternoon")
          ? "Good afternoon, Tyler."
          : "Here's where things stand.";
    const queueLine =
      ctx.queue.length > 0 ? ` Top of the queue: ${list(ctx.queue, 3)}.` : " Active queue is clear.";
    const blockers =
      ctx.blocked.length > 0
        ? ` ${ctx.blocked.length} blocked and needing your call.`
        : " Nothing blocked on you.";
    const fleet =
      ctx.fleetActive === ctx.fleetTotal
        ? ` All ${ctx.fleetTotal} agents online.`
        : ` Fleet ${ctx.fleetActive} of ${ctx.fleetTotal} active.`;
    const reco =
      ctx.blocked.length > 0
        ? " I'd clear the blockers first — want me to open them?"
        : ctx.queue.length > 0
          ? " Want me to start the top item?"
          : " Want me to line up something new?";
    return `${greeting}${queueLine}${blockers}${fleet}${reco}`;
  }

  // Fallback — still context-aware and varied; never the old static line.
  if (ctx.blocked.length > 0) {
    return `Not sure I followed — but heads up, ${ctx.blocked.length} item${ctx.blocked.length === 1 ? " is" : "s are"} blocked (${list(ctx.blocked, 2)}). Want to tackle those, or did you mean something else?`;
  }
  if (ctx.queue.length > 0) {
    return `Tell me a bit more and I'll dig in. Top of the queue is ${list(ctx.queue, 2)} if you want a starting point.`;
  }
  return `Tell me a bit more and I'll dig in — the queue's clear and ${ctx.fleetActive} of ${ctx.fleetTotal} agents are online, so we've got room to start something new.`;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface LlmCallResult {
  reply: string;
  provider: string;
  model: string;
  /** Tool-use intent the model produced (peer delegation). */
  toolCall?: ToolCallIntent;
}

export interface ToolCallIntent {
  name: string;
  args: Record<string, unknown>;
}

const DELEGATION_SYSTEM_HINT = `

PEER-AGENT DELEGATION:
You have access to delegate_* tools that hand work off to peer agents in Tyler's fleet (Hermes, August, Codex, content desk, social desk, research desk, plus dispatch_claude_code for repo-heavy work). When Tyler asks you to do something that could be handled by a peer (research, code, content, posting), PREFER to delegate rather than do it yourself. Brief acknowledgment first ("On it — handing this to Hermes"), then call the right delegate_* tool. Don't ask for permission unless the task is irreversible. The tool returns a tracking id and a reachability flag; your natural-language reply will be generated for you — just pick the right tool and pass a self-contained task string.`;

/**
 * Tries Anthropic Claude first (Augi-as-brain), then DeepSeek, then OpenAI.
 * Returns null if no provider key is configured or all of them fail. The
 * brain falls back to a deterministic, data-grounded template in that case.
 */
async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  history: ChatTurn[] = [],
  withTools = true,
): Promise<LlmCallResult | null> {
  // PRIMARY: local AugiVector / litellm proxy (OpenAI-compatible) — the same
  // working model lane the live Hermes bridge uses. Gives the in-app Hermes a
  // real LLM without depending on direct provider keys (DeepSeek/Moonshot are
  // currently invalid). Additive + safe: a plain HTTP call to a local proxy;
  // the bridge / OpenViking are untouched. Tools omitted here for upstream
  // robustness (key-based providers below keep delegation tool-use).
  const proxyUrl =
    process.env.AUGIVECTOR_URL ?? "http://localhost:3000/v1/chat/completions";
  const proxyToken = process.env.AUGIVECTOR_TOKEN ?? "local";
  const proxyModel = process.env.JARVIS_BRAIN_MODEL ?? "augivector-auto";
  try {
    const result = await fetchChatCompletion({
      url: proxyUrl,
      apiKey: proxyToken,
      model: proxyModel,
      systemPrompt,
      userPrompt,
      history,
      withTools: false,
    });
    if (result) return { ...result, provider: "augivector" };
  } catch (err) {
    logger.warn({ err }, "jarvis-brain: augivector proxy call failed");
  }

  const anthropicKey = await getRawKey("anthropic").catch(() => null);
  if (anthropicKey) {
    try {
      const result = await fetchAnthropicMessage({
        apiKey: anthropicKey,
        model: "claude-opus-4-7",
        systemPrompt,
        userPrompt,
        history,
        tools: withTools
          ? [...DELEGATION_TOOLS, DESIGN_TOOL_DEF, DESIGN_BATCH_TOOL_DEF, DESIGN_PACK_TOOL_DEF]
          : undefined,
      });
      if (result) return { ...result, provider: "anthropic" };
    } catch (err) {
      logger.warn({ err }, "jarvis-brain: anthropic call failed");
    }
  }

  const deepseekKey = await getRawKey("deepseek").catch(() => null);
  if (deepseekKey) {
    try {
      const result = await fetchChatCompletion({
        url: "https://api.deepseek.com/chat/completions",
        apiKey: deepseekKey,
        model: "deepseek-chat",
        systemPrompt,
        userPrompt,
        history,
        withTools,
      });
      if (result) return { ...result, provider: "deepseek" };
    } catch (err) {
      logger.warn({ err }, "jarvis-brain: deepseek call failed");
    }
  }

  const openaiKey = await getRawKey("openai").catch(() => null);
  if (openaiKey) {
    try {
      const result = await fetchChatCompletion({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey: openaiKey,
        model: "gpt-4o-mini",
        systemPrompt,
        userPrompt,
        history,
        withTools,
      });
      if (result) return { ...result, provider: "openai" };
    } catch (err) {
      logger.warn({ err }, "jarvis-brain: openai call failed");
    }
  }

  const moonshotKey = await getRawKey("moonshot").catch(() => null);
  if (moonshotKey) {
    try {
      const result = await fetchChatCompletion({
        url: "https://api.moonshot.ai/v1/chat/completions",
        apiKey: moonshotKey,
        model: process.env.JARVIS_MOONSHOT_MODEL ?? "kimi-k2.5",
        systemPrompt,
        userPrompt,
        history,
        withTools: false,
      });
      if (result) return { ...result, provider: "moonshot" };
    } catch (err) {
      logger.warn({ err }, "jarvis-brain: moonshot call failed");
    }
  }

  logger.warn(
    "jarvis-brain: no LLM provider produced a reply (AugiVector proxy + all configured keys missing/failing) — using the deterministic offline brain",
  );
  return null;
}

/**
 * Anthropic /v1/messages call. Kept separate from the OpenAI-shaped helper
 * because the request/response payloads differ (system as top-level field,
 * content array, etc.).
 */
async function fetchAnthropicMessage({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  history,
  tools,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatTurn[];
  tools?: typeof DELEGATION_TOOLS;
}): Promise<{ reply: string; model: string; toolCall?: ToolCallIntent } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const body: Record<string, unknown> = {
      model,
      system: systemPrompt,
      messages: [...(history ?? []), { role: "user", content: userPrompt }],
      max_tokens: 400,
      temperature: 0.4,
    };
    if (tools && tools.length > 0) body.tools = tools;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      content?: Array<{
        type?: string;
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
    };
    const blocks = json.content ?? [];
    const toolBlock = blocks.find(
      (b) => b.type === "tool_use" && typeof b.name === "string",
    );
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    if (toolBlock && toolBlock.name) {
      return {
        reply: text,
        model,
        toolCall: {
          name: toolBlock.name,
          args: (toolBlock.input ?? {}) as Record<string, unknown>,
        },
      };
    }
    if (!text) return null;
    return { reply: text, model };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchChatCompletion({
  url,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  history,
  withTools,
}: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatTurn[];
  withTools?: boolean;
}): Promise<{ reply: string; model: string; toolCall?: ToolCallIntent } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...(history ?? []),
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 280,
    };
    if (withTools) {
      body.tools = [
        ...toOpenAiTools(),
        {
          type: "function" as const,
          function: {
            name: DESIGN_TOOL_DEF.name,
            description: DESIGN_TOOL_DEF.description,
            parameters: DESIGN_TOOL_DEF.input_schema,
          },
        },
        {
          type: "function" as const,
          function: {
            name: DESIGN_BATCH_TOOL_DEF.name,
            description: DESIGN_BATCH_TOOL_DEF.description,
            parameters: DESIGN_BATCH_TOOL_DEF.input_schema,
          },
        },
        {
          type: "function" as const,
          function: {
            name: DESIGN_PACK_TOOL_DEF.name,
            description: DESIGN_PACK_TOOL_DEF.description,
            parameters: DESIGN_PACK_TOOL_DEF.input_schema,
          },
        },
      ];
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const msg = json.choices?.[0]?.message;
    const text = msg?.content?.trim() ?? "";
    const toolCall = msg?.tool_calls?.[0]?.function;
    if (toolCall?.name) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolCall.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        // Model returned malformed JSON — skip the tool call and treat
        // the text reply (if any) as the reply.
      }
      if (Object.keys(parsedArgs).length > 0 || (toolCall.arguments ?? "").trim().length > 0) {
        return {
          reply: text,
          model,
          toolCall: { name: toolCall.name, args: parsedArgs },
        };
      }
    }
    if (!text) return null;
    return { reply: text, model };
  } finally {
    clearTimeout(timer);
  }
}

export async function jarvisBrainReply(
  db: Db,
  input: JarvisBrainInput,
): Promise<JarvisBrainOutput> {
  const start = Date.now();
  const voiceMode = input.voiceMode ?? false;
  const responseType: ResponseType = input.responseType ?? inferResponseType(input.transcript);

  // Persona load + context + capability snapshot + memory all run in
  // parallel. Capabilities are appended to the system prompt so Augi can
  // answer "what can you do?" accurately for THIS machine. Conversation
  // history + learned preferences give the brain continuity across turns
  // and let it adapt to Tyler over time.
  const [persona, ctx, capSnapshot, recentTurns, learnedPrefs] = await Promise.all([
    loadPersona(),
    gatherContext(db, input.companyId),
    getCapabilitySnapshot().catch(() => null),
    fetchRecentTurns(db, input.companyId, input.userActorId, 20),
    fetchLearnedPreferences(db, input.companyId, input.userActorId),
  ]);

  const timeContext = buildTimeContext();

  const enableDelegation = input.enableDelegation ?? true;
  const basePrompt = formatPersonaForCall(persona, { voiceMode, responseType });
  const systemPromptParts = [basePrompt, formatTimeContextBlock(timeContext)];
  const prefsBlock = formatLearnedPreferencesBlock(learnedPrefs);
  if (prefsBlock) systemPromptParts.push(prefsBlock);
  // Continuity is carried as REAL prior message turns passed to the model
  // (see callLlm) rather than flattened into the system prompt, so the model
  // treats them as the actual back-and-forth and won't re-open with the same
  // greeting every turn.
  const historyMessages: ChatTurn[] = [];
  for (const t of recentTurns) {
    if (t.userTranscript?.trim())
      historyMessages.push({ role: "user", content: t.userTranscript });
    if (t.agentReply?.trim())
      historyMessages.push({ role: "assistant", content: t.agentReply });
  }
  if (capSnapshot) {
    systemPromptParts.push(
      `CAPABILITY GROUNDING (real probe of this host, ${capSnapshot.generatedAt}): ${summarizeForPersona(capSnapshot)} When asked what you can do, ground your answer in these — do not promise capabilities marked needs_install or unsupported without flagging the install hint.`,
    );
  }
  if (enableDelegation) systemPromptParts.push(DELEGATION_SYSTEM_HINT.trim());
  const systemPrompt = systemPromptParts.join("\n\n");

  // For briefings the persona wants work-first ordering: shipped overnight,
  // blockers, fleet, projects — revenue only on ask. The context block we
  // hand the LLM mirrors that ordering. For non-briefings we keep the
  // factual snapshot compact and leave ordering to the model.
  // The daddys-home endpoint pre-composes its own richer prompt and passes
  // it via customUserPrompt — use that verbatim when supplied.
  const userPrompt = input.customUserPrompt
    ?? (responseType === "briefing"
      ? composeBriefingContext(input.transcript, ctx)
      : composeStandardContext(input.transcript, ctx));

  const llm = await callLlm(systemPrompt, userPrompt, historyMessages, enableDelegation);

  // Tool-use path: model chose to delegate to a peer. Run the dispatch,
  // overwrite the reply with the natural acknowledgment, return early.
  let delegationOut: JarvisBrainOutput["delegation"] | undefined;
  if (llm?.toolCall && llm.toolCall.name === DESIGN_TOOL_DEF.name) {
    const skillId = typeof llm.toolCall.args.skill_id === "string" ? llm.toolCall.args.skill_id : "";
    const promptArg = typeof llm.toolCall.args.prompt === "string" ? llm.toolCall.args.prompt : "";
    if (skillId && promptArg) {
      try {
        const out = await dispatchDesignTool(db, input.companyId, {
          skill_id: skillId,
          prompt: promptArg,
        }, input.userActorId);
        llm.reply = designToolAcknowledgment(out.skill);
      } catch (err) {
        logger.warn({ err }, "jarvis-brain: design tool dispatch failed");
        llm.reply = `Tried to fire the design tool but ${err instanceof Error ? err.message : "it failed"}.`;
      }
    }
  }
  if (llm?.toolCall && llm.toolCall.name === DESIGN_BATCH_TOOL_DEF.name) {
    const skillId = typeof llm.toolCall.args.skill_id === "string" ? llm.toolCall.args.skill_id : "";
    const tmpl = typeof llm.toolCall.args.prompt_template === "string"
      ? llm.toolCall.args.prompt_template
      : "";
    const rawCount = llm.toolCall.args.count;
    const count = typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string"
        ? parseInt(rawCount, 10)
        : 0;
    const persona = typeof llm.toolCall.args.persona === "string"
      ? llm.toolCall.args.persona
      : undefined;
    if (skillId && tmpl && count > 0 && count <= 10) {
      try {
        const out = await dispatchDesignBatch(
          db,
          input.companyId,
          { skill_id: skillId, prompt_template: tmpl, count, persona },
          input.userActorId,
        );
        llm.reply = designBatchAcknowledgment({
          count: out.runs.length,
          skill: out.runs[0]?.skill ?? skillId,
          persona: out.persona,
        });
      } catch (err) {
        logger.warn({ err }, "jarvis-brain: design batch dispatch failed");
        llm.reply = `Tried to queue the batch but ${err instanceof Error ? err.message : "it failed"}.`;
      }
    }
  }
  if (llm?.toolCall && llm.toolCall.name === DESIGN_PACK_TOOL_DEF.name) {
    const slug = typeof llm.toolCall.args.preset_slug === "string"
      ? llm.toolCall.args.preset_slug
      : "";
    const brief = typeof llm.toolCall.args.brief === "string" ? llm.toolCall.args.brief : "";
    const voice = typeof llm.toolCall.args.voice === "string" ? llm.toolCall.args.voice : undefined;
    if (slug && brief) {
      try {
        const out = await dispatchDesignPack(
          db,
          input.companyId,
          { preset_slug: slug, brief, voice },
          input.userActorId,
        );
        llm.reply = designPackAcknowledgment(out.presetSlug, out.childRunIds.length);
      } catch (err) {
        logger.warn({ err }, "jarvis-brain: design pack dispatch failed");
        llm.reply = `Tried to fire the design pack but ${err instanceof Error ? err.message : "it failed"}.`;
      }
    }
  }
  if (
    llm?.toolCall &&
    enableDelegation &&
    llm.toolCall.name !== DESIGN_TOOL_DEF.name &&
    llm.toolCall.name !== DESIGN_BATCH_TOOL_DEF.name &&
    llm.toolCall.name !== DESIGN_PACK_TOOL_DEF.name
  ) {
    const peer = TOOL_NAME_TO_PEER[llm.toolCall.name];
    const taskArg = typeof llm.toolCall.args.task === "string" ? llm.toolCall.args.task : "";
    if (peer && taskArg.length > 0) {
      const dispatch: DelegationDispatchResult = await dispatchDelegation(db, {
        companyId: input.companyId,
        conversationId: input.conversationId,
        agent: peer,
        task: taskArg,
        metadata: { ...llm.toolCall.args, source: "jarvis-brain" },
        requestedByActorId: input.userActorId,
      });
      const ackText = naturalAcknowledgment(peer, dispatch);
      delegationOut = {
        id: dispatch.id,
        agent: peer,
        status: dispatch.status,
        reachable: dispatch.reachable,
        remainingQuotaThisMinute: dispatch.remainingQuotaThisMinute,
      };
      // Override the model's free-form text with the canonical phrasing —
      // keeps voice-mode tight and predictable.
      llm.reply = ackText;
    }
  }

  let reply = llm?.reply ?? deterministicReply(input.transcript, ctx, responseType, recentTurns);

  // Belt-and-braces: if the model ignored the voice-mode instruction in
  // the system prompt, strip markdown here too so ElevenLabs / browser
  // TTS doesn't read literal asterisks.
  if (voiceMode) reply = stripMarkdown(reply);

  const enforcement = enforceLengthBudget(reply, responseType);
  const { text: budgeted, truncated } = enforcement;
  reply = budgeted;

  // Length-budget over-run telemetry. agent_bridge_reply_attempts is the
  // closest cross-cutting "model went off the rails" log we already have —
  // every reply that needed truncation lands a row with the pre-trim length
  // so the persona can be tuned (raise/lower the cap, shorten the system
  // prompt, etc.). companyId is required on the row schema so we always
  // include it; agentId/roomId are null since this isn't a room turn.
  if (truncated) {
    void db
      .insert(agentBridgeReplyAttempts)
      .values({
        companyId: input.companyId,
        roomId: null,
        agentId: null,
        contentLength: enforcement.originalLength,
        outcome: "length_overrun",
        metadata: {
          responseType,
          budgetSentences: enforcement.budgetSentences,
          truncatedLength: budgeted.length,
          source: input.source ?? "voice",
          personaVersion: persona.version,
        },
      })
      .catch((err) => {
        logger.warn({ err }, "jarvis-brain: length-overrun log failed");
      });
  }

  const latencyMs = Date.now() - start;
  const provider = llm?.provider ?? null;
  const model = llm?.model ?? null;

  const persistedContext = input.customContextSnapshot
    ?? (ctx as unknown as Record<string, unknown>);

  // Fire-and-forget persist; never fail the user's reply on a write error.
  // We capture the inserted id so the observer pass can stamp the new
  // preference rows it produces with the source message it was derived from.
  const persistPromise = db
    .insert(jarvisConversations)
    .values({
      companyId: input.companyId,
      userActorId: input.userActorId,
      userTranscript: input.transcript.trim().slice(0, 8000),
      agentReply: reply.slice(0, 8000),
      voiceTier: input.voiceTier ?? "browser-native",
      llmProvider: provider,
      llmModel: model,
      personaVersion: persona.version,
      responseType,
      truncated,
      source: input.source ?? null,
      contextSnapshot: persistedContext,
      latencyMs: String(latencyMs),
    })
    .returning({ id: jarvisConversations.id });

  // Preference-learning observer. Truly fire-and-forget — never blocks the
  // user-facing reply. The deterministic-template path skips this since
  // there's nothing for the model to learn from a canned reply.
  if (llm?.reply) {
    void persistPromise
      .then(async (rows) => {
        const sourceMessageId = rows[0]?.id ?? null;
        const observerTurns: RecentTurn[] = [
          ...recentTurns,
          {
            id: sourceMessageId ?? "current",
            userTranscript: input.transcript,
            agentReply: reply,
            createdAt: new Date(),
            source: input.source ?? null,
          },
        ];
        await observeForPreferences(db, {
          companyId: input.companyId,
          userActorId: input.userActorId,
          recentTurns: observerTurns,
          sourceMessageId,
        });
      })
      .catch((err) => {
        logger.warn({ err }, "jarvis-brain: observer pass failed");
      });
  } else {
    void persistPromise.catch((err) => {
      logger.warn({ err }, "jarvis-brain: persist failed");
    });
  }

  return {
    reply,
    llmProvider: provider,
    llmModel: model,
    contextSnapshot: persistedContext,
    latencyMs,
    personaVersion: persona.version,
    personaSource: persona.source,
    truncated,
    responseType,
    delegation: delegationOut,
  };
}

function formatWorkBlock(ctx: ContextBriefing): string {
  const lines: string[] = [];
  if (ctx.queue.length > 0) {
    lines.push("Work queue (active issues, highest-signal first):");
    for (const w of ctx.queue)
      lines.push(
        `  - ${w.ref} ${w.title} [${w.status}${w.priority ? `, ${w.priority}` : ""}${w.assignee ? `, @${w.assignee}` : ""}]`,
      );
  } else {
    lines.push("Work queue: no active issues found.");
  }
  if (ctx.blocked.length > 0) {
    lines.push("Blocked / needs your call:");
    for (const w of ctx.blocked) lines.push(`  - ${w.ref} ${w.title} [${w.status}]`);
  }
  if (ctx.decisions.length > 0) {
    lines.push("Recent changes / decisions (agent config revisions):");
    for (const d of ctx.decisions)
      lines.push(`  - ${d.agentName}: ${d.changed}${d.source ? ` (${d.source})` : ""}`);
  }
  if (ctx.roster.length > 0) {
    lines.push(`Fleet roster (${ctx.fleetActive}/${ctx.fleetTotal} active):`);
    for (const r of ctx.roster)
      lines.push(`  - ${r.name}${r.role ? ` (${r.role})` : ""}: ${r.status}`);
  }
  return lines.join("\n");
}

function composeStandardContext(transcript: string, ctx: ContextBriefing): string {
  return `User said: ${transcript.trim()}

LIVE OPERATIONS CONTEXT (real, current — ground your answer in these specifics; cite issue refs/titles when relevant; do not lead with finance unless asked):
${formatWorkBlock(ctx)}

Finance (only on ask): spend MTD ${formatUsd(ctx.revenueMtdUsd)}${ctx.revenueDeltaPct != null ? ` (${ctx.revenueDeltaPct >= 0 ? "+" : ""}${ctx.revenueDeltaPct.toFixed(1)}%)` : ""}, ${ctx.costAlerts} cost alert(s)${ctx.topBurnAgentName ? `, top burn ${ctx.topBurnAgentName}` : ""}.`;
}

function composeBriefingContext(transcript: string, ctx: ContextBriefing): string {
  return `User said: ${transcript.trim()}

This is a briefing. Lead with WORK (what's queued / who's blocked / fleet / recent decisions). Skip revenue unless there's an alert.

LIVE OPERATIONS SNAPSHOT (real, current):
${formatWorkBlock(ctx)}

Finance (only if Tyler asks): spend MTD ${formatUsd(ctx.revenueMtdUsd)}, ${ctx.costAlerts} cost alert(s).

Respond in 4-6 sentences of prose, weaving the most important queued work, blockers, fleet health, and one concrete recommended next action. Reference real issue refs/titles. Don't enumerate every item — pick the four to six most important.`;
}

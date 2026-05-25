import type { Db } from "@paperclipai/db";
import { jarvisConversations } from "@paperclipai/db";
import { getCostWatcherPayload } from "./cost-watcher.js";
import { issueService } from "./issues.js";
import { agentService } from "./agents.js";
import { getRawKey } from "./provider-api-keys/index.js";
import { logger } from "../middleware/logger.js";

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
}

export interface JarvisBrainOutput {
  reply: string;
  llmProvider: string | null;
  llmModel: string | null;
  contextSnapshot: Record<string, unknown>;
  latencyMs: number;
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
  asOf: string;
}

const JARVIS_SYSTEM_PROMPT = `You are Jarvis — Tyler's voice-first AI assistant inside Paperclip.
You speak with the calm, terse confidence of an experienced chief of staff.
You have direct access to Paperclip's data and tools. Always end with one
concrete recommended next action when appropriate. Replies should be
conversational — they will be spoken aloud — so prefer short sentences
without markdown headers or bullet lists with more than 3 items.`;

async function gatherContext(db: Db, companyId: string): Promise<ContextBriefing> {
  const [costPayload, blockedCount, agentList] = await Promise.all([
    safe(() => getCostWatcherPayload(db, companyId), null),
    safe(() => issueService(db).count(companyId, { attention: "blocked" }), 0),
    safe(() => agentService(db).list(companyId), [] as Array<{ status: string }>),
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

  const fleetTotal = agentList.length;
  const fleetActive = agentList.filter(
    (a) => a.status === "active" || a.status === "running",
  ).length;

  return {
    revenueMtdUsd,
    revenueDeltaPct,
    blockedIssueCount: blockedCount,
    topBurnAgentName,
    topBurnAgentSpendUsd,
    fleetTotal,
    fleetActive,
    costAlerts,
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

function deterministicReply(transcript: string, ctx: ContextBriefing): string {
  const lowered = transcript.toLowerCase();
  if (lowered.includes("revenue") || lowered.includes("kpi") || lowered.includes("stats") || lowered.includes("money")) {
    const delta =
      ctx.revenueDeltaPct == null
        ? ""
        : ` ${ctx.revenueDeltaPct >= 0 ? "up" : "down"} ${Math.abs(ctx.revenueDeltaPct).toFixed(1)} percent`;
    return `Spend month-to-date is ${formatUsd(ctx.revenueMtdUsd)}${delta}. ${ctx.costAlerts} active cost alerts. Want me to pull the breakdown by provider?`;
  }
  if (lowered.includes("block") || lowered.includes("stuck") || lowered.includes("waiting")) {
    return `${ctx.blockedIssueCount} blocked issues right now. ${ctx.fleetActive} of ${ctx.fleetTotal} agents are active. Should I list which are waiting on you?`;
  }
  if (lowered.includes("burn") || lowered.includes("expensive") || lowered.includes("cost")) {
    return ctx.topBurnAgentName
      ? `Top burn last 24h is ${ctx.topBurnAgentName} at ${formatUsd(ctx.topBurnAgentSpendUsd)}. ${ctx.costAlerts} alerts open. Want me to pause it?`
      : `No notable burn in the last 24 hours. ${ctx.fleetActive} of ${ctx.fleetTotal} agents active.`;
  }
  if (lowered.includes("fleet") || lowered.includes("agents") || lowered.includes("status")) {
    return `${ctx.fleetActive} of ${ctx.fleetTotal} agents active. ${ctx.blockedIssueCount} blocked issues, ${ctx.costAlerts} cost alerts. What would you like me to dig into?`;
  }
  if (lowered.startsWith("brief") || lowered.includes("morning") || lowered.includes("good morning") || lowered.includes("evening")) {
    return `Good to see you. Spend MTD ${formatUsd(ctx.revenueMtdUsd)}. ${ctx.blockedIssueCount} blocked issues, ${ctx.fleetActive} active agents, ${ctx.costAlerts} cost alerts. What would you like to handle first?`;
  }
  return `I have today's snapshot. ${ctx.fleetActive} of ${ctx.fleetTotal} agents active, ${ctx.blockedIssueCount} blocked issues, spend ${formatUsd(ctx.revenueMtdUsd)} MTD. Ask about revenue, blockers, or burn for more detail.`;
}

interface LlmCallResult {
  reply: string;
  provider: string;
  model: string;
}

/**
 * Tries DeepSeek first (cheap + fast, ~250ms first token), falls back to
 * OpenAI gpt-4o-mini. Returns null if neither key is configured.
 */
async function callLlm(
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmCallResult | null> {
  const deepseekKey = await getRawKey("deepseek").catch(() => null);
  if (deepseekKey) {
    try {
      const result = await fetchChatCompletion({
        url: "https://api.deepseek.com/chat/completions",
        apiKey: deepseekKey,
        model: "deepseek-chat",
        systemPrompt,
        userPrompt,
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
      });
      if (result) return { ...result, provider: "openai" };
    } catch (err) {
      logger.warn({ err }, "jarvis-brain: openai call failed");
    }
  }

  return null;
}

async function fetchChatCompletion({
  url,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ reply: string; model: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 280,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
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
  const ctx = await gatherContext(db, input.companyId);

  const userPrompt = `User said: ${input.transcript.trim()}

Company snapshot (real numbers, use these when answering):
- Spend month-to-date: ${formatUsd(ctx.revenueMtdUsd)}${ctx.revenueDeltaPct != null ? ` (${ctx.revenueDeltaPct >= 0 ? "+" : ""}${ctx.revenueDeltaPct.toFixed(1)}% vs prior month)` : ""}
- Blocked issues: ${ctx.blockedIssueCount}
- Top burn agent (last 24h): ${ctx.topBurnAgentName ?? "none"}${ctx.topBurnAgentSpendUsd != null ? ` (${formatUsd(ctx.topBurnAgentSpendUsd)})` : ""}
- Fleet: ${ctx.fleetActive} active of ${ctx.fleetTotal} total
- Open cost alerts: ${ctx.costAlerts}`;

  const llm = await callLlm(JARVIS_SYSTEM_PROMPT, userPrompt);
  const reply = llm?.reply ?? deterministicReply(input.transcript, ctx);
  const latencyMs = Date.now() - start;
  const provider = llm?.provider ?? null;
  const model = llm?.model ?? null;

  // Fire-and-forget persist; never fail the user's reply on a write error.
  void db
    .insert(jarvisConversations)
    .values({
      companyId: input.companyId,
      userActorId: input.userActorId,
      userTranscript: input.transcript.trim().slice(0, 8000),
      agentReply: reply.slice(0, 8000),
      voiceTier: input.voiceTier ?? "browser-native",
      llmProvider: provider,
      llmModel: model,
      contextSnapshot: ctx as unknown as Record<string, unknown>,
      latencyMs: String(latencyMs),
    })
    .catch((err) => {
      logger.warn({ err }, "jarvis-brain: persist failed");
    });

  return {
    reply,
    llmProvider: provider,
    llmModel: model,
    contextSnapshot: ctx as unknown as Record<string, unknown>,
    latencyMs,
  };
}

import type { Db } from "@paperclipai/db";
import { jarvisConversations, agentBridgeReplyAttempts } from "@paperclipai/db";
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
): string {
  const lowered = transcript.toLowerCase();
  const asksFinance =
    lowered.includes("revenue") ||
    lowered.includes("kpi") ||
    lowered.includes("spend") ||
    lowered.includes("burn") ||
    lowered.includes("money") ||
    lowered.includes("cost");

  // Finance only when explicitly asked.
  if (asksFinance) {
    if (lowered.includes("burn") || lowered.includes("expensive") || lowered.includes("cost")) {
      return ctx.topBurnAgentName
        ? `Top burn last 24 hours is ${ctx.topBurnAgentName} at ${formatUsd(ctx.topBurnAgentSpendUsd)}, with ${ctx.costAlerts} alerts open. Want me to pause it?`
        : `No notable burn in the last 24 hours, and the fleet's healthy at ${ctx.fleetActive} of ${ctx.fleetTotal} active. Anything you want me to dig into?`;
    }
    const delta =
      ctx.revenueDeltaPct == null
        ? ""
        : ` ${ctx.revenueDeltaPct >= 0 ? "up" : "down"} ${Math.abs(ctx.revenueDeltaPct).toFixed(1)} percent`;
    return `Spend month-to-date is ${formatUsd(ctx.revenueMtdUsd)}${delta}, with ${ctx.costAlerts} active alerts. Want me to break it down by provider?`;
  }

  if (lowered.includes("block") || lowered.includes("stuck") || lowered.includes("waiting")) {
    return `${ctx.blockedIssueCount} blocked issues right now, and ${ctx.fleetActive} of ${ctx.fleetTotal} agents are active. Want me to walk you through what's waiting on you?`;
  }
  if (lowered.includes("fleet") || lowered.includes("agents") || (lowered.includes("status") && !lowered.includes("morning"))) {
    return `${ctx.fleetActive} of ${ctx.fleetTotal} agents are active, with ${ctx.blockedIssueCount} blocked issues open. Anything specific you want me to check on?`;
  }

  // Briefing or morning-style greeting — lead with work, weave 4-6 things.
  if (
    responseType === "briefing" ||
    lowered.startsWith("brief") ||
    lowered.includes("morning") ||
    lowered.includes("good morning") ||
    lowered.includes("good evening") ||
    lowered.includes("good afternoon") ||
    lowered.includes("rundown")
  ) {
    const greeting =
      lowered.includes("morning") ? "Good morning, Tyler."
        : lowered.includes("evening") ? "Good evening, Tyler."
        : lowered.includes("afternoon") ? "Good afternoon, Tyler."
        : "Here's where things stand.";
    const blockers =
      ctx.blockedIssueCount > 0
        ? ` ${ctx.blockedIssueCount} item${ctx.blockedIssueCount === 1 ? "" : "s"} blocked — those need your call when you have a minute.`
        : " Nothing blocked on you right now.";
    const fleet =
      ctx.fleetActive === ctx.fleetTotal
        ? ` The fleet's healthy, all ${ctx.fleetTotal} agents online.`
        : ` Fleet is ${ctx.fleetActive} of ${ctx.fleetTotal} agents active — the rest are idle or paused.`;
    const alerts =
      ctx.costAlerts > 0
        ? ` ${ctx.costAlerts} cost alert${ctx.costAlerts === 1 ? "" : "s"} firing${ctx.topBurnAgentName ? ` on ${ctx.topBurnAgentName}` : ""}.`
        : "";
    const reco = ctx.blockedIssueCount > 0
      ? " My recommendation: clear the blocked queue first. Want me to pull them up?"
      : ctx.costAlerts > 0
        ? " Recommend looking at the cost alerts. Want me to break them down?"
        : " Recommend a quick scan of the active runs — want a list?";
    return `${greeting}${blockers}${fleet}${alerts}${reco}`;
  }

  // Standard / quick fallback.
  return `${ctx.blockedIssueCount} blocked issues, ${ctx.fleetActive} of ${ctx.fleetTotal} agents active. Want me to dig into anything specific?`;
}

interface LlmCallResult {
  reply: string;
  provider: string;
  model: string;
}

/**
 * Tries Anthropic Claude first (Augi-as-brain), then DeepSeek, then OpenAI.
 * Returns null if no provider key is configured or all of them fail. The
 * brain falls back to a deterministic, data-grounded template in that case.
 */
async function callLlm(
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmCallResult | null> {
  const anthropicKey = await getRawKey("anthropic").catch(() => null);
  if (anthropicKey) {
    try {
      const result = await fetchAnthropicMessage({
        apiKey: anthropicKey,
        model: "claude-opus-4-7",
        systemPrompt,
        userPrompt,
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
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ reply: string; model: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 400,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
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
  const voiceMode = input.voiceMode ?? false;
  const responseType: ResponseType = input.responseType ?? inferResponseType(input.transcript);

  // Persona load + context + capability snapshot all run in parallel.
  // Capabilities are appended to the system prompt so Augi can answer
  // "what can you do?" accurately for THIS machine.
  const [persona, ctx, capSnapshot] = await Promise.all([
    loadPersona(),
    gatherContext(db, input.companyId),
    getCapabilitySnapshot().catch(() => null),
  ]);

  const basePrompt = formatPersonaForCall(persona, { voiceMode, responseType });
  const systemPrompt = capSnapshot
    ? `${basePrompt}\n\nCAPABILITY GROUNDING (real probe of this host, ${capSnapshot.generatedAt}): ${summarizeForPersona(capSnapshot)} When asked what you can do, ground your answer in these — do not promise capabilities marked needs_install or unsupported without flagging the install hint.`
    : basePrompt;

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

  const llm = await callLlm(systemPrompt, userPrompt);
  let reply = llm?.reply ?? deterministicReply(input.transcript, ctx, responseType);

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
      personaVersion: persona.version,
      responseType,
      truncated,
      source: input.source ?? null,
      contextSnapshot: persistedContext,
      latencyMs: String(latencyMs),
    })
    .catch((err) => {
      logger.warn({ err }, "jarvis-brain: persist failed");
    });

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
  };
}

function composeStandardContext(transcript: string, ctx: ContextBriefing): string {
  return `User said: ${transcript.trim()}

Company snapshot (use real numbers only when relevant — do not lead with finance unless asked):
- Blocked issues: ${ctx.blockedIssueCount}
- Top burn agent (last 24h, only mention if asked or alerts > 0): ${ctx.topBurnAgentName ?? "none"}${ctx.topBurnAgentSpendUsd != null ? ` (${formatUsd(ctx.topBurnAgentSpendUsd)})` : ""}
- Fleet: ${ctx.fleetActive} active of ${ctx.fleetTotal} total
- Open cost alerts: ${ctx.costAlerts}
- Spend MTD (only on ask): ${formatUsd(ctx.revenueMtdUsd)}${ctx.revenueDeltaPct != null ? ` (${ctx.revenueDeltaPct >= 0 ? "+" : ""}${ctx.revenueDeltaPct.toFixed(1)}%)` : ""}`;
}

function composeBriefingContext(transcript: string, ctx: ContextBriefing): string {
  // Per persona: lead with work, not revenue. Order the snapshot the way
  // we want it surfaced.
  return `User said: ${transcript.trim()}

This is a briefing. Lead with WORK (what shipped / who's blocked / fleet / projects). Skip revenue unless there's an alert.

Operations snapshot (real, current):
- Blocked work: ${ctx.blockedIssueCount} blocked issues right now
- Fleet status: ${ctx.fleetActive} active of ${ctx.fleetTotal} total agents
- Open cost alerts (mention only if > 0): ${ctx.costAlerts}
- Top burn agent (mention only if alerts > 0): ${ctx.topBurnAgentName ?? "none"}${ctx.topBurnAgentSpendUsd != null ? ` (${formatUsd(ctx.topBurnAgentSpendUsd)})` : ""}
- Spend MTD (only if Tyler asks for it): ${formatUsd(ctx.revenueMtdUsd)}

Respond in 4-6 sentences of prose, weaving what shipped overnight (you may invent reasonable activity if no real data is wired yet — be honest in tone), blockers, fleet health, and one concrete recommended next action. Do not enumerate every bullet — pick the four to six most important things.`;
}

/**
 * Brainstorm kickoff — the live Hermes <-> Brainstorm planning loop.
 * ------------------------------------------------------------------
 * When Tyler explicitly sends an agreed project from the War Room Conversation
 * view to Brainstorm, this module:
 *   1. Distills the current session into a concise PROJECT BRIEF (Hermes lane).
 *   2. Creates/opens a `type:"mission"` planning room and seeds it with the brief.
 *   3. Runs a BOUNDED Hermes<->Brainstorm exchange, posting every turn into the
 *      room (the BrainstormPanel streams the room messages live, 3s poll).
 *   4. Captures a final agreed PLAN at the end of the room (ready to hand to
 *      Ares later — that handoff is a deliberate follow-up, not wired here).
 *
 * Model lanes (REAL — no canned/faked turns):
 *   - Hermes (planner)   = BRAINSTORM_HERMES_MODEL  (default = augivector-research,
 *                          the litellm Kimi K2.6 lane — real Hermes is Kimi K2.6)
 *   - Brainstorm (critic)= BRAINSTORM_CRITIC_MODEL   (default = augivector-glm,
 *                          the GLM-5.2 deep-reasoning lane Atlas uses)
 * Both are real chat-completions calls through the AugiVector gateway proxy
 * (the same OpenAI-compatible lane jarvis-brain already uses). Point
 * BRAINSTORM_HERMES_MODEL at a Kimi gateway lane to swap Hermes onto Kimi.
 *
 * Additive & non-destructive: OpenViking / QMD / memory-core untouched. The
 * loop is bounded by BRAINSTORM_MAX_ROUNDS, a wall-clock backstop
 * (BRAINSTORM_MAX_WALL_MS, ~10 min default), and the room's existing
 * ROOM_MESSAGE_HARD_CAP, so it cannot run away.
 */
import type { Db } from "@paperclipai/db";
import { jarvisConversations, agents } from "@paperclipai/db";
import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { roomService } from "./rooms.js";
import { publishLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";

// --- Config / lanes ---------------------------------------------------------
const PROXY_URL =
  process.env.AUGIVECTOR_URL ?? "http://localhost:3000/v1/chat/completions";
const PROXY_TOKEN = process.env.AUGIVECTOR_TOKEN ?? "local";
const HERMES_MODEL =
  process.env.BRAINSTORM_HERMES_MODEL ??
  // Real Hermes is Kimi K2.6. augivector-research is the litellm Kimi lane
  // (augivector-research -> openai/kimi-k2.6). The previous augivector-auto
  // default routed Hermes to DeepSeek, so the loop's "Hermes" was not Kimi.
  "augivector-research";
const CRITIC_MODEL = process.env.BRAINSTORM_CRITIC_MODEL ?? "augivector-glm";

// Per-lane sampling temperature. Kimi K2.6 (the Hermes lane) only accepts
// temperature = 1 — the proxy rejects any other value for that lane with a 400 —
// so default Hermes to 1. The GLM critic keeps a lower temperature for tighter,
// more deterministic critiques. Both are env-overridable.
function parseTemp(v: string | undefined, def: number): number {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : def;
}
const HERMES_TEMPERATURE = parseTemp(process.env.BRAINSTORM_HERMES_TEMPERATURE, 1);
const CRITIC_TEMPERATURE = parseTemp(process.env.BRAINSTORM_CRITIC_TEMPERATURE, 0.5);

function clampInt(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, lo), hi);
}
// Bounded: each "round" is one Brainstorm critique + one Hermes revision.
const MAX_ROUNDS = clampInt(process.env.BRAINSTORM_MAX_ROUNDS, 8, 1, 16);
const TURN_TIMEOUT_MS = clampInt(process.env.BRAINSTORM_TURN_TIMEOUT_MS, 60_000, 10_000, 180_000);
// Wall-clock backstop (~10 min default): even with the higher round cap, a loop
// where the two sides keep disagreeing still can't run away. The room's
// ROOM_MESSAGE_HARD_CAP remains a second, independent backstop.
const MAX_WALL_MS = clampInt(process.env.BRAINSTORM_MAX_WALL_MS, 600_000, 60_000, 3_600_000);

// --- Convergence signal ------------------------------------------------------
// Either speaker may end the loop by emitting the AGREED marker on its own line.
const AGREED_RE = /(^|\n)\s*(AGREED|CONVERGED)\b/i;
function isAgreed(text: string): boolean {
  return AGREED_RE.test(text);
}

// --- Low-level chat helper (OpenAI-compatible proxy) -------------------------
export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chat(
  model: string,
  messages: ChatMsg[],
  maxTokens = 1100,
  temperature = 0.5,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  try {
    const resp = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PROXY_TOKEN}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      throw new Error(`proxy HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
    };
    const msg = data?.choices?.[0]?.message ?? {};
    const content = (msg.content ?? "").trim();
    if (content) return content;
    // GLM-style reasoning lanes can spend the whole budget in reasoning and
    // return empty content — fall back to the reasoning text so the turn is
    // never silently blank.
    const reasoning = (msg.reasoning_content ?? "").trim();
    if (reasoning) return reasoning;
    // ponytail: fail-closed — empty response from a gate model is a gate failure
    throw new Error(`proxy HTTP ${resp.status}: empty response from ${model}`);
  } finally {
    clearTimeout(timer);
  }
}

// --- Persona prompts ---------------------------------------------------------
const HERMES_SYS = [
  "You are Hermes, Tyler's Chief of Staff and the planner in a live planning loop.",
  "Your partner is Brainstorm (a GLM-5.2 plan critic). Turn the PROJECT BRIEF into a",
  "concrete, bite-sized, checkpointed execution plan: each task ~1 logical change",
  "(1-2 files), with the change, a test (TDD), and how to verify; add stop-and-verify",
  "checkpoints between task groups. Respond directly to Brainstorm's critiques and",
  "tighten the plan each turn. Be concise (<=200 words per turn). When the plan is",
  "solid and you and Brainstorm agree, output the final numbered plan and then put",
  "AGREED on its own final line.",
].join(" ");

const CRITIC_SYS = [
  "You are Brainstorm, a sharp GLM-5.2 plan critic (the plan-critic tier between",
  "Hermes and Ares). Pressure-test Hermes's plan against: chunk size, sequencing,",
  "single-writer rule, risk, missing tests, and checkpoint placement. Be terse and",
  "specific (<=150 words). Approve only when each task is bite-sized and",
  "independently verifiable. When you genuinely approve, put AGREED on its own final",
  "line; otherwise give the single most important concrete fix.",
].join(" ");

// --- Tools-required manifest instruction (dynamic-tool-loading, Part B / Phase 1)
// Appended to Hermes' FINAL-PLAN turn so the plan optionally declares which MCP
// servers + skills the build needs. Parsed downstream (parseToolsRequired) and
// carried verbatim through the delegation metadata to the worker. Optional &
// back-compat: if Hermes omits the block, downstream falls back to the lean
// context7-only baseline. Shape is the manifest defined in
// dynamic-tool-loading-plan.md.
const TOOLS_REQUIRED_INSTRUCTION = [
  "Then, on a NEW line AFTER the plan, emit a single fenced code block tagged",
  "`tools-required` containing ONLY JSON declaring the tools this build needs:",
  "```tools-required",
  "{",
  '  "version": 1,',
  '  "servers": ["context7"],',
  '  "skills": [],',
  '  "tools_allow": [],',
  '  "tools_deny": [],',
  '  "baseline_servers": ["context7"],',
  '  "teardown": "reset-to-baseline",',
  '  "reason": "<one short phrase>",',
  '  "ttl_seconds": 1800',
  "}",
  "```",
  "Name only MCP servers/skills the work genuinely needs beyond the context7",
  "baseline; if unsure, keep servers=[\"context7\"] and skills=[] (the lean",
  "default). Every field except `version` is optional. Omit the whole block if",
  "no extra tools are needed — absence means the lean baseline.",
].join(" ");

// --- Brief distillation ------------------------------------------------------
export interface ProjectBrief {
  title: string;
  brief: string;
}

async function recentTurns(
  db: Db,
  companyId: string,
  userActorId: string | null,
  limit = 12,
): Promise<{ user: string; agent: string }[]> {
  const conds = [
    eq(jarvisConversations.companyId, companyId),
    isNull(jarvisConversations.clearedAt),
  ];
  if (userActorId) conds.push(eq(jarvisConversations.userActorId, userActorId));
  const rows = await db
    .select({
      user: jarvisConversations.userTranscript,
      agent: jarvisConversations.agentReply,
    })
    .from(jarvisConversations)
    .where(and(...conds))
    .orderBy(desc(jarvisConversations.createdAt))
    .limit(limit);
  return rows.reverse();
}

/**
 * Hermes distills the current session into a PROJECT BRIEF. If `seed` (e.g. an
 * approved plan title/steps from the conversation) is supplied it anchors the
 * brief. Falls back to a minimal brief if the model lane is unreachable.
 */
export async function distillBrief(
  db: Db,
  companyId: string,
  userActorId: string | null,
  seed?: { title?: string; text?: string },
): Promise<ProjectBrief> {
  const turns = await recentTurns(db, companyId, userActorId);
  const transcript = turns
    .map((t) => `Tyler: ${t.user}\nHermes: ${t.agent}`)
    .join("\n\n")
    .slice(-6000);

  const seedBlock = seed?.text
    ? `\n\nThe project Tyler just agreed to:\n${seed.text}`
    : "";

  const messages: ChatMsg[] = [
    {
      role: "system",
      content:
        "You are Hermes. Distill the conversation into a tight PROJECT BRIEF for a " +
        "planning session with Brainstorm. Output EXACTLY:\nTITLE: <=8 word title\n" +
        "BRIEF:\n<3-6 sentences: the goal, scope, key constraints, and what 'done' looks like>",
    },
    {
      role: "user",
      content: `Conversation so far:\n${transcript || "(no prior turns)"}${seedBlock}`,
    },
  ];

  let raw = "";
  try {
    raw = await chat(HERMES_MODEL, messages, 600, HERMES_TEMPERATURE);
  } catch (err) {
    logger.warn({ err }, "brainstorm-kickoff: distillBrief lane failed; using seed fallback");
  }

  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const briefMatch = raw.match(/BRIEF:\s*([\s\S]+)/i);
  const title = (titleMatch?.[1] ?? seed?.title ?? "Planning session").trim().slice(0, 80);
  const brief = (briefMatch?.[1] ?? raw ?? seed?.text ?? title).trim();
  return { title, brief: brief || title };
}

// --- Room posting ------------------------------------------------------------
type RoomSvc = ReturnType<typeof roomService>;

async function postTurn(
  svc: RoomSvc,
  companyId: string,
  roomId: string,
  senderId: string,
  content: string,
  kind: string,
  parentMessageId?: string | null,
): Promise<string> {
  const message = await svc.sendMessage({
    roomId,
    senderId,
    senderType: "agent",
    senderName: senderId,  // ponytail: senderId IS the display name for these gate agents
    content,
    messageType: "chat",
    metadata: { kind },
    parentMessageId: parentMessageId ?? null,
  });
  publishLiveEvent({
    companyId,
    type: "room.message",
    payload: {
      roomId,
      messageId: message.id,
      senderId: message.senderId,
      senderType: message.senderType,
      content: message.content,
      messageType: message.messageType,
      parentMessageId: message.parentMessageId,
      createdAt: message.createdAt,
    },
  });
  return message.id;
}

async function tryAddAgentMember(
  db: Db,
  svc: RoomSvc,
  roomId: string,
  nameLike: string,
): Promise<void> {
  try {
    // Exact name match — avoids matching archived agents like "Hermes Book Writer".
    const found = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, nameLike))
      .limit(1);
    const agentId = found[0]?.id;
    if (agentId) await svc.addMember({ roomId, agentId, role: "member" });
  } catch (err) {
    logger.warn({ err, nameLike }, "brainstorm-kickoff: optional member add failed");
  }
}

// --- The bounded loop --------------------------------------------------------
interface Exchange {
  speaker: "hermes" | "brainstorm";
  text: string;
}

function toChatHistory(
  sys: string,
  self: "hermes" | "brainstorm",
  brief: string,
  history: Exchange[],
): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: "system", content: sys }];
  // The brief is the shared starting context.
  msgs.push({ role: "user", content: `PROJECT BRIEF:\n${brief}` });
  for (const ex of history) {
    msgs.push({
      role: ex.speaker === self ? "assistant" : "user",
      content: ex.text,
    });
  }
  return msgs;
}

async function runLoop(
  db: Db,
  companyId: string,
  roomId: string,
  brief: string,
): Promise<void> {
  const svc = roomService(db);
  const history: Exchange[] = [];
  let converged = false;
  const deadline = Date.now() + MAX_WALL_MS;

  try {
    // Hermes drafts the first plan from the brief so Brainstorm always has a
    // concrete plan to pressure-test on round 1.
    const draft = await chat(
      HERMES_MODEL,
      toChatHistory(HERMES_SYS, "hermes", brief, history),
      1200,
      HERMES_TEMPERATURE,
    );
    const draftText = draft || "(no response from the Hermes lane)";
    history.push({ speaker: "hermes", text: draftText });
    await postTurn(svc, companyId, roomId, "hermes", draftText, "plan-turn");
    converged = isAgreed(draftText);

    for (let round = 1; round <= MAX_ROUNDS && !converged && Date.now() < deadline; round++) {
      // 1) Brainstorm (GLM) critiques the current plan.
      const critic = await chat(
        CRITIC_MODEL,
        toChatHistory(CRITIC_SYS, "brainstorm", brief, history),
        1200,
        CRITIC_TEMPERATURE,
      );
      const criticText = critic || "(no response from the Brainstorm lane)";
      history.push({ speaker: "brainstorm", text: criticText });
      await postTurn(svc, companyId, roomId, "brainstorm", criticText, "plan-turn");
      if (isAgreed(criticText)) {
        converged = true;
        break;
      }

      // 2) Hermes revises in response.
      const hermes = await chat(
        HERMES_MODEL,
        toChatHistory(HERMES_SYS, "hermes", brief, history),
        1200,
        HERMES_TEMPERATURE,
      );
      const hermesText = hermes || "(no response from the Hermes lane)";
      history.push({ speaker: "hermes", text: hermesText });
      await postTurn(svc, companyId, roomId, "hermes", hermesText, "plan-turn");
      if (isAgreed(hermesText)) {
        converged = true;
        break;
      }
    }

    // 3) Final agreed PLAN — Hermes writes it for the record (and for Ares later).
    const finalMsgs = toChatHistory(HERMES_SYS, "hermes", brief, history);
    finalMsgs.push({
      role: "user",
      content:
        (converged
          ? "You converged. "
          : "The planning window is closing without an explicit AGREED. ") +
        "Write the FINAL agreed plan now: a short title line, then the numbered " +
        "bite-sized tasks (each with files/change/test/verify) and the " +
        "stop-and-verify checkpoints. This is the handoff artifact for Ares.\n\n" +
        TOOLS_REQUIRED_INSTRUCTION,
    });
    const finalPlan = await chat(HERMES_MODEL, finalMsgs, 1400, HERMES_TEMPERATURE);
    await postTurn(
      svc,
      companyId,
      roomId,
      "hermes",
      `FINAL PLAN${converged ? " (converged)" : " (window closed)"}:\n\n${
        finalPlan || "(plan lane unreachable)"
      }`,
      "final-plan",
    );
  } catch (err) {
    logger.warn({ err, roomId }, "brainstorm-kickoff: loop error");
    try {
      await postTurn(
        svc,
        companyId,
        roomId,
        "system",
        `Planning loop stopped early: ${(err as Error).message}.`,
        "loop-error",
      );
    } catch {
      /* swallow */
    }
  }
}

// --- Public entrypoint -------------------------------------------------------
export interface KickoffResult {
  roomId: string;
  roomName: string;
  title: string;
  brief: string;
}

/**
 * Distill the brief, create + seed the planning room, and start the bounded
 * loop in the background. Returns as soon as the room is seeded so the UI can
 * switch to the Brainstorm tab and stream the turns as they land.
 */
export async function kickoffBrainstorm(
  db: Db,
  opts: {
    companyId: string;
    userActorId: string | null;
    createdBy?: string | null;
    title?: string;
    brief?: string;
    seedText?: string;
  },
): Promise<KickoffResult> {
  const svc = roomService(db);

  const distilled =
    opts.brief && opts.brief.trim()
      ? { title: (opts.title ?? "Planning session").slice(0, 80), brief: opts.brief.trim() }
      : await distillBrief(db, opts.companyId, opts.userActorId, {
          title: opts.title,
          text: opts.seedText ?? opts.title,
        });

  const roomName = `Brainstorm · ${distilled.title}`;
  const room = await svc.create(opts.companyId, {
    name: roomName,
    description: "Live Hermes <-> Brainstorm planning loop",
    type: "mission",
    status: "active",
    createdBy: opts.createdBy ?? null,
  });

  // Best-effort agent membership: exact name match to avoid stale/archived agents.
  await tryAddAgentMember(db, svc, room.id, "Hermes");
  await tryAddAgentMember(db, svc, room.id, "Zeus Critic");

  // Seed the room with the brief.
  await postTurn(
    svc,
    opts.companyId,
    room.id,
    "hermes",
    `PROJECT BRIEF — ${distilled.title}\n\n${distilled.brief}\n\nBrainstorm, pressure-test this and let's converge on a plan.`,
    "plan-brief",
  );

  // Fire-and-forget the bounded loop.
  void runLoop(db, opts.companyId, room.id, distilled.brief).catch((err) =>
    logger.warn({ err, roomId: room.id }, "brainstorm-kickoff: runLoop rejected"),
  );

  return {
    roomId: room.id,
    roomName,
    title: distilled.title,
    brief: distilled.brief,
  };
}

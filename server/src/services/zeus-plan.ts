/**
 * Zeus Plan — the live Zeus <-> Brainstorm planning loop.
 * ------------------------------------------------------------------
 * When Tyler states an intent from the Tasks board IntentBox, this module:
 *   1. Creates/opens a `type:"mission"` planning room and seeds it with the brief.
 *   2. Zeus (DeepSeek / planner) produces the initial draft plan.
 *   3. Brainstorm (GLM-5.2 / critic) pressure-tests the plan.
 *   4. Zeus and Brainstorm iterate to convergence (bounded loop).
 *   5. Captures a final agreed PLAN tagged with kind "final-plan".
 *
 * Pipeline: intent → Zeus (plan) → Brainstorm (critique) → converge → DraftPlanReview
 *
 * Model lanes (REAL):
 *   - Zeus (planner) = ZEUS_PLAN_MODEL  (default = augivector-auto, DeepSeek lane)
 *   - Brainstorm (critic) = ZEUS_CRITIC_MODEL (default = augivector-glm, GLM-5.2 lane)
 *
 * Additive & non-destructive: OpenViking / QMD / memory-core untouched. The
 * loop is bounded by ZEUS_MAX_ROUNDS, a wall-clock backstop
 * (ZEUS_MAX_WALL_MS), and the room's existing ROOM_MESSAGE_HARD_CAP.
 */
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { jarvisConversations } from "@paperclipai/db";
import { roomService } from "./rooms.js";
import { publishLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";

// --- Config / lanes ---------------------------------------------------------
const PROXY_URL =
  process.env.AUGIVECTOR_URL ?? "http://localhost:3000/v1/chat/completions";
const PROXY_TOKEN = process.env.AUGIVECTOR_TOKEN ?? "local";
const ZEUS_MODEL =
  process.env.ZEUS_PLAN_MODEL ??
  // Zeus is DeepSeek V4 Flash via the augivector-auto litellm lane.
  "augivector-auto";
const CRITIC_MODEL =
  process.env.ZEUS_CRITIC_MODEL ??
  // Brainstorm is GLM-5.2 via the augivector-glm litellm lane.
  "augivector-glm";

// Per-lane sampling temperature.
function parseTemp(v: string | undefined, def: number): number {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : def;
}
const ZEUS_TEMPERATURE = parseTemp(process.env.ZEUS_TEMPERATURE, 0.7);
const CRITIC_TEMPERATURE = parseTemp(process.env.ZEUS_CRITIC_TEMPERATURE, 0.5);

function clampInt(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, lo), hi);
}
const MAX_ROUNDS = clampInt(process.env.ZEUS_MAX_ROUNDS, 6, 1, 16);
const TURN_TIMEOUT_MS = clampInt(process.env.ZEUS_TURN_TIMEOUT_MS, 60_000, 10_000, 180_000);
const MAX_WALL_MS = clampInt(process.env.ZEUS_MAX_WALL_MS, 600_000, 60_000, 3_600_000);

// --- Convergence signal -----------------------------------------------------
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
        Authorization: `Bearer     ${PROXY_TOKEN}`,
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
    return (msg.reasoning_content ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

// --- Persona prompts ---------------------------------------------------------
const ZEUS_SYS = [
  "You are Zeus, Tyler's Chief of Staff and the top orchestrator of his agent fleet.",
  "Your role is to translate Tyler's stated intent into a concrete, bite-sized,",
  "checkpointed execution plan. Each task should be ~1 logical change (1-2 files),",
  "with the change, a test (TDD), and how to verify. Include stop-and-verify",
  "checkpoints between task groups.",
  "",
  "Your partner is Brainstorm (a GLM-5.2 plan critic). You respond directly to",
  "Brainstorm's critiques and tighten the plan each turn. Be concise (<=200 words",
  "per turn). When the plan is solid and Brainstorm agrees, output the final",
  "numbered plan and then put AGREED on its own final line.",
  "",
  "Important: produce plans that are specific and actionable — file names,",
  "component names, API endpoints, and concrete expected behavior. Don't be vague.",
].join(" ");

const CRITIC_SYS = [
  "You are Brainstorm, a sharp GLM-5.2 plan critic in the Zeus pipeline.",
  "Zeus (the orchestrator) proposes execution plans; you pressure-test them.",
  "Critique against: chunk size (each task should be ~1 logical change),",
  "sequencing, single-writer rule, risk, missing tests, and checkpoint placement.",
  "Be terse and specific (<=150 words).",
  "",
  "Approve only when each task is bite-sized and independently verifiable.",
  "When you genuinely approve, put AGREED on its own final line; otherwise",
  "give the single most important concrete fix.",
].join(" ");

// --- Tools-required manifest instruction (same as brainstorm-kickoff) --------
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
    const found = await db
      .select({ id: agents.id })
      .from(agents)
      .where(ilike(agents.name, `%${nameLike}%`))
      .limit(1);
    const agentId = found[0]?.id;
    if (agentId) await svc.addMember({ roomId, agentId, role: "member" });
  } catch (err) {
    logger.warn({ err, nameLike }, "zeus-plan: optional member add failed");
  }
}

// --- The bounded loop --------------------------------------------------------
interface Exchange {
  speaker: "zeus" | "brainstorm";
  text: string;
}

function toChatHistory(
  sys: string,
  self: "zeus" | "brainstorm",
  brief: string,
  history: Exchange[],
): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: "system", content: sys }];
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
    // Zeus drafts the first plan from the brief so Brainstorm always has a
    // concrete plan to pressure-test on round 1.
    const draft = await chat(
      ZEUS_MODEL,
      toChatHistory(ZEUS_SYS, "zeus", brief, history),
      1200,
      ZEUS_TEMPERATURE,
    );
    const draftText = draft || "(no response from the Zeus lane)";
    history.push({ speaker: "zeus", text: draftText });
    await postTurn(svc, companyId, roomId, "zeus", draftText, "plan-turn");
    converged = isAgreed(draftText);

    for (let round = 1; round <= MAX_ROUNDS && !converged && Date.now() < deadline; round++) {
      // 1) Brainstorm (GLM) critiques Zeus's current plan.
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

      // 2) Zeus revises in response to Brainstorm's critique.
      const revised = await chat(
        ZEUS_MODEL,
        toChatHistory(ZEUS_SYS, "zeus", brief, history),
        1200,
        ZEUS_TEMPERATURE,
      );
      const revisedText = revised || "(no response from the Zeus lane)";
      history.push({ speaker: "zeus", text: revisedText });
      await postTurn(svc, companyId, roomId, "zeus", revisedText, "plan-turn");
      if (isAgreed(revisedText)) {
        converged = true;
        break;
      }
    }

    // 3) Final agreed PLAN — Zeus writes it for the record (and for Ares later).
    const finalMsgs = toChatHistory(ZEUS_SYS, "zeus", brief, history);
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
    const finalPlan = await chat(ZEUS_MODEL, finalMsgs, 1400, ZEUS_TEMPERATURE);
    await postTurn(
      svc,
      companyId,
      roomId,
      "zeus",
      `FINAL PLAN${converged ? " (converged)" : " (window closed)"}:\n\n${
        finalPlan || "(plan lane unreachable)"
      }`,
      "final-plan",
    );
  } catch (err) {
    logger.warn({ err, roomId }, "zeus-plan: loop error");
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
export interface ZeusPlanResult {
  roomId: string;
  roomName: string;
  title: string;
  brief: string;
}

/**
 * Create + seed the planning room with Zeus as the planner, then start the
 * bounded Zeus↔Brainstorm loop in the background. Returns as soon as the room
 * is seeded so the UI can poll room messages for the final plan.
 */
export async function kickoffZeusPlan(
  db: Db,
  opts: {
    companyId: string;
    userActorId: string | null;
    createdBy?: string | null;
    title: string;
    brief: string;
  },
): Promise<ZeusPlanResult> {
  const svc = roomService(db);

  const title = opts.title?.slice(0, 80) || "Zeus Plan";
  const brief = opts.brief?.trim() || title;

  const roomName = `Zeus Plan · ${title}`;
  const room = await svc.create(opts.companyId, {
    name: roomName,
    description: "Live Zeus <-> Brainstorm planning loop",
    type: "mission",
    status: "active",
    createdBy: opts.createdBy ?? null,
  });

  // Best-effort agent membership.
  await tryAddAgentMember(db, svc, room.id, "zeus");
  await tryAddAgentMember(db, svc, room.id, "brainstorm");

  // Seed the room with the brief.
  await postTurn(
    svc,
    opts.companyId,
    room.id,
    "zeus",
    `PROJECT BRIEF — ${title}\n\n${brief}\n\nBrainstorm, I'll draft the initial plan, then you critique it.`,
    "plan-brief",
  );

  // Fire-and-forget the bounded loop.
  void runLoop(db, opts.companyId, room.id, brief).catch((err) =>
    logger.warn({ err, roomId: room.id }, "zeus-plan: runLoop rejected"),
  );

  return {
    roomId: room.id,
    roomName,
    title,
    brief,
  };
}

// --- Changes-Requested / Revision re-entry -----------------------------------

export interface ReplanResult {
  roomId: string;
  roomName: string;
  title: string;
  brief: string;
}

/**
 * Re-enter the Zeus-Brainstorm planning loop with a revision context.
 * Called when an approval is rejected with changes_requested:
 * creates a fresh planning room seeded with the decisionNote as the
 * re-planning directive, so Zeus and Brainstorm iterate on the
 * revision.
 */
export async function replanFromRevision(
  db: Db,
  opts: {
    companyId: string;
    userActorId: string | null;
    createdBy?: string | null;
    title: string;
    decisionNote: string;
    issueId: string | null;
    issueIds: string[];
  },
): Promise<ReplanResult> {
  const svc = roomService(db);

  const title = opts.title?.slice(0, 80) || "Revision Plan";
  const note = opts.decisionNote?.trim() || "Revision requested";

  const roomName = "Revision - " + title;
  const room = await svc.create(opts.companyId, {
    name: roomName,
    description: "Re-plan after changes_requested: " + note.slice(0, 120),
    type: "mission",
    status: "active",
    createdBy: opts.createdBy ?? null,
  });

  // Best-effort agent membership.
  await tryAddAgentMember(db, svc, room.id, "zeus");
  await tryAddAgentMember(db, svc, room.id, "brainstorm");

  // Seed the room with the revision context as the re-planning directive.
  const revisionBrief = [
    "REVISION REQUESTED - " + title,
    "",
    "Tyler requested changes for the following reason:",
    note,
    "",
    opts.issueId
      ? "Linked issue: " + opts.issueId
      : "Linked issues: " + ((opts.issueIds || []).join(", ") || "none"),
    "",
    "Brainstorm, I will revise the plan to address Tyler feedback, then you critique it.",
    "The goal is to produce an updated plan that directly addresses the revision request.",
  ].join("\n");

  await postTurn(
    svc,
    opts.companyId,
    room.id,
    "zeus",
    revisionBrief,
    "revision-brief",
  );

  // Fire-and-forget the bounded loop with the revision note as brief.
  void runLoop(db, opts.companyId, room.id, note).catch((err) =>
    logger.warn({ err, roomId: room.id }, "zeus-plan: replan loop rejected"),
  );

  return {
    roomId: room.id,
    roomName,
    title: opts.title,
    brief: note,
  };
}

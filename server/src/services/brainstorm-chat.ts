/**
 * Brainstorm Chat prompt builder for Book Studio's live Calliope lane.
 *
 * Runtime execution belongs exclusively to Calliope. This module only builds
 * the story-bible brief that Paperclip sends through the agent-lane contract.
 */

export interface BibleContext {
  bookTitle: string;
  characters: Array<{ name: string; role: string; description: string }>;
  locations: Array<{ name: string; description: string }>;
  styles: Array<{ pov: string; tense: string; comps: string; sampleParagraph: string }>;
  outlines: Array<{ chapterNumber: number; title: string; beats: Record<string, unknown>[] }>;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface BrainstormChatRow {
  id: string;
  turnId: string | null;
  role: string;
  content: string;
  status: string;
  via: string | null;
  delegationId: string | null;
  error: string | null;
  retryable?: boolean;
  actionResult?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface BrainstormTurnDto {
  turnId: string;
  userMessage: string;
  reply: string;
  userMessageId: string;
  messageId: string;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  via?: "calliope";
  delegationId?: string;
  error?: string;
  retryable?: boolean;
  action?: Record<string, unknown>;
}

/** Pair chronological active rows into the durable turn contract used by the UI. */
export function normalizeBrainstormTurns(rows: BrainstormChatRow[]): BrainstormTurnDto[] {
  type MutableTurn = BrainstormTurnDto & { order: number };
  const turns: MutableTurn[] = [];
  const byTurnId = new Map<string, MutableTurn>();
  let openLegacy: MutableTurn | null = null;

  const createTurn = (turnId: string, row: BrainstormChatRow, order: number): MutableTurn => {
    const turn: MutableTurn = {
      turnId,
      userMessage: "",
      reply: "",
      userMessageId: "",
      messageId: "",
      createdAt: row.createdAt.toISOString(),
      status: "pending",
      order,
    };
    turns.push(turn);
    return turn;
  };

  rows.forEach((row, order) => {
    const content = row.content.trim();
    if (!content) return;

    let turn: MutableTurn;
    if (row.turnId) {
      turn = byTurnId.get(row.turnId) ?? createTurn(row.turnId, row, order);
      byTurnId.set(row.turnId, turn);
    } else if (row.role === "user") {
      turn = createTurn(`legacy:${row.id}`, row, order);
      openLegacy = turn;
    } else {
      if (!openLegacy || openLegacy.reply) return;
      turn = openLegacy;
      openLegacy = null;
    }

    if (row.role === "user") {
      turn.userMessage = content;
      turn.userMessageId = row.id;
      turn.createdAt = row.createdAt.toISOString();
      turn.status = row.status === "failed" ? "failed" : row.status === "completed" ? "completed" : "pending";
      if (turn.reply) turn.status = "completed";
      if (row.error) turn.error = row.error;
      turn.retryable = row.retryable !== false;
      if (row.actionResult) turn.action = row.actionResult;
      if (row.via === "calliope") turn.via = "calliope";
      if (row.delegationId) turn.delegationId = row.delegationId;
    } else if (row.role === "assistant") {
      turn.reply = content;
      turn.messageId = row.id;
      turn.status = "completed";
      if (row.via === "calliope") turn.via = "calliope";
      if (row.delegationId) turn.delegationId = row.delegationId;
    }
  });

  return turns
    .filter((turn) => turn.userMessage.length > 0)
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...turn }) => turn);
}

// Exported so the route can hand the live Calliope agent a complete bible brief.
export function buildSystemPrompt(context: BibleContext): string {
  const parts: string[] = [
    `You are a creative brainstorming partner for a book titled "${context.bookTitle}".`,
    "You help the author develop characters, world-building, writing style, and plot structure.",
    "You have access to the full story bible for this book and should use it to inform your responses.",
    "Be thoughtful, constructive, and creative. Ask clarifying questions when needed.",
    "Keep responses focused on the book and its development.\n",
  ];

  if (context.characters.length > 0) {
    parts.push("--- CHARACTERS ---");
    for (const c of context.characters) {
      parts.push(`- ${c.name} (${c.role}): ${c.description}`);
    }
    parts.push("");
  }

  if (context.locations.length > 0) {
    parts.push("--- WORLD LOCATIONS ---");
    for (const l of context.locations) {
      parts.push(`- ${l.name}: ${l.description}`);
    }
    parts.push("");
  }

  if (context.styles.length > 0) {
    parts.push("--- STYLE ---");
    for (const s of context.styles) {
      const details = [`POV: ${s.pov}`, `Tense: ${s.tense}`, `Comparables: ${s.comps}`].join(", ");
      parts.push(`- ${details}`);
      if (s.sampleParagraph) {
        parts.push(`  Sample: "${s.sampleParagraph.slice(0, 300)}"`);
      }
    }
    parts.push("");
  }

  if (context.outlines.length > 0) {
    parts.push("--- OUTLINE ---");
    for (const o of context.outlines) {
      const beatCount = Array.isArray(o.beats) ? o.beats.length : 0;
      parts.push(`- Chapter ${o.chapterNumber}: "${o.title}" (${beatCount} beats)`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

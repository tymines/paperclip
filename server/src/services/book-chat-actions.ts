import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { books, storyBibleCharacters, storyBibleOutline, storyBibleStyle, storyBibleWorldLocations } from "@paperclipai/db";
import { logActivity } from "./index.js";

type TargetSnapshot = { id: string; name?: string; chapterNumber?: number; pov?: string; tense?: string; locked: boolean; updatedAt?: string | null };

export type BookChatAuthorization =
  | { operation: "overview.set" | "overview.append"; destination: "overview"; content: string; humanMessage: string; target?: TargetSnapshot }
  | { operation: "character.create" | "character.update"; destination: "characters"; name: string; content: string; humanMessage: string; target?: TargetSnapshot }
  | { operation: "location.create" | "location.update"; destination: "world-locations"; name: string; content: string; humanMessage: string; target?: TargetSnapshot }
  | { operation: "style.create" | "style.update"; destination: "style"; fields: { pov: string; tense: string; comps: string; sampleParagraph: string }; humanMessage: string; target?: TargetSnapshot }
  | { operation: "outline.add-beat" | "outline.update-beat"; destination: "outline"; chapterNumber: number; beatNumber?: number; content: string; humanMessage: string; target?: TargetSnapshot };

export interface BookChatActionResult {
  [key: string]: unknown;
  operation: BookChatAuthorization["operation"];
  section: "overview" | "characters" | "world-locations" | "style" | "outline";
  destination: string;
  status: "applied" | "failed";
  entityId?: string;
  chapterNumber?: number;
  error?: string;
}

const clean = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);
const containsExtraAction = (value: string) => /(?:^|[.;]\s*|\band\s+)(?:add|append|create|delete|rename|set|update)\s+(?:a\s+|an\s+|the\s+)?(?:book|character|location|outline|overview|premise|style)\b/i.test(value);

/**
 * Strict, fail-closed authorization grammar. The exact latest human message
 * must name the operation, destination, and content; generic assent never
 * produces an authorization.
 */
export function deriveBookChatAuthorization(message: string): BookChatAuthorization | null {
  const exact = message.trim();
  if (!exact || exact.length > 20_000) return null;

  const overview = /^(set|append)\s+(?:the\s+)?(?:overview|description|premise)\s*(?::|\bto\b)\s*([\s\S]+)$/i.exec(exact);
  if (overview) {
    const content = overview[2].trim();
    if (!content || containsExtraAction(content)) return null;
    return { operation: overview[1].toLowerCase() === "set" ? "overview.set" : "overview.append", destination: "overview", content, humanMessage: exact };
  }

  const named = /^(?:add|create|update)\s+(?:a\s+)?(character|location)(?:\s+named)?\s+([^:\n]{1,200})\s*:\s*([\s\S]+)$/i.exec(exact);
  if (named) {
    const verb = named[0].split(/\s+/, 1)[0].toLowerCase();
    const kind = named[1].toLowerCase();
    const name = clean(named[2], 200);
    const content = named[3].trim();
    if (!name || !content || containsExtraAction(content)) return null;
    const mode = verb === "update" ? "update" : "create";
    return kind === "character"
      ? { operation: `character.${mode}`, destination: "characters", name, content, humanMessage: exact }
      : { operation: `location.${mode}`, destination: "world-locations", name, content, humanMessage: exact };
  }

  const style = /^(add|create|update)\s+(?:a\s+)?style(?:\s+entry)?\s*:\s*pov=([^;\n]+);\s*tense=([^;\n]+);\s*comps=([^;\n]+);\s*sample=([\s\S]+)$/i.exec(exact);
  if (style) {
    const fields = { pov: clean(style[2], 100), tense: clean(style[3], 100), comps: clean(style[4], 500), sampleParagraph: style[5].trim().slice(0, 20_000) };
    if (Object.values(fields).some((value) => !value) || containsExtraAction(fields.sampleParagraph)) return null;
    return { operation: style[1].toLowerCase() === "update" ? "style.update" : "style.create", destination: "style", fields, humanMessage: exact };
  }

  const outline = /^add\s+(?:an\s+)?outline\s+beat\s+to\s+chapter\s+(\d{1,4})\s*:\s*([\s\S]+)$/i.exec(exact);
  if (outline) {
    const chapterNumber = Number(outline[1]);
    const content = outline[2].trim();
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1 || !content || containsExtraAction(content)) return null;
    return { operation: "outline.add-beat", destination: "outline", chapterNumber, content, humanMessage: exact };
  }

  const outlineUpdate = /^update\s+(?:the\s+)?outline\s+beat\s+(\d{1,4})\s+(?:in|for)\s+chapter\s+(\d{1,4})\s*:\s*([\s\S]+)$/i.exec(exact);
  if (outlineUpdate) {
    const beatNumber = Number(outlineUpdate[1]);
    const chapterNumber = Number(outlineUpdate[2]);
    const content = outlineUpdate[3].trim();
    if (![beatNumber, chapterNumber].every((value) => Number.isSafeInteger(value) && value > 0) || !content || containsExtraAction(content)) return null;
    return { operation: "outline.update-beat", destination: "outline", chapterNumber, beatNumber, content, humanMessage: exact };
  }

  return null;
}

export function resolveBookChatAuthorization(
  authorization: BookChatAuthorization | null,
  context: { book: TargetSnapshot; characters: TargetSnapshot[]; locations: TargetSnapshot[]; styles: TargetSnapshot[]; outlines: TargetSnapshot[] },
): BookChatAuthorization | null {
  if (!authorization) return null;
  if (authorization.operation === "overview.set" || authorization.operation === "overview.append") return { ...authorization, target: context.book };
  if (authorization.operation === "character.create" && context.characters.some((item) => item.name?.toLocaleLowerCase() === authorization.name.toLocaleLowerCase())) return null;
  if (authorization.operation === "character.update") {
    const targets = context.characters.filter((item) => item.name?.toLocaleLowerCase() === authorization.name.toLocaleLowerCase());
    return targets.length === 1 ? { ...authorization, target: targets[0] } : null;
  }
  if (authorization.operation === "location.create" && context.locations.some((item) => item.name?.toLocaleLowerCase() === authorization.name.toLocaleLowerCase())) return null;
  if (authorization.operation === "location.update") {
    const targets = context.locations.filter((item) => item.name?.toLocaleLowerCase() === authorization.name.toLocaleLowerCase());
    return targets.length === 1 ? { ...authorization, target: targets[0] } : null;
  }
  if (authorization.operation === "style.create" && context.styles.some((item) => item.pov?.toLocaleLowerCase() === authorization.fields.pov.toLocaleLowerCase() && item.tense?.toLocaleLowerCase() === authorization.fields.tense.toLocaleLowerCase())) return null;
  if (authorization.operation === "style.update") {
    const targets = context.styles.filter((item) => item.pov?.toLocaleLowerCase() === authorization.fields.pov.toLocaleLowerCase() && item.tense?.toLocaleLowerCase() === authorization.fields.tense.toLocaleLowerCase());
    return targets.length === 1 ? { ...authorization, target: targets[0] } : null;
  }
  if (authorization.operation === "outline.add-beat" || authorization.operation === "outline.update-beat") {
    const targets = context.outlines.filter((item) => item.chapterNumber === authorization.chapterNumber);
    return targets.length === 1 ? { ...authorization, target: targets[0] } : null;
  }
  return authorization;
}

function assertSnapshot(current: { id: string; locked: boolean; updatedAt?: Date | null } | undefined, target: TargetSnapshot | undefined, label: string) {
  if (!current || !target || current.id !== target.id) throw new Error(`${label} changed or no longer exists; nothing changed.`);
  if (current.locked || target.locked) throw new Error(`${label} is locked; nothing changed.`);
  const expected = target.updatedAt ?? undefined;
  const actual = current.updatedAt?.toISOString();
  if (expected && actual !== expected) throw new Error(`${label} changed while Calliope was responding; nothing changed.`);
}

export async function applyBookChatAuthorization(db: Db, args: {
  companyId: string;
  bookId: string;
  turnId: string;
  actor: { actorType: "agent" | "user" | "system"; actorId: string; agentId?: string | null; runId?: string | null };
  authorization: BookChatAuthorization;
}): Promise<BookChatActionResult> {
  const { companyId, bookId, turnId, actor, authorization } = args;
  if (actor.actorType !== "user") {
    return { operation: authorization.operation, section: authorization.destination, destination: authorization.destination, status: "failed", error: "Only a current human Book Studio request can authorize a change; nothing changed." };
  }
  try {
    return await db.transaction(async (tx) => {
      const [book] = await tx.select().from(books).where(and(eq(books.id, bookId), eq(books.companyId, companyId))).limit(1);
      if (!book) throw new Error("Book not found; nothing changed.");
      let entityId: string | undefined;
      let destination: string = authorization.destination;

      if (authorization.operation === "overview.set" || authorization.operation === "overview.append") {
        const target = authorization.target;
        if (!target?.updatedAt || target.id !== book.id || book.updatedAt.toISOString() !== target.updatedAt) throw new Error("Book overview changed while Calliope was responding; nothing changed.");
        const current = String((book.metadata as Record<string, unknown>)?.description ?? "");
        const description = authorization.operation === "overview.set" ? authorization.content : [current.trim(), authorization.content].filter(Boolean).join("\n\n");
        const changed = await tx.update(books).set({ metadata: { ...(book.metadata as Record<string, unknown>), description }, updatedAt: new Date() }).where(and(eq(books.id, bookId), eq(books.companyId, companyId), eq(books.updatedAt, new Date(target.updatedAt)))).returning({ id: books.id });
        if (changed.length !== 1) throw new Error("Book overview changed while Calliope was responding; nothing changed.");
        entityId = bookId; destination = "Overview description";
      } else if (authorization.operation === "character.create" || authorization.operation === "character.update") {
        if (authorization.operation === "character.update") {
          const target = authorization.target;
          if (!target) throw new Error(`Character ${authorization.name} could not be identified uniquely; nothing changed.`);
          const [current] = await tx.select().from(storyBibleCharacters).where(and(eq(storyBibleCharacters.id, target.id), eq(storyBibleCharacters.bookId, bookId))).limit(1);
          assertSnapshot(current, target, `Character ${authorization.name}`);
          const changed = await tx.update(storyBibleCharacters).set({ description: authorization.content, updatedAt: new Date() }).where(and(eq(storyBibleCharacters.id, current.id), eq(storyBibleCharacters.bookId, bookId), eq(storyBibleCharacters.locked, false), eq(storyBibleCharacters.updatedAt, new Date(target.updatedAt!)))).returning({ id: storyBibleCharacters.id });
          if (changed.length !== 1) throw new Error(`Character ${authorization.name} changed or was locked; nothing changed.`);
          entityId = current.id;
        } else {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'book-chat:character:' + bookId + ':' + authorization.name.toLocaleLowerCase()}))`);
          const existing = await tx.select().from(storyBibleCharacters).where(and(eq(storyBibleCharacters.bookId, bookId), sql`lower(${storyBibleCharacters.name}) = lower(${authorization.name})`)).limit(1);
          if (existing.length) throw new Error(`Character ${authorization.name} already exists; use an explicit update instruction.`);
          const [created] = await tx.insert(storyBibleCharacters).values({ bookId, name: authorization.name, role: "", description: authorization.content, voiceCard: {}, source: "co_created" }).returning(); entityId = created.id;
        }
        destination = `Character “${authorization.name}”`;
      } else if (authorization.operation === "location.create" || authorization.operation === "location.update") {
        if (authorization.operation === "location.update") {
          const target = authorization.target;
          if (!target) throw new Error(`Location ${authorization.name} could not be identified uniquely; nothing changed.`);
          const [current] = await tx.select().from(storyBibleWorldLocations).where(and(eq(storyBibleWorldLocations.id, target.id), eq(storyBibleWorldLocations.bookId, bookId))).limit(1);
          assertSnapshot(current, target, `Location ${authorization.name}`);
          const changed = await tx.update(storyBibleWorldLocations).set({ description: authorization.content, updatedAt: new Date() }).where(and(eq(storyBibleWorldLocations.id, current.id), eq(storyBibleWorldLocations.bookId, bookId), eq(storyBibleWorldLocations.locked, false), eq(storyBibleWorldLocations.updatedAt, new Date(target.updatedAt!)))).returning({ id: storyBibleWorldLocations.id });
          if (changed.length !== 1) throw new Error(`Location ${authorization.name} changed or was locked; nothing changed.`);
          entityId = current.id;
        } else {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'book-chat:location:' + bookId + ':' + authorization.name.toLocaleLowerCase()}))`);
          const existing = await tx.select().from(storyBibleWorldLocations).where(and(eq(storyBibleWorldLocations.bookId, bookId), sql`lower(${storyBibleWorldLocations.name}) = lower(${authorization.name})`)).limit(1);
          if (existing.length) throw new Error(`Location ${authorization.name} already exists; use an explicit update instruction.`);
          const [created] = await tx.insert(storyBibleWorldLocations).values({ bookId, name: authorization.name, description: authorization.content, rules: {}, sensoryNotes: {}, source: "co_created" }).returning(); entityId = created.id;
        }
        destination = `Location “${authorization.name}”`;
      } else if (authorization.operation === "style.create" || authorization.operation === "style.update") {
        if (authorization.operation === "style.update") {
          const target = authorization.target;
          if (!target) throw new Error(`Style entry ${authorization.fields.pov}/${authorization.fields.tense} could not be identified uniquely; nothing changed.`);
          const [current] = await tx.select().from(storyBibleStyle).where(and(eq(storyBibleStyle.id, target.id), eq(storyBibleStyle.bookId, bookId))).limit(1);
          assertSnapshot(current, target, `Style entry ${authorization.fields.pov}/${authorization.fields.tense}`);
          const changed = await tx.update(storyBibleStyle).set({ ...authorization.fields, updatedAt: new Date() }).where(and(eq(storyBibleStyle.id, current.id), eq(storyBibleStyle.bookId, bookId), eq(storyBibleStyle.locked, false), eq(storyBibleStyle.updatedAt, new Date(target.updatedAt!)))).returning({ id: storyBibleStyle.id });
          if (changed.length !== 1) throw new Error(`Style entry ${authorization.fields.pov}/${authorization.fields.tense} changed or was locked; nothing changed.`);
          entityId = current.id;
        } else {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'book-chat:style:' + bookId + ':' + authorization.fields.pov.toLocaleLowerCase() + ':' + authorization.fields.tense.toLocaleLowerCase()}))`);
          const existing = await tx.select().from(storyBibleStyle).where(and(eq(storyBibleStyle.bookId, bookId), sql`lower(${storyBibleStyle.pov}) = lower(${authorization.fields.pov})`, sql`lower(${storyBibleStyle.tense}) = lower(${authorization.fields.tense})`)).limit(1);
          if (existing.length) throw new Error("That Style entry already exists; use an explicit update instruction.");
          const [created] = await tx.insert(storyBibleStyle).values({ bookId, ...authorization.fields, bannedCliches: [], tropes: [], source: "co_created" }).returning();
          entityId = created.id;
        }
        destination = `Style entry (${authorization.fields.pov}, ${authorization.fields.tense})`;
      } else if (authorization.operation === "outline.add-beat" || authorization.operation === "outline.update-beat") {
        const [current] = authorization.target ? await tx.select().from(storyBibleOutline).where(and(eq(storyBibleOutline.id, authorization.target.id), eq(storyBibleOutline.bookId, bookId))).limit(1) : [];
        assertSnapshot(current, authorization.target, `Outline chapter ${authorization.chapterNumber}`);
        const beats = Array.isArray(current.beats) ? [...current.beats] : [];
        if (authorization.operation === "outline.update-beat") {
          const index = (authorization.beatNumber ?? 0) - 1;
          if (index < 0 || index >= beats.length) throw new Error(`Outline beat ${authorization.beatNumber} in chapter ${authorization.chapterNumber} does not exist; nothing changed.`);
          beats[index] = { ...beats[index], description: authorization.content };
        } else {
          beats.push({ description: authorization.content });
        }
        const changed = await tx.update(storyBibleOutline).set({ beats, updatedAt: new Date() }).where(and(eq(storyBibleOutline.id, current.id), eq(storyBibleOutline.bookId, bookId), eq(storyBibleOutline.locked, false), eq(storyBibleOutline.updatedAt, new Date(authorization.target!.updatedAt!)))).returning({ id: storyBibleOutline.id });
        if (changed.length !== 1) throw new Error(`Outline chapter ${authorization.chapterNumber} changed or was locked; nothing changed.`);
        entityId = current.id; destination = `Outline chapter ${authorization.chapterNumber}`;
      }

      await logActivity(tx as unknown as Db, { companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId ?? null, runId: actor.runId ?? null, action: "book.brainstorm_action_applied", entityType: "book", entityId: bookId, details: { bookId, turnId, operation: authorization.operation, destination, targetEntityId: entityId } });
      return { operation: authorization.operation, section: authorization.destination, destination, status: "applied", entityId, ...(authorization.destination === "outline" ? { chapterNumber: authorization.chapterNumber } : {}) };
    });
  } catch (err) {
    return { operation: authorization.operation, section: authorization.destination, destination: authorization.destination, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

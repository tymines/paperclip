import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  storyBibleCharacters,
  storyBibleWorldLocations,
  storyBibleStyle,
  storyBibleOutline,
  books,
  bibleLore,
  bibleFactions,
  bibleObjects,
  bibleSystems,
  bibleTimelineEvents,
  bibleThreads,
  bibleThemes,
  bibleGlossary,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";
import { isMissingCodexTable } from "../services/book-bible-codex.js";

// ── Context builder ─────────────────────────────────────────────────────────

interface BibleContext {
  characters: { id: string; name: string; role: string; description: string }[];
  locations: { id: string; name: string; description: string }[];
  style: { pov: string; tense: string; comps: string; bannedCliches: string[] }[];
  outline: { chapterNumber: number; title: string; beatsCount: number }[];
  codex: { entityType: string; id: string; name: string; summary: string }[];
}

async function loadBibleContext(
  db: Db,
  bookId: string,
): Promise<BibleContext> {
  const [chars, locs, styles, outlines] = await Promise.all([
    db
      .select({
        id: storyBibleCharacters.id,
        name: storyBibleCharacters.name,
        role: storyBibleCharacters.role,
        description: storyBibleCharacters.description,
      })
      .from(storyBibleCharacters)
      .where(eq(storyBibleCharacters.bookId, bookId)),
    db
      .select({
        id: storyBibleWorldLocations.id,
        name: storyBibleWorldLocations.name,
        description: storyBibleWorldLocations.description,
      })
      .from(storyBibleWorldLocations)
      .where(eq(storyBibleWorldLocations.bookId, bookId)),
    db
      .select({
        pov: storyBibleStyle.pov,
        tense: storyBibleStyle.tense,
        comps: storyBibleStyle.comps,
        bannedCliches: storyBibleStyle.bannedCliches,
      })
      .from(storyBibleStyle)
      .where(eq(storyBibleStyle.bookId, bookId)),
    db
      .select({
        chapterNumber: storyBibleOutline.chapterNumber,
        title: storyBibleOutline.title,
        beatsCount: storyBibleOutline.beats,
      })
      .from(storyBibleOutline)
      .where(eq(storyBibleOutline.bookId, bookId)),
  ]);

  const codexTables = [
    ["lore", bibleLore],
    ["factions", bibleFactions],
    ["objects", bibleObjects],
    ["systems", bibleSystems],
    ["timeline", bibleTimelineEvents],
    ["threads", bibleThreads],
    ["themes", bibleThemes],
    ["glossary", bibleGlossary],
  ] as const;
  const codex = (await Promise.all(codexTables.map(async ([entityType, table]) => {
    try {
      const rows = await db.select({ id: table.id, name: table.name, summary: table.summary })
        .from(table)
        .where(eq(table.bookId, bookId));
      return rows.map((row) => ({ entityType, ...row }));
    } catch (err) {
      if (isMissingCodexTable(err)) return [];
      throw err;
    }
  }))).flat();

  return {
    characters: chars,
    locations: locs,
    style: styles.map((s) => ({
      ...s,
      bannedCliches: Array.isArray(s.bannedCliches) ? s.bannedCliches : [],
    })),
    outline: outlines.map((o) => ({
      ...o,
      beatsCount: Array.isArray(o.beatsCount) ? o.beatsCount.length : 0,
    })),
    codex,
  };
}

function formatContext(ctx: BibleContext): string {
  const parts: string[] = [];

  if (ctx.characters.length > 0) {
    parts.push("CHARACTERS:");
    for (const c of ctx.characters) {
      parts.push(`- [character:${c.id}] ${c.name} (${c.role}): ${c.description}`);
    }
  }

  if (ctx.locations.length > 0) {
    parts.push("LOCATIONS:");
    for (const l of ctx.locations) {
      parts.push(`- [location:${l.id}] ${l.name}: ${l.description}`);
    }
  }

  if (ctx.style.length > 0) {
    parts.push("STYLE NOTES:");
    for (const s of ctx.style) {
      parts.push(
        `- POV: ${s.pov}, Tense: ${s.tense}, Comps: ${s.comps}` +
          (s.bannedCliches.length > 0
            ? `, Banned cliches: ${s.bannedCliches.join(", ")}`
            : ""),
      );
    }
  }

  if (ctx.outline.length > 0) {
    parts.push("OUTLINE:");
    for (const o of ctx.outline) {
      parts.push(`- Ch.${o.chapterNumber}: ${o.title} (${o.beatsCount} beats)`);
    }
  }

  if (ctx.codex.length > 0) {
    parts.push("CODEX ENTITIES (use the bracketed type and ID exactly for relationships):");
    for (const entity of ctx.codex) {
      parts.push(`- [${entity.entityType}:${entity.id}] ${entity.name}: ${entity.summary}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : "(No existing bible entries)";
}

// Normalize Calliope's structured output to match DB column types.
// - voiceCard: string → { description: string }
// - rules/sensoryNotes: array → { "0": item, ... }
// - comps: array → comma-separated string
// - beats: array of strings → [{ description: str }]
function normalizeEntityOutput(
  entityType: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };

  const narrativeText = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(narrativeText).filter(Boolean).join("; ");
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => {
          const label = key
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/^./, (char) => char.toUpperCase());
          const text = narrativeText(nested);
          return text ? `${label}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return String(value);
  };

  const normalizeTextFields = (fields: string[]) => {
    for (const field of fields) {
      if (out[field] !== undefined) out[field] = narrativeText(out[field]);
    }
  };

  if (entityType === "overview") normalizeTextFields(["title", "description"]);
  if (entityType === "character") normalizeTextFields(["name", "role", "description"]);
  if (entityType === "location" || entityType === "world-rule") normalizeTextFields(["name", "description"]);
  if (entityType === "style") normalizeTextFields(["pov", "tense", "sampleParagraph"]);
  if (["lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary"].includes(entityType)) {
    normalizeTextFields(["name", "summary", "term", "definition"]);
  }
  if (entityType === "relationship") normalizeTextFields(["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage"]);
  if (entityType === "fact") normalizeTextFields(["statement"]);

  if (entityType === "character" && typeof out.voiceCard === "string") {
    out.voiceCard = { description: out.voiceCard };
  }
  if (entityType === "location") {
    for (const f of ["rules", "sensoryNotes"] as const) {
      const val = out[f];
      if (typeof val === "string") {
        out[f] = { description: val };
      } else if (Array.isArray(val)) {
        const obj: Record<string, unknown> = {};
        (val as unknown[]).forEach((v, i) => { obj[String(i)] = v; });
        out[f] = obj;
      }
    }
  }
  if (entityType === "style") {
    if (Array.isArray(out.comps)) {
      out.comps = (out.comps as string[]).join(", ");
    }
  }
  if (entityType === "outline-beats" && Array.isArray(out.beats)) {
    const beats = out.beats as unknown[];
    if (beats.length > 0 && typeof beats[0] === "string") {
      out.beats = beats.map((b) => ({ description: b }));
    }
  }

  if (entityType === "relationship") {
    if (!Array.isArray(out.rules)) out.rules = typeof out.rules === "string" ? [out.rules] : [];
    const meter = Number(out.meter);
    out.meter = Number.isFinite(meter) ? Math.max(-100, Math.min(100, meter)) : 0;
  }
  if (entityType === "fact") {
    const knownAsOf = Number(out.knownAsOf);
    out.knownAsOf = Number.isInteger(knownAsOf) && knownAsOf >= 1 ? knownAsOf : 1;
  }
  if (["lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary"].includes(entityType)) {
    if (!out.details || typeof out.details !== "object" || Array.isArray(out.details)) out.details = {};
    if (entityType === "timeline") {
      const chapterNumber = Number(out.chapterNumber);
      out.chapterNumber = Number.isInteger(chapterNumber) && chapterNumber >= 1 ? chapterNumber : null;
    }
    if (entityType === "threads") {
      if (!["open", "paid", "abandoned"].includes(String(out.payoffState))) out.payoffState = "open";
      const payoffChapter = Number(out.payoffChapter);
      out.payoffChapter = Number.isInteger(payoffChapter) && payoffChapter >= 1 ? payoffChapter : null;
    }
  }
  return out;
}

// ── JSON extraction helper ──────────────────────────────────────────────────

function extractJson(text: string): Record<string, unknown> {
  // Try to find a JSON object in the response (handles markdown code fences).
  // Greedy match — a non-greedy one cuts nested objects at the first `}`.
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  const raw = jsonMatch ? jsonMatch[1] : text;

  // Find the first { and last }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw Object.assign(
      new Error("Calliope response does not contain valid JSON"),
      { status: 502 },
    );
  }

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw Object.assign(
      new Error("Calliope response does not contain valid JSON"),
      { status: 502 },
    );
  }
}

// ── Route builder ───────────────────────────────────────────────────────────

export function storyBibleGenerateRoutes(db: Db) {
  const router = Router();

  // ── Shared generate handler ────────────────────────────────────────────────

  function buildGenerateHandler(entityType: string, fields: string[]) {
    return async (req: any, res: any, next: any) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const userPrompt: string | undefined =
          typeof req.body?.prompt === "string" && req.body.prompt.trim()
            ? req.body.prompt.trim()
            : undefined;

        // Verify the book exists
        const book = await db
          .select({ id: books.id, companyId: books.companyId, title: books.title })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);

        if (!book || book.companyId !== companyId) {
          throw Object.assign(new Error("Book not found"), { status: 404 });
        }

        // Load existing bible context
        const ctx = await loadBibleContext(db, bookId);

        // Build system instruction
        const systemInstruction = [
          `You are a creative writing assistant developing a story bible for the book "${book.title}".`,
          `Generate a new ${entityType} entry that fits naturally with the existing bible content.`,
          "Return ONLY valid JSON with no additional text or explanation.",
          "Do NOT include markdown code fences — return raw JSON.",
          "",
          `Required fields: ${fields.map((f) => `"${f}"`).join(", ")}.`,
        ].join("\n");

        // Build user message
        const contextStr = formatContext(ctx);
        const userMessage = [
          `EXISTING BIBLE CONTEXT:\n${contextStr}`,
          userPrompt ? `\nUSER REQUEST: ${userPrompt}` : "",
          `\nGenerate a new ${entityType} entry as JSON with these exact fields: [${fields.join(", ")}].`,
        ].join("\n");

        const actor = getActorInfo(req);
        const lane = await callAgentLane(db, {
          lane: "calliope",
          companyId,
          task: [systemInstruction, "", userMessage].join("\n"),
          metadata: { bookId, operation: `generate-${entityType}` },
          requestedByActorId: actor.actorId,
        });

        // Parse JSON from response
        const parsed = extractJson(lane.text);

        // Normalize Calliope output to match DB schemas.
        const normalized = normalizeEntityOutput(entityType, parsed);

        if (entityType === "relationship") {
          const validRefs = new Set([
            ...ctx.characters.map((entity) => `character:${entity.id}`),
            ...ctx.locations.map((entity) => `location:${entity.id}`),
            ...ctx.codex.map((entity) => `${entity.entityType}:${entity.id}`),
          ]);
          const fromRef = `${String(normalized.fromEntityType)}:${String(normalized.fromEntityId)}`;
          const toRef = `${String(normalized.toEntityType)}:${String(normalized.toEntityId)}`;
          if (!validRefs.has(fromRef) || !validRefs.has(toRef)) {
            throw Object.assign(new Error("Calliope returned a relationship with an unresolved book entity reference"), { status: 502 });
          }
        }

        // Validate required fields
        for (const f of fields) {
          if (normalized[f] === undefined) {
            normalized[f] = "";
          }
        }

        res.json({
          draft: normalized,
          status: "draft",
          entityType,
        });
      } catch (err: any) {
        if (err instanceof AgentLaneUnavailableError) {
          res.status(err.fallbackSafe ? 503 : 502).json({
            error: "Calliope is unavailable. No story-bible draft was generated.",
            via: "none",
            agentLane: err.fallbackSafe ? "unavailable" : "indeterminate",
            agentLaneError: err.message,
          });
          return;
        }
        if (err.status) {
          res.status(err.status).json({
            error: err.message,
            ...(err.status >= 500 ? {} : { details: err.details }),
          });
        } else {
          next(err);
        }
      }
    };
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  // Character
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/overview",
    buildGenerateHandler("overview", ["title", "description"]),
  );

  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/character",
    buildGenerateHandler("character", [
      "name",
      "role",
      "description",
      "voiceCard",
    ]),
  );

  // Location
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/location",
    buildGenerateHandler("location", [
      "name",
      "description",
      "rules",
      "sensoryNotes",
    ]),
  );

  // World rule (uses fields similar to a location's rules sub-object, no dedicated table)
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/world-rule",
    buildGenerateHandler("world-rule", [
      "name",
      "description",
      "rules",
    ]),
  );

  // Style
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/style",
    buildGenerateHandler("style", [
      "pov",
      "tense",
      "comps",
      "sampleParagraph",
      "bannedCliches",
    ]),
  );

  const codexGenerateFields: Record<string, string[]> = {
    lore: ["name", "summary", "details"],
    factions: ["name", "summary", "details"],
    objects: ["name", "summary", "details"],
    systems: ["name", "summary", "details"],
    timeline: ["name", "summary", "details", "chapterNumber"],
    threads: ["name", "summary", "details", "payoffState", "payoffChapter"],
    themes: ["name", "summary", "details"],
    glossary: ["name", "summary", "details", "term", "definition"],
    relationship: ["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage", "meter", "rules"],
    fact: ["statement", "knownAsOf"],
  };
  for (const [entityType, fields] of Object.entries(codexGenerateFields)) {
    router.post(
      `/companies/:companyId/book-studio/books/:bookId/generate/${entityType}`,
      buildGenerateHandler(entityType, fields),
    );
  }

  // Outline beats — dedicated multi-chapter handler (acceptance finding #3:
  // the generic single-entity handler ignored "N chapters" requests and let
  // the model pick arbitrary chapter numbers, e.g. Ch.6 on an empty outline).
  // Returns { draft: { chapters: [{ chapterNumber, title, beats }] } } —
  // numbering is assigned server-side, sequentially after the existing outline.
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/generate/outline-beats",
    async (req: any, res: any, next: any) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const userPrompt: string | undefined =
          typeof req.body?.prompt === "string" && req.body.prompt.trim()
            ? req.body.prompt.trim()
            : undefined;

        const book = await db
          .select({ id: books.id, companyId: books.companyId, title: books.title })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);
        if (!book || book.companyId !== companyId) {
          throw Object.assign(new Error("Book not found"), { status: 404 });
        }

        const ctx = await loadBibleContext(db, bookId);
        const nextNumber =
          ctx.outline.length > 0
            ? Math.max(...ctx.outline.map((o) => o.chapterNumber)) + 1
            : 1;

        const systemInstruction = [
          `You are a creative writing assistant developing the chapter outline for the book "${book.title}".`,
          "Return ONLY valid JSON with no additional text and no markdown code fences, shaped EXACTLY like:",
          `{ "chapters": [ { "chapterNumber": ${nextNumber}, "title": "…", "beats": ["…", "…"] } ] }`,
          "If the user asks for multiple chapters (e.g. \"10 chapters\"), generate ALL of them in one response.",
          "If the user does not specify a count, generate exactly 1 chapter.",
          `Number chapters sequentially starting at ${nextNumber} (the outline already has ${ctx.outline.length} chapter(s)).`,
          "Each chapter gets 4-6 beats; each beat is a short narrative moment (1-2 sentences).",
        ].join("\n");

        const userMessage = [
          `EXISTING BIBLE CONTEXT:\n${formatContext(ctx)}`,
          userPrompt ? `\nUSER REQUEST: ${userPrompt}` : "",
          "\nGenerate the outline chapters as JSON now.",
        ].join("\n");

        const actor = getActorInfo(req);
        const lane = await callAgentLane(db, {
          lane: "calliope",
          companyId,
          task: [systemInstruction, "", userMessage].join("\n"),
          metadata: { bookId, operation: "generate-outline-beats" },
          requestedByActorId: actor.actorId,
        });
        const parsed = extractJson(lane.text);

        // Accept both shapes: { chapters: [...] } or a bare single chapter.
        const rawChapters: Record<string, unknown>[] = Array.isArray(parsed.chapters)
          ? (parsed.chapters as Record<string, unknown>[])
          : [parsed];

        if (rawChapters.length === 0) {
          throw Object.assign(new Error("Calliope returned no chapters"), { status: 502 });
        }

        // Deterministic numbering: sequential after the existing outline —
        // never trust model-picked numbers (mis-numbering was finding #3).
        const chapters = rawChapters.map((ch, i) => {
          const normalized = normalizeEntityOutput("outline-beats", ch);
          return {
            chapterNumber: nextNumber + i,
            title: typeof normalized.title === "string" && normalized.title ? normalized.title : `Chapter ${nextNumber + i}`,
            beats: Array.isArray(normalized.beats) ? normalized.beats : [],
          };
        });

        res.json({
          draft: { chapters },
          status: "draft",
          entityType: "outline-beats",
        });
      } catch (err: any) {
        if (err instanceof AgentLaneUnavailableError) {
          res.status(err.fallbackSafe ? 503 : 502).json({
            error: "Calliope is unavailable. No story-bible draft was generated.",
            via: "none",
            agentLane: err.fallbackSafe ? "unavailable" : "indeterminate",
            agentLaneError: err.message,
          });
          return;
        }
        if (err.status) {
          res.status(err.status).json({
            error: err.message,
            ...(err.status >= 500 ? {} : { details: err.details }),
          });
        } else {
          next(err);
        }
      }
    },
  );

  return router;
}

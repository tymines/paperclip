import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  storyBibleCharacters,
  storyBibleWorldLocations,
  storyBibleStyle,
  storyBibleOutline,
  books,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";

// ── Gemini API lane ─────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey(): string | null {
  return process.env.GOOGLE_API_KEY ?? null;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
    finishReason?: string;
  }[];
}

async function callGemini(
  systemInstruction: string,
  userMessage: string,
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw Object.assign(new Error("Gemini API key not configured"), {
      status: 503,
    });
  }

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        // gemini-2.5-pro is a THINKING model: reasoning tokens count against
        // this budget. 2048 caused silent truncation (broken JSON) on bigger
        // asks like multi-chapter outlines — keep this generous.
        maxOutputTokens: 16384,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Gemini API error (${res.status}): ${body.slice(0, 500)}`),
      { status: 502 },
    );
  }

  const data = (await res.json()) as GeminiResponse;
  const cand = data.candidates?.[0];
  const text =
    cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (!text) {
    throw Object.assign(new Error("Gemini returned an empty response"), {
      status: 502,
    });
  }

  if (cand?.finishReason === "MAX_TOKENS") {
    // Truncated JSON is unusable — surface a clear, actionable error instead
    // of a downstream parse failure.
    throw Object.assign(
      new Error(
        "Generation was cut off by the output limit — try asking for fewer chapters/items at once.",
      ),
      { status: 502 },
    );
  }

  return text;
}

// ── Context builder ─────────────────────────────────────────────────────────

interface BibleContext {
  characters: { name: string; role: string; description: string }[];
  locations: { name: string; description: string }[];
  style: { pov: string; tense: string; comps: string; bannedCliches: string[] }[];
  outline: { chapterNumber: number; title: string; beatsCount: number }[];
}

async function loadBibleContext(
  db: Db,
  bookId: string,
): Promise<BibleContext> {
  const [chars, locs, styles, outlines] = await Promise.all([
    db
      .select({
        name: storyBibleCharacters.name,
        role: storyBibleCharacters.role,
        description: storyBibleCharacters.description,
      })
      .from(storyBibleCharacters)
      .where(eq(storyBibleCharacters.bookId, bookId)),
    db
      .select({
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
  };
}

function formatContext(ctx: BibleContext): string {
  const parts: string[] = [];

  if (ctx.characters.length > 0) {
    parts.push("CHARACTERS:");
    for (const c of ctx.characters) {
      parts.push(`- ${c.name} (${c.role}): ${c.description}`);
    }
  }

  if (ctx.locations.length > 0) {
    parts.push("LOCATIONS:");
    for (const l of ctx.locations) {
      parts.push(`- ${l.name}: ${l.description}`);
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

  return parts.length > 0 ? parts.join("\n") : "(No existing bible entries)";
}

// ponytail: normalize Gemini output to match DB column types
// - voiceCard: string → { description: string }
// - rules/sensoryNotes: array → { "0": item, ... }
// - comps: array → comma-separated string
// - beats: array of strings → [{ description: str }]
function normalizeEntityOutput(
  entityType: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };

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
      new Error("Gemini response does not contain valid JSON"),
      { status: 502 },
    );
  }

  return JSON.parse(raw.slice(start, end + 1));
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
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);

        if (!book) {
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

        // Call Gemini
        const raw = await callGemini(systemInstruction, userMessage);

        // Parse JSON from response
        const parsed = extractJson(raw);

        // Normalize Gemini output to match DB schemas
        const normalized = normalizeEntityOutput(entityType, parsed);

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
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);
        if (!book) {
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

        const raw = await callGemini(systemInstruction, userMessage);
        const parsed = extractJson(raw);

        // Accept both shapes: { chapters: [...] } or a bare single chapter.
        const rawChapters: Record<string, unknown>[] = Array.isArray(parsed.chapters)
          ? (parsed.chapters as Record<string, unknown>[])
          : [parsed];

        if (rawChapters.length === 0) {
          throw Object.assign(new Error("Gemini returned no chapters"), { status: 502 });
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

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, manuscriptChapters, storyBibleCharacters, storyBibleWorldLocations, storyBibleStyle, storyBibleOutline } from "@paperclipai/db";
import { eq, asc } from "drizzle-orm";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";

const TEMP_DIR = process.env.TEMP || "/tmp";
const VAULT_ROOT =
  process.env.BOOK_STUDIO_VAULT_ROOT ||
  "F:\\Augi Vault\\09 - Book Studio\\Books";

function buildMarkdown(title: string, chapters: { chapterNumber: number; title: string | null; content: string }[]): string {
  const lines = [`# ${title}`, ""];
  for (const c of chapters) {
    const heading = c.title ? `## Chapter ${c.chapterNumber}: ${c.title}` : `## Chapter ${c.chapterNumber}`;
    lines.push(heading, "", c.content || "", "");
  }
  return lines.join("\n");
}

export function bookStudioExportRoutes(db: Db) {
  const router = Router();

  // ── 1. Markdown export ──────────────────────────────────────────────────
  // GET /companies/:companyId/book-studio/books/:bookId/export/markdown
  router.get(
    "/companies/:companyId/book-studio/books/:bookId/export/markdown",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params as { companyId: string; bookId: string };
        assertCompanyAccess(req, companyId);

        const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
        if (!book) throw notFound("Book not found");

        const chapters = await db
          .select()
          .from(manuscriptChapters)
          .where(eq(manuscriptChapters.bookId, bookId))
          .orderBy(asc(manuscriptChapters.chapterNumber));

        const md = buildMarkdown(book.title, chapters);

        // ponytail: vault write-through (best-effort)
        try {
          const vaultDir = path.join(VAULT_ROOT, book.slug, "export");
          if (!existsSync(vaultDir)) mkdirSync(vaultDir, { recursive: true });
          writeFileSync(path.join(vaultDir, `${book.slug}.md`), md, "utf-8");
        } catch {
          // vault may be unavailable — continue with download
        }

        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${book.slug}.md"`);
        res.send(md);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── 2. EPUB export ──────────────────────────────────────────────────────
  // POST /companies/:companyId/book-studio/books/:bookId/export/epub
  // ponytail: epub-gen npm not installed; skip until needed
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/export/epub",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);
        res.status(503).json({ error: "EPUB not available — install epub-gen npm package" });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── 3. PDF export ───────────────────────────────────────────────────────
  // POST /companies/:companyId/book-studio/books/:bookId/export/pdf
  // ponytail: shell-out to pandoc; skip if not on PATH
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/export/pdf",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params as { companyId: string; bookId: string };
        assertCompanyAccess(req, companyId);

        // Check pandoc
        let pandocOk = false;
        try {
          execSync("pandoc --version", { stdio: "ignore", timeout: 3000 });
          pandocOk = true;
        } catch {
          // pandoc not found
        }

        if (!pandocOk) {
          res.status(503).json({ error: "install pandoc for PDF export" });
          return;
        }

        const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
        if (!book) throw notFound("Book not found");

        const chapters = await db
          .select()
          .from(manuscriptChapters)
          .where(eq(manuscriptChapters.bookId, bookId))
          .orderBy(asc(manuscriptChapters.chapterNumber));

        const md = buildMarkdown(book.title, chapters);

        // ponytail: temp files — delete after send
        const tmpDir = path.join(TEMP_DIR, "paperclip-exports");
        if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
        const jobId = randomUUID();
        const mdPath = path.join(tmpDir, `${book.slug}-${jobId}.md`);
        const pdfPath = path.join(tmpDir, `${book.slug}-${jobId}.pdf`);
        writeFileSync(mdPath, md, "utf-8");

        try {
          execSync(`pandoc "${mdPath}" -o "${pdfPath}" --pdf-engine=xelatex`, {
            timeout: 60000,
            stdio: "pipe",
          });
        } catch (e: any) {
          res.status(500).json({ error: "PDF generation failed", detail: String(e?.stderr || e?.message || "unknown") });
          return;
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${book.slug}.pdf"`);
        res.sendFile(pdfPath);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── 4. Audiobook TTS ────────────────────────────────────────────────────
  // POST /companies/:companyId/book-studio/books/:bookId/export/audiobook
  // ponytail: shell-out to a script, poll state file
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/export/audiobook",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params as { companyId: string; bookId: string };
        assertCompanyAccess(req, companyId);

        const ttsApiKey = process.env.TTS_API_KEY;
        if (!ttsApiKey) {
          res.status(503).json({ error: "TTS not configured" });
          return;
        }

        const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
        if (!book) throw notFound("Book not found");

        const chapters = await db
          .select()
          .from(manuscriptChapters)
          .where(eq(manuscriptChapters.bookId, bookId))
          .orderBy(asc(manuscriptChapters.chapterNumber));

        const jobId = randomUUID();
        const stateDir = path.join(TEMP_DIR, "paperclip-tts-jobs");
        if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

        // Write chapter list
        const chaptersPath = path.join(stateDir, `${jobId}-chapters.json`);
        writeFileSync(
          chaptersPath,
          JSON.stringify(
            chapters.map((c) => ({
              chapterNumber: c.chapterNumber,
              title: c.title,
              content: c.content,
            })),
          ),
          "utf-8",
        );

        // Write state file
        const statePath = path.join(stateDir, `${jobId}.json`);
        const state = {
          jobId,
          bookId,
          bookTitle: book.title,
          status: "queued",
          chapterCount: chapters.length,
          createdAt: new Date().toISOString(),
        };
        writeFileSync(statePath, JSON.stringify(state), "utf-8");

        // ponytail: fire-and-forget shell-out to external script
        const ttsScript = process.env.TTS_SCRIPT || "paperclip-tts";
        try {
          execSync(`"${ttsScript}" "${jobId}" "${chaptersPath}" "${statePath}"`, {
            stdio: "ignore",
            timeout: 5000,
            env: { ...process.env, TTS_API_KEY: ttsApiKey },
            windowsHide: true,
          });
        } catch {
          // script may not exist — job stays queued
        }

        res.status(202).json(state);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Audiobook job status poll ──────────────────────────────────────────
  // GET /companies/:companyId/book-studio/books/:bookId/export/audiobook/:jobId
  router.get(
    "/companies/:companyId/book-studio/books/:bookId/export/audiobook/:jobId",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);
        const { jobId } = req.params;
        const stateDir = path.join(TEMP_DIR, "paperclip-tts-jobs");
        const statePath = path.join(stateDir, `${jobId}.json`);

        if (!existsSync(statePath)) {
          throw notFound("Job not found");
        }

        const state = JSON.parse(readFileSync(statePath, "utf-8"));
        res.json(state);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Consistency check ──────────────────────────────────────────────────
  // POST /companies/:companyId/book-studio/books/:bookId/check-consistency
  // ponytail: inline Gemini call (~25 lines), no new service file
  const GEMINI_MODEL = "gemini-2.5-pro";
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  router.post(
    "/companies/:companyId/book-studio/books/:bookId/check-consistency",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params as { companyId: string; bookId: string };
        assertCompanyAccess(req, companyId);

        const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
        if (!book) throw notFound("Book not found");

        // Load full bible + manuscript
        const [characters, locations, styles, outlines, chapters] = await Promise.all([
          db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId)),
          db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId)),
          db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId)),
          db.select().from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId)),
          db.select().from(manuscriptChapters).where(eq(manuscriptChapters.bookId, bookId)).orderBy(asc(manuscriptChapters.chapterNumber)),
        ]);

        // Build context for Gemini
        const parts: string[] = [];
        parts.push(`Book: "${book.title}"\n`);

        if (characters.length > 0) {
          parts.push("CHARACTERS:");
          for (const c of characters) parts.push(`- ${c.name} (${c.role}): ${c.description}`);
          parts.push("");
        }
        if (locations.length > 0) {
          parts.push("LOCATIONS:");
          for (const l of locations) parts.push(`- ${l.name}: ${l.description}`);
          parts.push("");
        }
        if (styles.length > 0) {
          parts.push("STYLE:");
          for (const s of styles) parts.push(`- POV: ${s.pov}, Tense: ${s.tense}, Comps: ${s.comps}, Banned: ${(s.bannedCliches || []).join(", ")}`);
          parts.push("");
        }
        if (outlines.length > 0) {
          parts.push("OUTLINE:");
          for (const o of outlines) {
            const bc = Array.isArray(o.beats) ? o.beats.length : 0;
            parts.push(`- Ch.${o.chapterNumber}: ${o.title} (${bc} beats)`);
          }
          parts.push("");
        }
        if (chapters.length > 0) {
          parts.push("MANUSCRIPT:");
          for (const ch of chapters) {
            const preview = (ch.content || "").slice(0, 1500);
            parts.push(`- Chapter ${ch.chapterNumber}${ch.title ? `: ${ch.title}` : ""}: ${preview}`);
          }
          parts.push("");
        }

        const bibleText = parts.join("\n");

        // Call Gemini
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          res.status(503).json({ error: "Gemini API key not configured" });
          return;
        }

        const systemInstruction = [
          "You are a story editor checking a manuscript against its story bible for consistency issues.",
          "Find contradictions, character inconsistencies, world-building rule breaks, style violations, and plot holes.",
          "Return ONLY a valid JSON array of findings. Each finding has: severity (\"info\"|\"warning\"|\"error\"), category (string), description (string), suggestion (string).",
          "If the manuscript is consistent with the bible, return an empty array [].",
          "Do NOT include markdown code fences or any explanation — return raw JSON array.",
        ].join("\n");

        const userMessage = [
          "STORY BIBLE:",
          bibleText,
          "",
          "Check the manuscript for consistency with the story bible. List every issue found.",
        ].join("\n");

        const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const geminiRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: userMessage }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
          }),
        });

        if (!geminiRes.ok) {
          const detail = await geminiRes.text().catch(() => "");
          res.status(502).json({ error: `Gemini API error (${geminiRes.status}): ${detail.slice(0, 300)}` });
          return;
        }

        const data = await geminiRes.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";

        // Parse JSON array from response
        let findings: Record<string, unknown>[] = [];
        try {
          const json = JSON.parse(rawText);
          findings = Array.isArray(json) ? json : [];
        } catch {
          // Try extracting from markdown code fence
          const m = rawText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
          if (m) {
            try { const p = JSON.parse(m[1]); findings = Array.isArray(p) ? p : []; } catch { /* fall through */ }
          }
        }

        // Normalize each finding
        const normalized = findings.map((f: Record<string, unknown>) => ({
          severity: f.severity || "info",
          category: f.category || "General",
          description: f.description || "",
          suggestion: f.suggestion || "",
        }));

        res.json({ findings: normalized, count: normalized.length });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

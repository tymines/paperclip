import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline, bookExports, manuscriptChapters } from "@paperclipai/db";

// Merge outline beats with real manuscript prose. Prose wins when present so the
// export is the BOOK, not the outline; beats are the fallback for undrafted chapters.
async function loadChaptersWithProse(db: any, bookId: string, beatToText: (b: any) => string) {
  const [outline, prose] = await Promise.all([
    db.select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title, beats: storyBibleOutline.beats })
      .from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId)).orderBy(storyBibleOutline.chapterNumber),
    db.select({ chapterNumber: manuscriptChapters.chapterNumber, title: manuscriptChapters.title, content: manuscriptChapters.content })
      .from(manuscriptChapters).where(eq(manuscriptChapters.bookId, bookId)),
  ]);
  const proseByNum = new Map<number, { title: string; content: string }>();
  for (const c of prose) proseByNum.set(c.chapterNumber, { title: c.title, content: c.content });
  // union of chapter numbers (outline drives order; drafted-but-unoutlined chapters appended)
  const nums = new Set<number>([...outline.map((o: any) => o.chapterNumber), ...prose.map((c: any) => c.chapterNumber)]);
  return [...nums].sort((a, b) => a - b).map((n) => {
    const o = outline.find((x: any) => x.chapterNumber === n);
    const pr = proseByNum.get(n);
    const body = (pr && pr.content && pr.content.trim()) ? pr.content : (o && Array.isArray(o.beats) && o.beats.length ? beatToText(o.beats) : "");
    return { chapterNumber: n, title: (pr?.title || o?.title || `Chapter ${n}`), content: body, beats: o?.beats };
  });
}
import { eq, desc } from "drizzle-orm";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { getTTSProvider } from "../services/tts/index.js";
import { elevenlabsProvider } from "../services/tts/elevenlabs.js";
import { getRawKey } from "../services/provider-api-keys/index.js";
import { buildEpubBuffer } from "../services/book-export/epub.js";
import { beatToText } from "../utils/beatToText.js";

const EXPORT_DIR = process.env.BOOK_EXPORT_DIR || path.join(process.env.HOME || "/tmp", "paperclip", "book-exports");

// Runtime detection: pandoc may or may not be on the host PATH. When present we
// prefer it (best-quality EPUB/PDF); otherwise EPUB falls back to the in-process
// builder and PDF returns an honest "install pandoc/LaTeX" error — never a stub.
function pandocAvailable(): boolean {
  try {
    execSync("pandoc --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

type ExportChapter = { chapterNumber: number; title: string; content: string };

// Assemble the DB manuscript (title + per-chapter prose markdown) into one
// markdown document. Prose is the source of truth; loadChaptersWithProse already
// merged outline beats as the fallback for undrafted chapters.
function assembleManuscript(book: { title: string }, chapters: ExportChapter[]): string {
  const mdLines = [`# ${book.title}`, ""];
  for (const ch of chapters) {
    mdLines.push(`## ${ch.title || `Chapter ${ch.chapterNumber}`}`);
    mdLines.push("");
    mdLines.push(ch.content && ch.content.trim() ? ch.content : "*[Chapter content pending]*");
    mdLines.push("");
  }
  return mdLines.join("\n");
}

type ExportGenResult =
  | { ok: true; finalPath: string; ext: string; contentType: string; pandocUsed: boolean; engine: string }
  | { ok: false; error: string };

// Produce the real export file on disk. EPUB: pandoc if present, else a valid
// in-process EPUB (zero deps). PDF: pandoc if present, else an honest error.
// Markdown: written directly.
function generateExportFile(
  format: string,
  opts: { book: { title: string }; chapters: ExportChapter[]; markdown: string; outDir: string; exportId: string },
): ExportGenResult {
  const { book, chapters, markdown, outDir, exportId } = opts;

  if (format === "markdown") {
    const finalPath = path.join(outDir, `${exportId}.md`);
    writeFileSync(finalPath, markdown, "utf-8");
    return { ok: true, finalPath, ext: "md", contentType: "text/markdown; charset=utf-8", pandocUsed: false, engine: "none" };
  }

  if (format === "epub") {
    const epubPath = path.join(outDir, `${exportId}.epub`);
    if (pandocAvailable()) {
      const mdPath = path.join(outDir, `${exportId}.md`);
      writeFileSync(mdPath, markdown, "utf-8");
      try {
        execSync(`pandoc "${mdPath}" -o "${epubPath}" -f markdown -t epub`, { timeout: 60000, stdio: "pipe" });
        try { rmSync(mdPath); } catch { /* best effort */ }
        return { ok: true, finalPath: epubPath, ext: "epub", contentType: "application/epub+zip", pandocUsed: true, engine: "pandoc" };
      } catch {
        try { rmSync(mdPath); } catch { /* best effort */ }
        // fall through to the in-process builder
      }
    }
    const buf = buildEpubBuffer({
      title: book.title,
      chapters: chapters.map((c) => ({
        title: c.title || `Chapter ${c.chapterNumber}`,
        markdown: c.content && c.content.trim() ? c.content : "*[Chapter content pending]*",
      })),
    });
    writeFileSync(epubPath, buf);
    return { ok: true, finalPath: epubPath, ext: "epub", contentType: "application/epub+zip", pandocUsed: false, engine: "in-process" };
  }

  if (format === "pdf") {
    if (!pandocAvailable()) {
      return {
        ok: false,
        error: "PDF export needs pandoc (with a LaTeX or wkhtmltopdf PDF engine) installed on the server. Pandoc was not found on PATH. EPUB and Markdown export work without it.",
      };
    }
    const mdPath = path.join(outDir, `${exportId}.md`);
    writeFileSync(mdPath, markdown, "utf-8");
    const pdfPath = path.join(outDir, `${exportId}.pdf`);
    try {
      execSync(`pandoc "${mdPath}" -o "${pdfPath}" -f markdown`, { timeout: 120000, stdio: "pipe" });
      try { rmSync(mdPath); } catch { /* best effort */ }
      return { ok: true, finalPath: pdfPath, ext: "pdf", contentType: "application/pdf", pandocUsed: true, engine: "pandoc" };
    } catch {
      try { rmSync(mdPath); } catch { /* best effort */ }
      return {
        ok: false,
        error: "PDF export: pandoc is installed but no PDF engine is available. Install a LaTeX distribution (TeX Live / MiKTeX) or wkhtmltopdf on the server. EPUB export works without it.",
      };
    }
  }

  return { ok: false, error: `Unsupported export format: ${format}` };
}

export function bookStudioExportRoutes(db: Db) {
  const router = Router();

  // ── POST .../export ──────────────────────────────────────────────────
  router.post("/companies/:companyId/book-studio/books/:bookId/export", async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);

      const { format } = req.body || {};
      if (!format || !["pdf", "epub"].includes(format)) {
        throw badRequest("format must be 'pdf' or 'epub'");
      }

      const book = await db
        .select({ id: books.id, title: books.title, slug: books.slug })
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (!book) throw notFound("Book not found");

      // Load chapters + assemble the manuscript markdown
      const chapters = await loadChaptersWithProse(db, bookId, beatToText);
      const markdown = assembleManuscript(book, chapters);

      // Write to exports dir
      const outDir = path.join(EXPORT_DIR, book.slug);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const exportId = randomUUID();
      const gen = generateExportFile(format, { book, chapters, markdown, outDir, exportId });
      if (!gen.ok) throw serviceUnavailable(gen.error);

      const metadata: Record<string, unknown> = {
        chapterCount: chapters.length,
        format,
        pandocUsed: gen.pandocUsed,
        engine: gen.engine,
      };

      const [inserted] = await db
        .insert(bookExports)
        .values({
          bookId,
          companyId,
          type: "export",
          format,
          status: "completed",
          outputPath: gen.finalPath,
          metadata,
        })
        .returning();

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "book.exported",
        entityType: "book_export",
        entityId: inserted.id,
        details: { bookId, format, pandocUsed: gen.pandocUsed, engine: gen.engine, chapterCount: chapters.length },
      });

      res.status(201).json({ export: inserted });
    } catch (err) {
      next(err);
    }
  });

  // ── GET .../export/:format (generate + stream download) ──────────────
  // Single-shot: assemble the manuscript, produce the real file, record a
  // bookExports row, and stream it back as a download. Used by the export
  // modal's Markdown / EPUB / PDF buttons. PDF returns an honest 503 naming
  // the missing tool when pandoc / a PDF engine is absent (never a stub).
  router.get("/companies/:companyId/book-studio/books/:bookId/export/:format", async (req, res, next) => {
    try {
      const { companyId, bookId, format } = req.params;
      assertCompanyAccess(req, companyId);

      if (!["markdown", "epub", "pdf"].includes(format)) {
        throw badRequest("format must be 'markdown', 'epub' or 'pdf'");
      }

      const book = await db
        .select({ id: books.id, title: books.title, slug: books.slug })
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);
      if (!book) throw notFound("Book not found");

      const chapters = await loadChaptersWithProse(db, bookId, beatToText);
      const markdown = assembleManuscript(book, chapters);

      const outDir = path.join(EXPORT_DIR, book.slug);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const exportId = randomUUID();
      const gen = generateExportFile(format, { book, chapters, markdown, outDir, exportId });
      if (!gen.ok) throw serviceUnavailable(gen.error);

      const [inserted] = await db
        .insert(bookExports)
        .values({
          bookId,
          companyId,
          type: "export",
          format,
          status: "completed",
          outputPath: gen.finalPath,
          metadata: { chapterCount: chapters.length, format, pandocUsed: gen.pandocUsed, engine: gen.engine },
        })
        .returning();

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "book.exported",
        entityType: "book_export",
        entityId: inserted.id,
        details: { bookId, format, pandocUsed: gen.pandocUsed, engine: gen.engine, chapterCount: chapters.length },
      });

      const filename = `${book.slug || "book"}.${gen.ext}`;
      res.setHeader("Content-Type", gen.contentType);
      res.download(gen.finalPath, filename);
    } catch (err) {
      next(err);
    }
  });

  // ── POST .../narrate ────────────────────────────────────────────────
  router.post("/companies/:companyId/book-studio/books/:bookId/narrate", async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);

      // Prefer ElevenLabs whenever its key is present (provider-key store or the
      // ELEVENLABS_API_KEY env fallback) so the audiobook works without also
      // needing TTS_PROVIDER set. Fall back to the env-selected provider otherwise.
      const elevenKey = await getRawKey("elevenlabs");
      const tts = elevenKey ? elevenlabsProvider : getTTSProvider();
      const configured = await tts.isConfigured();
      if (!configured) {
        throw serviceUnavailable(
          "Audiobook needs a voice provider. Set an ElevenLabs API key (provider \"elevenlabs\" in the provider-key store, or the ELEVENLABS_API_KEY env var) on the server.",
        );
      }

      const book = await db
        .select({ id: books.id, title: books.title, slug: books.slug })
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (!book) throw notFound("Book not found");

      const chapters = await loadChaptersWithProse(db, bookId, beatToText);

      const totalChars = chapters.reduce((sum, ch) => {
        const text = ch.content ?? "";
        return sum + text.length + (ch.title?.length || 0);
      }, 0);

      const estimatedCostUsd = Number(((totalChars / 1000) * 0.03).toFixed(4)); // ~$0.03/1K chars
      const estimatedDurationSec = Math.ceil(totalChars / 15); // ~15 chars/sec TTS

      const confirm = req.body?.confirm === true;
      if (!confirm) {
        return res.json({
          estimate: {
            chapters: chapters.length,
            totalChars,
            estimatedCostUsd,
            estimatedDurationSec,
          },
          requiresConfirm: true,
          narration: null,
        });
      }

      // Real ElevenLabs generation
      const exportId = randomUUID();
      const narrationDir = path.join(EXPORT_DIR, book.slug, "narrations", exportId);
      const tempDir = narrationDir + ".tmp";
      mkdirSync(tempDir, { recursive: true });

      // Pre-compute non-empty chapters once for both narration loop and concat building
      const nonEmptyChapters = chapters.filter(ch => {
        const text = ch.content ?? "";
        return text.trim().length > 0;
      });

      const chapterBuffers: Buffer[] = [];
      let totalDurationSec = 0;

      for (const ch of nonEmptyChapters) {
        const chTitle = ch.title || `Chapter ${ch.chapterNumber}`;
        const result = await tts.generateNarration(
          ch.content ?? "",
          chTitle,
        );
        const chPath = path.join(tempDir, `chapter-${ch.chapterNumber}.mp3`);
        writeFileSync(chPath, result.audioBuffer);
        chapterBuffers.push(result.audioBuffer);
      }

      // Concatenate all chapters into combined.mp3 using ffmpeg concat demuxer.
      // Build concat list from chapterNumber so gapped/non-sequential chapters work.
      const concatList = nonEmptyChapters
        .map(ch => `file 'chapter-${ch.chapterNumber}.mp3'`)
        .join("\n");
      writeFileSync(path.join(tempDir, "concat.txt"), concatList);
      const combinedPath = path.join(tempDir, "combined.mp3");
      try {
        execSync(
          `ffmpeg -f concat -safe 0 -i concat.txt -c copy combined.mp3`,
          { cwd: tempDir, stdio: "pipe", timeout: 30000 },
        );
      } catch {
        // Fallback: raw concat if ffmpeg fails
        writeFileSync(combinedPath, Buffer.concat(chapterBuffers));
      }

      // Get actual duration from ffprobe
      try {
        const dur = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 combined.mp3`,
          { cwd: tempDir, stdio: "pipe", timeout: 10000 },
        ).toString().trim();
        totalDurationSec = Math.ceil(parseFloat(dur) || 0);
      } catch { /* use 0 */ }

      // Clean up temp concat file
      try { rmSync(path.join(tempDir, "concat.txt")); } catch {}

      // Finalize: rename temp → final
      if (existsSync(narrationDir)) rmSync(narrationDir, { recursive: true });
      try { execSync(`mv "${tempDir}" "${narrationDir}"`, { stdio: "pipe" }); } catch {
        // fs.renameSync fallback
        const fs = await import("node:fs");
        fs.renameSync(tempDir, narrationDir);
      }

      // Insert narration record as completed
      const [inserted] = await db
        .insert(bookExports)
        .values({
          bookId,
          companyId,
          type: "narration",
          format: "mp3",
          status: "completed",
          outputPath: path.join(narrationDir, "combined.mp3"),
          metadata: {
            chapterCount: chapters.length,
            totalChars,
            estimatedCostUsd,
            totalDurationSec,
            individualChapters: chapters.map(ch => ({
              number: ch.chapterNumber,
              title: ch.title || `Chapter ${ch.chapterNumber}`,
            })),
          },
        })
        .returning();

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "book.narrated",
        entityType: "book_narration",
        entityId: inserted.id,
        details: { bookId, chapterCount: chapters.length, totalChars, estimatedCostUsd, totalDurationSec },
      });

      res.status(201).json({ narration: inserted });
    } catch (err) {
      next(err);
    }
  });

  // ── GET .../narration-audio/:bookSlug/:exportId/:filename ────────────
  router.get("/companies/:companyId/book-studio/narration-audio/:bookSlug/:exportId/:filename", async (req, res, next) => {
    try {
      const { companyId, bookSlug, exportId, filename } = req.params;
      assertCompanyAccess(req, companyId);

      // Directory traversal protection — use path.resolve + startsWith for robust
      // protection against encoded (%2e%2e) and alternative-separator (..\\..) attacks.
      const resolvedPath = path.resolve(EXPORT_DIR, bookSlug, "narrations", exportId, filename);
      const expectedPrefix = path.resolve(EXPORT_DIR, bookSlug, "narrations", exportId);
      if (!resolvedPath.startsWith(expectedPrefix)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const filePath = path.join(EXPORT_DIR, bookSlug, "narrations", exportId, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: "Audio file not found" });
      }

      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === ".mp3" ? "audio/mpeg" : "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.send(readFileSync(filePath));
    } catch (err) {
      next(err);
    }
  });

  // ── GET .../exports ─────────────────────────────────────────────────
  router.get("/companies/:companyId/book-studio/books/:bookId/exports", async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);

      const rows = await db
        .select()
        .from(bookExports)
        .where(eq(bookExports.bookId, bookId))
        .orderBy(desc(bookExports.createdAt));

      res.json({ exports: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

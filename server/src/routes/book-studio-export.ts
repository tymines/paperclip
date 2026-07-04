import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline, bookExports } from "@paperclipai/db";
import { eq, desc } from "drizzle-orm";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { getTTSProvider } from "../services/tts/index.js";
import { beatToText } from "../utils/beatToText.js";

const EXPORT_DIR = process.env.BOOK_EXPORT_DIR || path.join(process.env.HOME || "/tmp", "paperclip", "book-exports");

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

      // Load chapters
      const chapters = await db
        .select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title, beats: storyBibleOutline.beats })
        .from(storyBibleOutline)
        .where(eq(storyBibleOutline.bookId, bookId))
        .orderBy(storyBibleOutline.chapterNumber);

      // Assemble markdown
      const mdLines = [`# ${book.title}`, ""];
      for (const ch of chapters) {
        mdLines.push(`## ${ch.title || `Chapter ${ch.chapterNumber}`}`);
        mdLines.push("");
        if (Array.isArray(ch.beats) && ch.beats.length > 0) {
          mdLines.push(beatToText(ch.beats));
        } else {
          mdLines.push("*[Chapter content pending]*");
        }
        mdLines.push("");
      }
      const markdown = mdLines.join("\n");

      // Write to exports dir
      const outDir = path.join(EXPORT_DIR, book.slug);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const exportId = randomUUID();
      const isPandocFormat = ["pdf", "epub"].includes(format);
      let finalPath: string;
      let pandocUsed = false;

      if (isPandocFormat) {
        // Write temp markdown
        const mdPath = path.join(outDir, `${exportId}.md`);
        writeFileSync(mdPath, markdown, "utf-8");

        try {
          const ext = format === "pdf" ? "pdf" : "epub";
          finalPath = path.join(outDir, `${exportId}.${ext}`);
          execSync(`pandoc "${mdPath}" -o "${finalPath}" -f markdown -t ${ext}`, {
            timeout: 30000,
            stdio: "pipe",
          });
          pandocUsed = true;
          // Clean up temp md
          try { execSync(`rm "${mdPath}"`); } catch {}
        } catch {
          // Pandoc failure: save the markdown as fallback
          finalPath = mdPath;
        }
      } else {
        finalPath = path.join(outDir, `${exportId}.md`);
        writeFileSync(finalPath, markdown, "utf-8");
      }

      const metadata: Record<string, unknown> = {
        chapterCount: chapters.length,
        format,
        pandocUsed,
      };

      const [inserted] = await db
        .insert(bookExports)
        .values({
          bookId,
          companyId,
          type: "export",
          format,
          status: "completed",
          outputPath: finalPath,
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
        details: { bookId, format, pandocUsed, chapterCount: chapters.length },
      });

      res.status(201).json({ export: inserted });
    } catch (err) {
      next(err);
    }
  });

  // ── POST .../narrate ────────────────────────────────────────────────
  router.post("/companies/:companyId/book-studio/books/:bookId/narrate", async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);

      const tts = getTTSProvider();
      const configured = await tts.isConfigured();
      if (!configured) throw serviceUnavailable("TTS is not configured");

      const book = await db
        .select({ id: books.id, title: books.title, slug: books.slug })
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (!book) throw notFound("Book not found");

      const chapters = await db
        .select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title, beats: storyBibleOutline.beats })
        .from(storyBibleOutline)
        .where(eq(storyBibleOutline.bookId, bookId))
        .orderBy(storyBibleOutline.chapterNumber);

      const totalChars = chapters.reduce((sum, ch) => {
        const text = Array.isArray(ch.beats) ? beatToText(ch.beats) : "";
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

      const chapterBuffers: Buffer[] = [];
      let totalDurationSec = 0;

      for (const ch of chapters) {
        const text = Array.isArray(ch.beats) ? beatToText(ch.beats) : "";
        if (!text.trim()) continue;
        const chTitle = ch.title || `Chapter ${ch.chapterNumber}`;
        const result = await tts.generateNarration(text, chTitle);
        const chPath = path.join(tempDir, `chapter-${ch.chapterNumber}.mp3`);
        writeFileSync(chPath, result.audioBuffer);
        chapterBuffers.push(result.audioBuffer);
      }

      // Concatenate all chapters into combined.mp3 using ffmpeg concat demuxer
      const concatList = chapterBuffers.map((_, i) =>
        `file 'chapter-${i + 1}.mp3'`
      ).join("\n");
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

      // Directory traversal protection
      if (filename.includes("..") || filename.includes("/") || bookSlug.includes("..")) {
        throw badRequest("Invalid path");
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

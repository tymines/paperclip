// Book Studio media extension (Fable, 2026-07-12) — covers, chapter illustrations,
// book trailers, and per-chapter narration over the Creative Studio MCP provider layer
// (D1: server-side MCP client). Supersedes the deferred "FAL cover" item and the
// Replicate path in book-studio-image-generate.ts for new work.
//
// Reuses: creative_jobs (book_id/chapter_id/purpose linkage, migration 0150),
// bookExports + the existing narration-audio serving route in book-studio-export.ts.
// Data honesty: unconfigured providers → 503 provider_not_configured; stitch with
// incomplete chunks → 409 with the honest counts. No mock output.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creativeJobs, books, manuscriptChapters, bookExports } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";
import { creativeProviders, providerStatus, type ProviderId, type CreativeMode } from "../services/creative-studio/providers.js";

const execFileAsync = promisify(execFile);

const EXPORT_DIR = process.env.BOOK_EXPORT_DIR
  || path.join(process.env.HOME || "/tmp", "paperclip", "book-exports");

// D3 defaults (Tyler can override per request): OA for images, HF for video/audio.
const DEFAULT_PROVIDER: Record<string, ProviderId> = {
  cover: "openart", illustration: "openart", trailer: "higgsfield", narration: "higgsfield",
};

// ── chapter chunking: split on scene breaks, then cap chunk size ─────────────
const SCENE_BREAK = /\n\s*(?:\*\s*){3,}\n|\n\s*#{1,3}\s+|\n\s*[-—]{3,}\s*\n/g;
const MAX_CHUNK_CHARS = 3500;

export function chunkChapterText(content: string): string[] {
  const scenes = content.split(SCENE_BREAK).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const scene of scenes.length > 0 ? scenes : [content.trim()]) {
    if (scene.length <= MAX_CHUNK_CHARS) { chunks.push(scene); continue; }
    // split long scenes on paragraph boundaries
    let buf = "";
    for (const para of scene.split(/\n\s*\n/)) {
      if (buf.length + para.length + 2 > MAX_CHUNK_CHARS && buf) { chunks.push(buf.trim()); buf = ""; }
      buf += (buf ? "\n\n" : "") + para;
      // hard cap: sentence-split anything still oversized
      while (buf.length > MAX_CHUNK_CHARS) {
        const cut = buf.lastIndexOf(". ", MAX_CHUNK_CHARS);
        const at = cut > MAX_CHUNK_CHARS / 2 ? cut + 1 : MAX_CHUNK_CHARS;
        chunks.push(buf.slice(0, at).trim());
        buf = buf.slice(at).trim();
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks.filter(Boolean);
}

async function getBook(db: Db, companyId: string, bookId: string) {
  const [book] = await db.select().from(books)
    .where(and(eq(books.id, bookId), eq(books.companyId, companyId))).limit(1);
  return book ?? null;
}

function needProvider(provider: ProviderId) {
  const p = creativeProviders()[provider];
  if (!p.configured) {
    const err: any = new Error("provider_not_configured");
    err.status = 503;
    err.hint = (providerStatus() as any)[provider]?.keyedOffHint;
    throw err;
  }
  return p;
}

async function dispatchJob(db: Db, opts: {
  companyId: string; provider: ProviderId; mode: CreativeMode; model: string;
  prompt: string; params: Record<string, unknown>; refs: Array<{ role: string; url: string }>;
  bookId: string; chapterId?: string | null; purpose: string; createdBy: string;
}) {
  const [row] = await db.insert(creativeJobs).values({
    companyId: opts.companyId, provider: opts.provider, mode: opts.mode, model: opts.model,
    prompt: opts.prompt, params: opts.params, refs: opts.refs, status: "pending",
    bookId: opts.bookId, chapterId: opts.chapterId ?? null, purpose: opts.purpose,
    createdBy: opts.createdBy,
  }).returning();
  try {
    const state = await creativeProviders()[opts.provider].generate({
      mode: opts.mode, model: opts.model, prompt: opts.prompt, params: opts.params, refs: opts.refs,
    });
    const [updated] = await db.update(creativeJobs).set({
      providerJobId: state.providerJobId, status: state.status, outputs: state.outputs,
      costCredits: state.costCredits ?? null, error: state.error ?? null, updatedAt: new Date(),
    }).where(eq(creativeJobs.id, row.id)).returning();
    return updated;
  } catch (e: any) {
    const [failed] = await db.update(creativeJobs).set({
      status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date(),
    }).where(eq(creativeJobs.id, row.id)).returning();
    return failed;
  }
}

export function bookMediaRoutes(db: Db) {
  const router = Router();

  // ── GET .../book-media/:bookId/overview ────────────────────────────────
  // Book + cover + chapters with narration status + all media jobs.
  // Also reconciles: newest completed cover job → books.metadata.coverUrl.
  router.get("/companies/:companyId/book-media/:bookId/overview", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });

      const [chapters, jobs] = await Promise.all([
        db.select({
          id: manuscriptChapters.id, chapterNumber: manuscriptChapters.chapterNumber,
          title: manuscriptChapters.title, content: manuscriptChapters.content,
        }).from(manuscriptChapters)
          .where(eq(manuscriptChapters.bookId, book.id))
          .orderBy(asc(manuscriptChapters.chapterNumber)),
        db.select().from(creativeJobs)
          .where(and(eq(creativeJobs.companyId, companyId), eq(creativeJobs.bookId, book.id)))
          .orderBy(desc(creativeJobs.createdAt)),
      ]);

      // reconcile cover slot from the newest completed cover job
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const coverJob = jobs.find((j) => j.purpose === "cover" && j.status === "completed" && j.outputs.length > 0);
      if (coverJob && meta.coverJobId !== coverJob.id) {
        meta.coverUrl = coverJob.outputs[0]!.url;
        meta.coverJobId = coverJob.id;
        await db.update(books).set({ metadata: meta, updatedAt: new Date() }).where(eq(books.id, book.id));
      }

      const chapterSummaries = chapters.map((ch) => {
        const chunks = jobs.filter((j) => j.chapterId === ch.id && j.purpose === "narration-chunk");
        const total = chunks.length;
        const done = chunks.filter((j) => j.status === "completed").length;
        const failed = chunks.filter((j) => j.status === "failed").length;
        return {
          id: ch.id, chapterNumber: ch.chapterNumber, title: ch.title,
          contentChars: ch.content.length,
          narration: total === 0 ? { state: "none" as const }
            : { state: failed > 0 ? "failed" as const : done === total ? "completed" as const : "running" as const,
                chunksDone: done, chunksTotal: total, chunksFailed: failed },
          illustrations: jobs.filter((j) => j.chapterId === ch.id && j.purpose === "illustration"),
        };
      });

      // narration exports (stitched audiobooks) for this book
      const exportsRows = await db.select().from(bookExports)
        .where(and(eq(bookExports.bookId, book.id), eq(bookExports.type, "narration")))
        .orderBy(desc(bookExports.createdAt)).limit(10);

      res.json({
        book: { id: book.id, slug: book.slug, title: book.title, coverUrl: (meta.coverUrl as string) ?? null },
        chapters: chapterSummaries,
        trailerJobs: jobs.filter((j) => j.purpose === "trailer"),
        coverJobs: jobs.filter((j) => j.purpose === "cover"),
        narrationExports: exportsRows,
        providerStatus: providerStatus(),
      });
    } catch (err) { next(err); }
  });

  // ── GET .../book-media/voices — narration voice picker (Higgsfield) ─────
  router.get("/companies/:companyId/book-media/voices", async (req, res, next) => {
    try {
      assertCompanyAccess(req, req.params.companyId as string);
      const hf = creativeProviders().higgsfield;
      if (!hf.configured) return res.status(503).json({ error: "provider_not_configured", hint: providerStatus().higgsfield.keyedOffHint });
      if (!hf.listVoices) return res.json({ voices: [], warning: "voice listing not supported by adapter" });
      res.json({ voices: await hf.listVoices() });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/cover ───────────────────────────────────
  router.post("/companies/:companyId/book-media/:bookId/cover", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const provider = (req.body?.provider as ProviderId) || DEFAULT_PROVIDER.cover!;
      needProvider(provider);
      const model = typeof req.body?.model === "string" ? req.body.model : "nano-banana-pro";
      const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : `Book cover for "${book.title}". Professional publishing-quality cover art, portrait composition, strong focal imagery, space for title typography at the top third. No text.`;
      const actor = (req as any).actor;
      const job = await dispatchJob(db, {
        companyId, provider, mode: "image", model, prompt,
        params: { aspect_ratio: "2:3", ...(req.body?.params ?? {}) }, refs: [],
        bookId: book.id, purpose: "cover", createdBy: actor?.actorId ?? "unknown",
      });
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.cover_generate", entityType: "creative_job", entityId: job.id, details: { bookId: book.id } });
      res.status(job.status === "failed" ? 502 : 201).json({ job });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/illustration ───────────────────────────
  router.post("/companies/:companyId/book-media/:bookId/illustration", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const chapterId = req.body?.chapterId as string | undefined;
      if (!chapterId) return res.status(422).json({ error: "chapterId is required" });
      const [chapter] = await db.select().from(manuscriptChapters)
        .where(and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.bookId, book.id))).limit(1);
      if (!chapter) return res.status(404).json({ error: "chapter not found" });
      const provider = (req.body?.provider as ProviderId) || DEFAULT_PROVIDER.illustration!;
      needProvider(provider);
      const model = typeof req.body?.model === "string" ? req.body.model : "nano-banana-pro";
      const excerpt = chapter.content.slice(0, 800);
      const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : `Interior illustration for the book "${book.title}", chapter ${chapter.chapterNumber} ("${chapter.title}"). Depict the key scene suggested by this excerpt:\n\n${excerpt}\n\nSingle cohesive illustration, no text or captions.`;
      const actor = (req as any).actor;
      const job = await dispatchJob(db, {
        companyId, provider, mode: "image", model, prompt,
        params: { aspect_ratio: "16:9", ...(req.body?.params ?? {}) }, refs: [],
        bookId: book.id, chapterId, purpose: "illustration", createdBy: actor?.actorId ?? "unknown",
      });
      res.status(job.status === "failed" ? 502 : 201).json({ job });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/trailer ────────────────────────────────
  // Premise/blurb + cover/illustrations as references → video job.
  router.post("/companies/:companyId/book-media/:bookId/trailer", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const provider = (req.body?.provider as ProviderId) || DEFAULT_PROVIDER.trailer!;
      needProvider(provider);
      const model = typeof req.body?.model === "string" ? req.body.model : "";
      if (!model) return res.status(422).json({ error: "model is required (pick a video model from /creative-studio/models)" });

      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const premise = typeof req.body?.premise === "string" && req.body.premise.trim()
        ? req.body.premise.trim()
        : String(meta.premise ?? meta.blurb ?? meta.description ?? "");
      const prompt = `Cinematic book trailer for "${book.title}". ${premise ? `Premise: ${premise}. ` : ""}Atmospheric, evocative shots matching the book's tone; build intrigue; end on a title-card-ready closing shot. No on-screen text.`;

      // reference images: cover first, then up to 3 completed illustrations
      const refs: Array<{ role: string; url: string }> = [];
      if (typeof meta.coverUrl === "string") refs.push({ role: "image_references", url: meta.coverUrl });
      const ill = await db.select().from(creativeJobs).where(and(
        eq(creativeJobs.bookId, book.id), eq(creativeJobs.purpose, "illustration"), eq(creativeJobs.status, "completed"),
      )).orderBy(desc(creativeJobs.createdAt)).limit(3);
      for (const j of ill) if (j.outputs[0]) refs.push({ role: "image_references", url: j.outputs[0].url });

      const actor = (req as any).actor;
      const job = await dispatchJob(db, {
        companyId, provider, mode: "video", model, prompt,
        params: req.body?.params ?? {}, refs,
        bookId: book.id, purpose: "trailer", createdBy: actor?.actorId ?? "unknown",
      });
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.trailer_generate", entityType: "creative_job", entityId: job.id, details: { bookId: book.id, refs: refs.length } });
      res.status(job.status === "failed" ? 502 : 201).json({ job });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/narration/:chapterId ───────────────────
  // Chunk the chapter on scene breaks → one generate_audio job per chunk.
  router.post("/companies/:companyId/book-media/:bookId/narration/:chapterId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const [chapter] = await db.select().from(manuscriptChapters)
        .where(and(eq(manuscriptChapters.id, req.params.chapterId as string), eq(manuscriptChapters.bookId, book.id))).limit(1);
      if (!chapter) return res.status(404).json({ error: "chapter not found" });
      if (!chapter.content.trim()) return res.status(422).json({ error: "chapter has no content to narrate" });
      const provider: ProviderId = "higgsfield";
      needProvider(provider);
      const model = typeof req.body?.model === "string" ? req.body.model : "text-to-speech-v2";
      const voiceId = typeof req.body?.voiceId === "string" ? req.body.voiceId : undefined;

      const chunks = chunkChapterText(chapter.content);
      const actor = (req as any).actor;

      // supersede previous narration chunks for this chapter (keep rows, mark params.superseded)
      const prior = await db.select({ id: creativeJobs.id }).from(creativeJobs).where(and(
        eq(creativeJobs.chapterId, chapter.id), eq(creativeJobs.purpose, "narration-chunk"),
      ));
      if (prior.length > 0) {
        await db.update(creativeJobs).set({ purpose: "narration-chunk-superseded", updatedAt: new Date() })
          .where(inArray(creativeJobs.id, prior.map((p) => p.id)));
      }

      const jobs = [];
      for (let i = 0; i < chunks.length; i++) {
        jobs.push(await dispatchJob(db, {
          companyId, provider, mode: "audio", model,
          prompt: chunks[i]!,
          params: { chunkIndex: i, chunkCount: chunks.length, ...(voiceId ? { voice_id: voiceId } : {}), ...(req.body?.params ?? {}) },
          refs: [], bookId: book.id, chapterId: chapter.id, purpose: "narration-chunk",
          createdBy: actor?.actorId ?? "unknown",
        }));
      }
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.chapter_narrate", entityType: "book", entityId: book.id, details: { chapterId: chapter.id, chunks: chunks.length } });
      const failed = jobs.filter((j) => j.status === "failed").length;
      res.status(failed === jobs.length && jobs.length > 0 ? 502 : 201).json({ jobs, chunks: chunks.length, failed });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/narration/stitch ───────────────────────
  // Download completed chunks in chapter order → ffmpeg concat → bookExports row
  // (served by the existing narration-audio route). Falls back to per-chapter
  // files + manifest when ffmpeg is unavailable — honestly flagged, never silent.
  router.post("/companies/:companyId/book-media/:bookId/narration/stitch", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });

      const chapters = await db.select().from(manuscriptChapters)
        .where(eq(manuscriptChapters.bookId, book.id)).orderBy(asc(manuscriptChapters.chapterNumber));
      const chunks = await db.select().from(creativeJobs).where(and(
        eq(creativeJobs.bookId, book.id), eq(creativeJobs.purpose, "narration-chunk"),
      ));

      const byChapter = new Map<string, typeof chunks>();
      for (const c of chunks) {
        if (!c.chapterId) continue;
        (byChapter.get(c.chapterId) ?? byChapter.set(c.chapterId, []).get(c.chapterId)!).push(c);
      }
      const narrated = chapters.filter((ch) => byChapter.has(ch.id));
      if (narrated.length === 0) return res.status(409).json({ error: "no narrated chapters to stitch" });
      const incomplete = narrated.filter((ch) => byChapter.get(ch.id)!.some((c) => c.status !== "completed" || !c.outputs[0]));
      if (incomplete.length > 0) {
        return res.status(409).json({
          error: "narration_incomplete",
          detail: `chapters not fully narrated yet: ${incomplete.map((c) => c.chapterNumber).join(", ")}`,
        });
      }

      const exportId = randomUUID();
      const outDir = path.join(EXPORT_DIR, book.slug, "narrations", exportId);
      await fsp.mkdir(outDir, { recursive: true });

      // download chunks in order → per-chapter files
      const chapterFiles: Array<{ chapterNumber: number; title: string; filename: string }> = [];
      for (const ch of narrated) {
        const ordered = byChapter.get(ch.id)!
          .sort((a, b) => Number((a.params as any)?.chunkIndex ?? 0) - Number((b.params as any)?.chunkIndex ?? 0));
        const buffers: Buffer[] = [];
        for (const c of ordered) {
          const r = await fetch(c.outputs[0]!.url);
          if (!r.ok) return res.status(502).json({ error: "chunk_download_failed", detail: `chapter ${ch.chapterNumber} chunk ${(c.params as any)?.chunkIndex}: HTTP ${r.status}` });
          buffers.push(Buffer.from(await r.arrayBuffer()));
        }
        const filename = `chapter-${ch.chapterNumber}.mp3`;
        await fsp.writeFile(path.join(outDir, filename), Buffer.concat(buffers));
        chapterFiles.push({ chapterNumber: ch.chapterNumber, title: ch.title || `Chapter ${ch.chapterNumber}`, filename });
      }

      // stitch with ffmpeg concat demuxer; manifest-only fallback if unavailable
      let stitched = false;
      let ffmpegError: string | null = null;
      const concatList = chapterFiles.map((f) => `file '${f.filename}'`).join("\n");
      await fsp.writeFile(path.join(outDir, "concat.txt"), concatList);
      try {
        await execFileAsync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "audiobook.mp3"], { cwd: outDir, timeout: 120_000 });
        stitched = true;
      } catch (e: any) {
        ffmpegError = String(e?.message ?? e).slice(0, 200);
      }
      await fsp.rm(path.join(outDir, "concat.txt"), { force: true });
      const manifest = {
        book: { id: book.id, slug: book.slug, title: book.title },
        exportId, stitched, ffmpegError, source: "higgsfield-mcp",
        chapters: chapterFiles,
        combined: stitched ? "audiobook.mp3" : null,
      };
      await fsp.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const [inserted] = await db.insert(bookExports).values({
        bookId: book.id, companyId, type: "narration", format: "mp3",
        status: "completed",
        outputPath: path.join(outDir, stitched ? "audiobook.mp3" : "manifest.json"),
        metadata: {
          exportId, source: "higgsfield-mcp", stitched, ffmpegError,
          chapterCount: chapterFiles.length,
          individualChapters: chapterFiles.map((f) => ({ number: f.chapterNumber, title: f.title, filename: f.filename })),
        },
      }).returning();

      const actor = (req as any).actor;
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.audiobook_stitched", entityType: "book_narration", entityId: inserted.id, details: { bookId: book.id, exportId, stitched, chapters: chapterFiles.length } });

      res.status(201).json({ narration: inserted, exportId, stitched, ffmpegError, files: chapterFiles.map((f) => f.filename).concat(stitched ? ["audiobook.mp3"] : []) });
    } catch (err) { next(err); }
  });

  return router;
}

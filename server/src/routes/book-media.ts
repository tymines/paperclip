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
import { creativeJobs, books, manuscriptChapters, bookExports, storyBibleCharacters } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { creativeProviders, providerStatus, type ProviderId, type CreativeMode } from "../services/creative-studio/providers.js";
import { saveAssetFromUrl, assetUrlPath } from "../services/creative-studio/asset-store.js";

const execFileAsync = promisify(execFile);

const EXPORT_DIR = process.env.BOOK_EXPORT_DIR
  || path.join(process.env.HOME || "/tmp", "paperclip", "book-exports");

// D3 defaults (Tyler can override per request): HF for video/audio. Image
// (cover/illustration) provider is resolved dynamically — see resolveImageProvider.
const DEFAULT_PROVIDER: Record<string, ProviderId> = {
  trailer: "higgsfield", narration: "higgsfield",
};

// ── Image provider selection ─────────────────────────────────────────────────
// Book Media prefers the keyed MCP image providers (OpenArt/Higgsfield) but, when
// those are OAuth-gated/unconfigured, falls back to the Creative Studio REST
// registry's Replicate (Flux) using the configured 'replicate' credential — so
// covers + illustrations work today. Replicate's key lives in the credentials
// vault, so we honor its async checkConfigured() (the sync `configured` getter is
// env-only and would miss a vault-stored key). Only providers that return
// directly-renderable https URLs are auto-selected (OpenArt/Higgsfield/Replicate).
const IMAGE_PROVIDER_PREFERENCE: ProviderId[] = ["openart", "higgsfield", "replicate"];

const IMAGE_PROVIDER_DEFAULT_MODEL: Partial<Record<ProviderId, string>> = {
  openart: "nano-banana-pro",
  higgsfield: "nano-banana-pro",
  // Flux dev — quality/speed balance; resolves within Replicate's wait=30 window.
  replicate: "black-forest-labs/flux-dev",
  // honored only when a caller explicitly requests these (not auto-selected)
  gemini: "imagen-4.0-generate-001",
  openai: "gpt-image-1",
};

async function isImageProviderConfigured(id: ProviderId): Promise<boolean> {
  const p = creativeProviders()[id];
  if (typeof p.checkConfigured === "function") {
    try { return await p.checkConfigured(); } catch { return p.configured; }
  }
  return p.configured;
}

async function resolveImageProvider(
  feature: string,
  explicit?: ProviderId,
): Promise<{ provider: ProviderId; defaultModel: string }> {
  const order = explicit
    ? [explicit, ...IMAGE_PROVIDER_PREFERENCE.filter((p) => p !== explicit)]
    : IMAGE_PROVIDER_PREFERENCE;
  for (const id of order) {
    if (await isImageProviderConfigured(id)) {
      return { provider: id, defaultModel: IMAGE_PROVIDER_DEFAULT_MODEL[id] ?? "" };
    }
  }
  throw serviceUnavailable(
    `${feature} needs an image provider. Configure Replicate (add a 'replicate' key in Settings → Provider Keys, or set REPLICATE_API_TOKEN) to generate with Flux, or key OpenArt/Higgsfield (OAuth pending).`,
  );
}

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

// ── Durable asset persistence (Tyler, 2026-07-12: "the images generated also
// need to save") ─────────────────────────────────────────────────────────────
// Provider output URLs (replicate.delivery etc.) EXPIRE — an applied cover or
// icon that hotlinks one goes broken within hours/days. Any image that gets
// APPLIED (cover / character icon) is downloaded into the local asset store
// and referenced by its permanent app-relative URL. The provider URL is kept
// on the job outputs for provenance.
function extFromUrl(url: string): string {
  const m = url.split("?")[0]?.match(/\.([a-z0-9]{2,5})$/i);
  const ext = (m?.[1] ?? "png").toLowerCase();
  return ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(ext) ? ext : "png";
}

function isLocalAssetUrl(url: unknown): boolean {
  return typeof url === "string" && url.startsWith("/api/");
}

/**
 * Ensure a completed job's primary output is stored locally; returns the
 * permanent app-relative URL, or null if the download failed (e.g. the
 * provider URL already expired) — callers then keep whatever they had.
 * Idempotent via outputs[0].localUrl.
 */
async function persistJobAssetLocally(
  db: Db,
  companyId: string,
  job: { id: string; outputs: Array<Record<string, any>> },
): Promise<string | null> {
  const out = job.outputs?.[0];
  if (!out?.url) return null;
  if (typeof out.localUrl === "string" && out.localUrl) return out.localUrl;
  if (isLocalAssetUrl(out.url)) return out.url as string;
  try {
    const { filename } = await saveAssetFromUrl(out.url as string, extFromUrl(out.url as string));
    const localUrl = assetUrlPath(companyId, filename);
    const newOutputs = [{ ...out, localUrl }, ...job.outputs.slice(1)];
    await db.update(creativeJobs).set({ outputs: newOutputs as any, updatedAt: new Date() })
      .where(eq(creativeJobs.id, job.id));
    job.outputs = newOutputs;
    return localUrl;
  } catch (e) {
    console.warn(`[book-media] asset persist failed for job ${job.id}:`, (e as Error)?.message);
    return null;
  }
}

// Dispatches that died between the insert and the provider call (e.g. a server
// crash mid-dispatch) leave a 'pending' row with no providerJobId — nothing can
// ever complete it, and the panel shows "cover job: pending" forever.
const STALE_DISPATCH_MS = 15 * 60 * 1000;
const STALE_JOB_MS = 24 * 60 * 60 * 1000;

async function getBook(db: Db, companyId: string, bookId: string) {
  const [book] = await db.select().from(books)
    .where(and(eq(books.id, bookId), eq(books.companyId, companyId))).limit(1);
  return book ?? null;
}

function needProvider(provider: ProviderId, feature = "This feature") {
  const p = creativeProviders()[provider];
  if (!p.configured) {
    const status = (providerStatus() as any)[provider];
    const label = status?.label ?? provider;
    const hint = status?.keyedOffHint ?? "";
    throw serviceUnavailable(`${feature} needs ${label}. ${hint}`.trim());
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

      // Fail-out zombie jobs first: (a) dispatches that died before getting a
      // providerJobId (server crash mid-dispatch) can never complete — the
      // eternal "cover job: pending"; (b) anything still pending after 24h.
      const now = Date.now();
      const zombies = jobs.filter(
        (j) => (j.status === "pending" || j.status === "running")
          && ((!j.providerJobId && now - new Date(j.createdAt as any).getTime() > STALE_DISPATCH_MS)
            || now - new Date(j.createdAt as any).getTime() > STALE_JOB_MS),
      );
      for (const j of zombies) {
        const reason = !j.providerJobId
          ? "dispatch interrupted (server restarted mid-dispatch) — regenerate"
          : "stale: no provider result within 24h";
        try {
          await db.update(creativeJobs).set({ status: "failed", error: reason, updatedAt: new Date() })
            .where(eq(creativeJobs.id, j.id));
          j.status = "failed";
          j.error = reason;
        } catch { /* best-effort — retried next tick */ }
      }

      // Reconcile still-running image jobs that carry a providerJobId (Replicate
      // async predictions that exceeded the wait=30 window). The panel refetches
      // this overview on an interval, so this doubles as the poll loop. Best-effort
      // per job — a poll failure leaves the job untouched for the next tick.
      const runningImages = jobs.filter(
        (j) => (j.purpose === "cover" || j.purpose === "illustration")
          && (j.status === "pending" || j.status === "running")
          && j.providerJobId,
      );
      if (runningImages.length > 0) {
        await Promise.all(runningImages.map(async (j) => {
          try {
            const prov = creativeProviders()[j.provider as ProviderId];
            const state = await prov.getJob(j.providerJobId as string, j.mode as CreativeMode);
            if (state.status !== j.status || (state.outputs?.length ?? 0) !== j.outputs.length) {
              await db.update(creativeJobs).set({
                status: state.status, outputs: state.outputs,
                error: state.error ?? null, updatedAt: new Date(),
              }).where(eq(creativeJobs.id, j.id));
              j.status = state.status;
              j.outputs = state.outputs;
              j.error = state.error ?? j.error;
            }
          } catch { /* leave as-is; retried on next poll */ }
        }));
      }

      // Reconcile the cover slot — FILL-ONLY (Tyler, 2026-07-12): a later
      // generation must NEVER silently replace an applied/chosen cover. The
      // reconcile only (a) fills an EMPTY slot from the newest completed cover
      // job (unless locked), and (b) self-heals an existing choice whose URL is
      // still an ephemeral provider URL by re-pointing THE SAME job's image at
      // durable local storage.
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      let metaDirty = false;
      if (!meta.coverUrl && !meta.coverLocked) {
        const coverJob = jobs.find((j) => j.purpose === "cover" && j.status === "completed" && j.outputs.length > 0);
        if (coverJob) {
          const localUrl = await persistJobAssetLocally(db, companyId, coverJob as any);
          meta.coverUrl = localUrl ?? coverJob.outputs[0]!.url;
          meta.coverJobId = coverJob.id;
          metaDirty = true;
        }
      } else if (meta.coverUrl && !isLocalAssetUrl(meta.coverUrl) && meta.coverJobId) {
        const chosen = jobs.find((j) => j.id === meta.coverJobId && j.status === "completed" && j.outputs.length > 0);
        if (chosen) {
          const localUrl = await persistJobAssetLocally(db, companyId, chosen as any);
          if (localUrl) { meta.coverUrl = localUrl; metaDirty = true; }
        }
      }
      if (metaDirty) {
        await db.update(books).set({ metadata: meta, updatedAt: new Date() }).where(eq(books.id, book.id));
      }

      // Reconcile character icons — same FILL-ONLY + self-heal semantics per
      // character (lock: metadata.iconLocked; idempotent via metadata.iconJobId).
      const bibleChars = await db.select().from(storyBibleCharacters)
        .where(eq(storyBibleCharacters.bookId, book.id));
      for (const ch of bibleChars) {
        const chMeta = (ch.metadata ?? {}) as Record<string, unknown>;
        let chDirty = false;
        if (!chMeta.imageUrl && !chMeta.iconLocked) {
          const iconJob = jobs.find((j) => j.purpose === "character-icon"
            && (j.params as any)?.character_id === ch.id
            && j.status === "completed" && j.outputs.length > 0);
          if (iconJob) {
            const localUrl = await persistJobAssetLocally(db, companyId, iconJob as any);
            chMeta.imageUrl = localUrl ?? iconJob.outputs[0]!.url;
            chMeta.iconJobId = iconJob.id;
            chDirty = true;
          }
        } else if (chMeta.imageUrl && !isLocalAssetUrl(chMeta.imageUrl) && chMeta.iconJobId) {
          const chosen = jobs.find((j) => j.id === chMeta.iconJobId && j.status === "completed" && j.outputs.length > 0);
          if (chosen) {
            const localUrl = await persistJobAssetLocally(db, companyId, chosen as any);
            if (localUrl) { chMeta.imageUrl = localUrl; chDirty = true; }
          }
        }
        if (chDirty) {
          (ch as any).metadata = chMeta;
          await db.update(storyBibleCharacters).set({ metadata: chMeta, updatedAt: new Date() })
            .where(eq(storyBibleCharacters.id, ch.id));
        }
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

      // providerStatus() reads Replicate's sync (env-only) `configured` getter;
      // patch it with the vault-aware async check so a vault-stored 'replicate'
      // key is reflected as available for the Book Media image lane.
      const status = providerStatus() as any;
      status.replicate = { ...status.replicate, configured: await isImageProviderConfigured("replicate") };

      res.json({
        book: {
          id: book.id, slug: book.slug, title: book.title,
          coverUrl: (meta.coverUrl as string) ?? null,
          coverLocked: meta.coverLocked === true,
        },
        characters: bibleChars.map((c) => ({
          id: c.id, name: c.name, role: c.role,
          iconUrl: ((c.metadata ?? {}) as any).imageUrl ?? null,
          iconLocked: ((c.metadata ?? {}) as any).iconLocked === true,
        })),
        assets: jobs
          .filter((j) => j.purpose && j.purpose !== "narration-chunk-superseded")
          .map((j) => ({
            id: j.id, purpose: j.purpose, mode: j.mode, status: j.status,
            outputs: j.outputs, prompt: j.prompt, provider: j.provider,
            characterId: (j.params as any)?.character_id ?? null,
            chapterId: j.chapterId, createdAt: j.createdAt,
          })),
        chapters: chapterSummaries,
        trailerJobs: jobs.filter((j) => j.purpose === "trailer"),
        coverJobs: jobs.filter((j) => j.purpose === "cover"),
        narrationExports: exportsRows,
        providerStatus: status,
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
      const explicit = typeof req.body?.provider === "string" ? (req.body.provider as ProviderId) : undefined;
      const { provider, defaultModel } = await resolveImageProvider("Book cover generation", explicit);
      const model = typeof req.body?.model === "string" ? req.body.model : defaultModel;
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

  // ── POST .../book-media/:bookId/character-icon ─────────────────────────
  // Bible per-card Generate-image: completed asset becomes the character avatar
  // (reconciled into storyBibleCharacters.metadata.imageUrl by the overview).
  router.post("/companies/:companyId/book-media/:bookId/character-icon", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const characterId = req.body?.characterId as string | undefined;
      if (!characterId) return res.status(422).json({ error: "characterId is required" });
      const [character] = await db.select().from(storyBibleCharacters)
        .where(and(eq(storyBibleCharacters.id, characterId), eq(storyBibleCharacters.bookId, book.id))).limit(1);
      if (!character) return res.status(404).json({ error: "character not found" });
      const explicit = typeof req.body?.provider === "string" ? (req.body.provider as ProviderId) : undefined;
      const { provider, defaultModel } = await resolveImageProvider("Character icon generation", explicit);
      const model = typeof req.body?.model === "string" ? req.body.model : defaultModel;
      const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : `Character portrait of ${character.name}${character.role ? `, ${character.role}` : ""}${character.description ? `. ${character.description.slice(0, 400)}` : ""}. Square head-and-shoulders portrait, single character, clean simple background, consistent with the tone of "${book.title}". No text.`;
      const actor = (req as any).actor;
      const job = await dispatchJob(db, {
        companyId, provider, mode: "image", model, prompt,
        params: { aspect_ratio: "1:1", character_id: character.id, ...(req.body?.params ?? {}) }, refs: [],
        bookId: book.id, purpose: "character-icon", createdBy: actor?.actorId ?? "unknown",
      });
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.character_icon_generate", entityType: "creative_job", entityId: job.id, details: { bookId: book.id, characterId: character.id } });
      res.status(job.status === "failed" ? 502 : 201).json({ job });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/assets/:jobId/apply ────────────────────
  // Library actions: set-cover / set-character-icon from any completed asset.
  router.post("/companies/:companyId/book-media/:bookId/assets/:jobId/apply", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const [job] = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId), eq(creativeJobs.bookId, book.id))).limit(1);
      if (!job) return res.status(404).json({ error: "asset not found for this book" });
      if (job.status !== "completed" || !job.outputs[0]?.url) return res.status(422).json({ error: "asset has no completed output" });
      const action = req.body?.action;
      const actor = (req as any).actor;
      // Persist to durable local storage FIRST — applied images must survive
      // provider URL expiry ("the images generated also need to save").
      const localUrl = await persistJobAssetLocally(db, companyId, job as any);
      const url = localUrl ?? job.outputs[0]!.url;
      if (action === "set-cover") {
        // Explicit user action — allowed even when locked (lock guards AUTO
        // replacement only). Shallow-merge to preserve other metadata keys.
        const meta = (book.metadata ?? {}) as Record<string, unknown>;
        meta.coverUrl = url;
        meta.coverJobId = job.id;
        await db.update(books).set({ metadata: meta, updatedAt: new Date() }).where(eq(books.id, book.id));
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.cover_set", entityType: "book", entityId: book.id, details: { jobId: job.id, persisted: !!localUrl } });
        return res.json({ applied: "set-cover", coverUrl: url, persisted: !!localUrl });
      }
      if (action === "set-character-icon") {
        const characterId = req.body?.characterId as string | undefined;
        if (!characterId) return res.status(422).json({ error: "characterId is required for set-character-icon" });
        const [character] = await db.select().from(storyBibleCharacters)
          .where(and(eq(storyBibleCharacters.id, characterId), eq(storyBibleCharacters.bookId, book.id))).limit(1);
        if (!character) return res.status(404).json({ error: "character not found" });
        const chMeta = (character.metadata ?? {}) as Record<string, unknown>;
        chMeta.imageUrl = url;
        chMeta.iconJobId = job.id;
        await db.update(storyBibleCharacters).set({ metadata: chMeta, updatedAt: new Date() })
          .where(eq(storyBibleCharacters.id, character.id));
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "book.character_icon_set", entityType: "story_bible_character", entityId: character.id, details: { jobId: job.id, persisted: !!localUrl } });
        return res.json({ applied: "set-character-icon", characterId, iconUrl: url, persisted: !!localUrl });
      }
      return res.status(422).json({ error: "action must be 'set-cover' | 'set-character-icon'" });
    } catch (err) { next(err); }
  });

  // ── POST .../book-media/:bookId/lock ────────────────────────────────────
  // Image locks (Tyler, 2026-07-12): a locked cover/icon is never auto-filled
  // or auto-replaced by the overview reconcile — only explicit set-as-cover /
  // set-as-icon (or unlock) changes it. Consistent with the bible Lock concept.
  // body: { target: "cover" } | { target: "character-icon", characterId }, locked: boolean
  router.post("/companies/:companyId/book-media/:bookId/lock", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const book = await getBook(db, companyId, req.params.bookId as string);
      if (!book) return res.status(404).json({ error: "book not found" });
      const target = req.body?.target;
      const locked = req.body?.locked === true;
      const actor = (req as any).actor;
      if (target === "cover") {
        const meta = (book.metadata ?? {}) as Record<string, unknown>;
        meta.coverLocked = locked;
        await db.update(books).set({ metadata: meta, updatedAt: new Date() }).where(eq(books.id, book.id));
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: locked ? "book.cover_locked" : "book.cover_unlocked", entityType: "book", entityId: book.id, details: {} });
        return res.json({ target: "cover", locked });
      }
      if (target === "character-icon") {
        const characterId = req.body?.characterId as string | undefined;
        if (!characterId) return res.status(422).json({ error: "characterId is required" });
        const [character] = await db.select().from(storyBibleCharacters)
          .where(and(eq(storyBibleCharacters.id, characterId), eq(storyBibleCharacters.bookId, book.id))).limit(1);
        if (!character) return res.status(404).json({ error: "character not found" });
        const chMeta = (character.metadata ?? {}) as Record<string, unknown>;
        chMeta.iconLocked = locked;
        await db.update(storyBibleCharacters).set({ metadata: chMeta, updatedAt: new Date() })
          .where(eq(storyBibleCharacters.id, character.id));
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: locked ? "book.character_icon_locked" : "book.character_icon_unlocked", entityType: "story_bible_character", entityId: character.id, details: {} });
        return res.json({ target: "character-icon", characterId, locked });
      }
      return res.status(422).json({ error: "target must be 'cover' | 'character-icon'" });
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
      const explicit = typeof req.body?.provider === "string" ? (req.body.provider as ProviderId) : undefined;
      const { provider, defaultModel } = await resolveImageProvider("Chapter illustration", explicit);
      const model = typeof req.body?.model === "string" ? req.body.model : defaultModel;
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
      needProvider(provider, "Book trailer generation");
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
      needProvider(provider, "Chapter narration");
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

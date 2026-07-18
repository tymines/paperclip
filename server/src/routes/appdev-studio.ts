/**
 * App Dev Studio routes — Phases 3–6 (packs/tokens, harness/VFG-R/baselines/
 * regions, chat persistence, feedback triage, skills, digest, retro).
 * Complements routes/appdev-control.ts (Phases 1–2). Same guarded/migration-
 * pending degradation contract.
 */
import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appdevApps,
  appdevAssets,
  appdevChatMessages,
  appdevChatThreads,
  appdevFeedbackItems,
  appdevProofBundles,
  appdevReferencePacks,
  appdevRetros,
  appdevScreenBaselines,
  appdevScreens,
  appdevSkills,
  appdevVisualReviews,
  appdevWorkOrders,
} from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "../services/live-events.js";
import {
  AppdevMigrationPendingError,
  GateRefusedError,
  decideGate,
} from "../services/appdev/gatekeeper.js";
import { ProofBundleRejectedError, submitProofBundle } from "../services/appdev/proof-bundles.js";
import { VfgDecorrelationError, VfgModelUnconfiguredError } from "../services/appdev/visual-review.js";
import { extractStyleTokens, loadUploadAsB64 } from "../services/appdev/style-tokens.js";
import { runWebHarness } from "../services/appdev/screenshot-harness.js";
import { diffImages, loadAssetPng, selectBaseline, type Region } from "../services/appdev/visual-diff.js";
import { autoDraftFromFeedback, ingestFeedback, normalizeSentry } from "../services/appdev/feedback-triage.js";
import { postDigest } from "../services/appdev/digest.js";
import {
  DesignModelUnconfiguredError,
  streamDesignReply,
} from "../services/app-dev/design-chat.js";

type Handler = (req: import("express").Request, res: import("express").Response) => Promise<void>;

function guarded(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "42P01" || err instanceof AppdevMigrationPendingError) {
        res.status(req.method === "GET" ? 200 : 409).json({
          migrationPending: true,
          migrations: ["0146_appdev_control_center.sql", "0151_appdev_studio_p36.sql"],
        });
        return;
      }
      if (err instanceof GateRefusedError || err instanceof ProofBundleRejectedError) {
        res.status(422).json({ error: err.message, ...err.details });
        return;
      }
      if (err instanceof VfgModelUnconfiguredError || err instanceof VfgDecorrelationError || err instanceof DesignModelUnconfiguredError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }
  };
}

export function appdevStudioRoutes(db: Db) {
  const router = Router();
  const base = "/companies/:companyId/appdev";

  /* ═══ Phase 3 — reference packs + style tokens ═══════════════════════ */

  router.get(
    `${base}/apps/:appId/reference-packs`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const packs = await db
        .select()
        .from(appdevReferencePacks)
        .where(eq(appdevReferencePacks.appId, req.params.appId as string))
        .orderBy(desc(appdevReferencePacks.createdAt));
      res.json({ referencePacks: packs });
    }),
  );

  // Style-token extraction job. Packs are immutable once approved: extraction
  // is allowed only while style_tokens is null and the pack is unapproved.
  router.post(
    `${base}/reference-packs/:packId/extract-style-tokens`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [pack] = await db
        .select()
        .from(appdevReferencePacks)
        .where(and(eq(appdevReferencePacks.id, req.params.packId as string), eq(appdevReferencePacks.companyId, companyId)))
        .limit(1);
      if (!pack) {
        res.status(404).json({ error: "pack not found" });
        return;
      }
      if (pack.approvedBy || (pack.styleTokens && Object.keys(pack.styleTokens).length)) {
        res.status(422).json({ error: "pack is approved or already has tokens — packs are immutable; supersede instead" });
        return;
      }
      // Gather images: asset items with storage paths.
      const b64s: string[] = [];
      for (const item of pack.items ?? []) {
        const assetId = (item as Record<string, unknown>).asset_id;
        if (typeof assetId !== "string") continue;
        const [asset] = await db.select().from(appdevAssets).where(eq(appdevAssets.id, assetId)).limit(1);
        if (asset?.storagePath && asset.mime === "image/png") {
          try {
            b64s.push(await loadUploadAsB64(asset.storagePath));
          } catch (e) {
            logger.warn({ e, assetId }, "token extraction: unreadable asset skipped");
          }
        }
      }
      if (Array.isArray(req.body?.imagesB64)) b64s.push(...req.body.imagesB64.slice(0, 4));
      const result = await extractStyleTokens({ imagesB64: b64s });
      await db
        .update(appdevReferencePacks)
        .set({ styleTokens: result.tokens as unknown as Record<string, unknown> })
        .where(eq(appdevReferencePacks.id, pack.id));
      res.json({ styleTokens: result.tokens, model: result.model });
    }),
  );

  /* ═══ Phase 4 — harness, VFG-R, baselines, regions ═══════════════════ */

  // Run the web screenshot harness against a running instance and submit the
  // screenshot_set proof bundle in one action (self_check comes from caller).
  router.post(
    `${base}/apps/:appId/harness/run`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      const appId = req.params.appId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const baseUrl = String(req.body?.baseUrl ?? "").trim();
      if (!/^https?:\/\//.test(baseUrl)) {
        res.status(400).json({ error: "baseUrl (http/https) required — the app's running dev/staging URL" });
        return;
      }
      const run = await runWebHarness(db, { companyId, appId, baseUrl });
      let bundleId: string | null = null;
      if (run.ok && req.body?.workOrderId) {
        const bundle = await submitProofBundle(db, {
          companyId,
          appId,
          workOrderId: String(req.body.workOrderId),
          kind: "screenshot_set",
          payload: { harness: "playwright-web", raw_log: run.rawLog, shots: run.shots },
          screenshotAssetIds: run.shots.map((s) => s.assetId),
          screenshotsByTag: run.screenshotsByTag,
          selfCheck: req.body?.selfCheck,
          submittedBy: actor.actorId,
        });
        bundleId = bundle?.id ?? null;
      }
      res.status(run.ok ? 201 : 422).json({ ...run, bundleId });
    }),
  );

  // VFG-R: deterministic regression diff of a screenshot_set bundle against
  // per-screen baselines (regions + modes + merge-base selection).
  router.post(
    `${base}/work-orders/:woId/vfg-r`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [wo] = await db
        .select()
        .from(appdevWorkOrders)
        .where(and(eq(appdevWorkOrders.id, req.params.woId as string), eq(appdevWorkOrders.companyId, companyId)))
        .limit(1);
      if (!wo) {
        res.status(404).json({ error: "work order not found" });
        return;
      }
      const [bundle] = await db
        .select()
        .from(appdevProofBundles)
        .where(and(eq(appdevProofBundles.workOrderId, wo.id), eq(appdevProofBundles.kind, "screenshot_set")))
        .orderBy(desc(appdevProofBundles.createdAt))
        .limit(1);
      const byTag = (bundle?.payload as { screenshots_by_tag?: Record<string, string> } | null)?.screenshots_by_tag;
      if (!bundle || !byTag) {
        res.status(422).json({ error: "no screenshot_set bundle with screenshots_by_tag on this work order" });
        return;
      }
      const declared: string[] = Array.isArray(req.body?.declaredScreenTags) ? req.body.declaredScreenTags : [];
      const screens = await db.select().from(appdevScreens).where(eq(appdevScreens.appId, wo.appId));

      const perScreen: Record<string, Record<string, unknown>> = {};
      let regressionFail = false;
      for (const screen of screens) {
        const shotAssetId = byTag[screen.screenTag];
        if (!shotAssetId) continue;
        const baseline = await selectBaseline(db, screen, { branchPointSha: wo.branchPointSha, createdAt: wo.createdAt });
        if (!baseline.assetId) {
          perScreen[screen.screenTag] = { skipped: true, reason: "no baseline yet", rule: baseline.rule };
          continue;
        }
        const [shotAsset] = await db.select().from(appdevAssets).where(eq(appdevAssets.id, shotAssetId)).limit(1);
        const [baseAsset] = await db.select().from(appdevAssets).where(eq(appdevAssets.id, baseline.assetId)).limit(1);
        if (!shotAsset || !baseAsset) {
          perScreen[screen.screenTag] = { skipped: true, reason: "asset row missing" };
          continue;
        }
        try {
          const diff = diffImages(
            await loadAssetPng(baseAsset.storagePath),
            await loadAssetPng(shotAsset.storagePath),
            screen.comparisonMode,
            (screen.regions ?? []) as unknown as Region[],
          );
          const isDeclared = declared.includes(screen.screenTag);
          // Spec 4.6: undeclared-screen regression above threshold = automatic
          // fail; declared-screen diffs are informational (side-by-side at review).
          const fails = diff.exceedsThreshold && !isDeclared;
          if (fails) regressionFail = true;
          perScreen[screen.screenTag] = { ...diff, declared: isDeclared, baseline_rule: baseline.rule, fails };
        } catch (e) {
          perScreen[screen.screenTag] = { skipped: true, reason: String((e as Error).message).slice(0, 200) };
        }
      }

      const [review] = await db
        .insert(appdevVisualReviews)
        .values({
          companyId,
          appId: wo.appId,
          workOrderId: wo.id,
          proofBundleId: bundle.id,
          reviewerLane: "vfg-r-diff",
          reviewerModel: "deterministic-perceptual-diff",
          rubricScores: perScreen,
          verdict: regressionFail ? "fail" : "pass",
          worstScreen:
            Object.entries(perScreen)
              .filter(([, v]) => (v as { fails?: boolean }).fails)
              .map(([k]) => k)[0] ?? null,
          summary: regressionFail
            ? "Undeclared-screen regression above threshold — you broke a screen you weren't working on."
            : "No undeclared regressions above threshold.",
          raw: { declaredScreenTags: declared },
        })
        .returning();

      if (regressionFail) {
        await db.update(appdevWorkOrders).set({ status: "changes_requested", updatedAt: new Date() }).where(eq(appdevWorkOrders.id, wo.id));
        publishLiveEvent({ companyId, type: "appdev.vfg.failed", payload: { appId: wo.appId, workOrderId: wo.id, visualReviewId: review.id, kind: "vfg-r" } });
      }
      res.status(201).json({ visualReview: review });
    }),
  );

  // Baseline promotion — Tyler approval promotes a screenshot to baseline
  // (spec 4.6); superseded baselines retained for the timeline.
  router.post(
    `${base}/screens/:screenId/promote-baseline`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const assetId = String(req.body?.assetId ?? "");
      if (!assetId) {
        res.status(400).json({ error: "assetId required" });
        return;
      }
      const [screen] = await db
        .select()
        .from(appdevScreens)
        .where(and(eq(appdevScreens.id, req.params.screenId as string), eq(appdevScreens.companyId, companyId)))
        .limit(1);
      if (!screen) {
        res.status(404).json({ error: "screen not found" });
        return;
      }
      const [row] = await db
        .insert(appdevScreenBaselines)
        .values({
          companyId,
          screenId: screen.id,
          assetId,
          commitSha: typeof req.body?.commitSha === "string" ? req.body.commitSha : null,
          approvedBy: "tyler",
        })
        .returning();
      await db.update(appdevScreens).set({ baselineAssetId: assetId, updatedAt: new Date() }).where(eq(appdevScreens.id, screen.id));
      res.status(201).json({ baseline: row });
    }),
  );

  // Region editor + comparison mode (spec 4.7).
  router.patch(
    `${base}/screens/:screenId`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (Array.isArray(req.body?.regions)) updates.regions = req.body.regions;
      if (["strict", "layout", "content"].includes(req.body?.comparisonMode)) updates.comparisonMode = req.body.comparisonMode;
      const [row] = await db
        .update(appdevScreens)
        .set(updates)
        .where(and(eq(appdevScreens.id, req.params.screenId as string), eq(appdevScreens.companyId, companyId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "screen not found" });
        return;
      }
      res.json({ screen: row });
    }),
  );

  // Screen asset history (history scrubber).
  router.get(
    `${base}/apps/:appId/assets`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(appdevAssets)
        .where(eq(appdevAssets.appId, req.params.appId as string))
        .orderBy(desc(appdevAssets.createdAt))
        .limit(200);
      res.json({ assets: rows });
    }),
  );

  /* ═══ Phase 5 — designer chat persistence ════════════════════════════ */

  router.get(
    `${base}/apps/:appId/chat/threads`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const threads = await db
        .select()
        .from(appdevChatThreads)
        .where(eq(appdevChatThreads.appId, req.params.appId as string))
        .orderBy(desc(appdevChatThreads.createdAt));
      res.json({ threads });
    }),
  );

  router.post(
    `${base}/apps/:appId/chat/threads`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [thread] = await db
        .insert(appdevChatThreads)
        .values({
          companyId,
          appId: req.params.appId as string,
          title: String(req.body?.title ?? "Design thread").slice(0, 120),
          forkedFromMessageId: typeof req.body?.forkedFromMessageId === "string" ? req.body.forkedFromMessageId : null,
        })
        .returning();
      res.status(201).json({ thread });
    }),
  );

  router.get(
    `${base}/chat/threads/:threadId/messages`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const messages = await db
        .select()
        .from(appdevChatMessages)
        .where(eq(appdevChatMessages.threadId, req.params.threadId as string))
        .orderBy(asc(appdevChatMessages.createdAt));
      res.json({ messages });
    }),
  );

  // Post a message → persist user turn → stream Gemini reply (SSE) → persist
  // assistant turn. Chat survives navigation now (spec 5.1); nothing binds an
  // agent until promoted.
  router.post(
    `${base}/chat/threads/:threadId/messages/stream`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const threadId = req.params.threadId as string;
      const prompt = String(req.body?.prompt ?? "").slice(0, 4000);
      if (!prompt) {
        res.status(400).json({ error: "prompt required" });
        return;
      }
      const [thread] = await db
        .select()
        .from(appdevChatThreads)
        .where(and(eq(appdevChatThreads.id, threadId), eq(appdevChatThreads.companyId, companyId)))
        .limit(1);
      if (!thread) {
        res.status(404).json({ error: "thread not found" });
        return;
      }
      const [app] = await db.select().from(appdevApps).where(eq(appdevApps.id, thread.appId)).limit(1);
      const history = await db
        .select()
        .from(appdevChatMessages)
        .where(eq(appdevChatMessages.threadId, threadId))
        .orderBy(asc(appdevChatMessages.createdAt));
      await db.insert(appdevChatMessages).values({ threadId, role: "user", content: prompt });

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders?.();
      const send = (event: string, data: unknown) => {
        if (res.writable) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      res.write(":ok\n\n");
      const controller = new AbortController();
      res.on("close", () => { if (!res.writableEnded) controller.abort(); });
      let full = "";
      try {
        for await (const delta of streamDesignReply({
          appName: app?.name ?? "app",
          prompt,
          history: history.slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content })),
          signal: controller.signal,
        })) {
          full += delta;
          send("delta", { text: delta });
        }
        const [saved] = await db
          .insert(appdevChatMessages)
          .values({ threadId, role: "assistant", content: full })
          .returning();
        send("done", { messageId: saved.id });
      } catch (err) {
        if (err instanceof DesignModelUnconfiguredError) send("model_unconfigured", { message: err.message });
        else send("error", { message: String((err as Error).message).slice(0, 200) });
      }
      res.end();
    }),
  );

  router.post(
    `${base}/chat/messages/:messageId/pin`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [row] = await db
        .update(appdevChatMessages)
        .set({ pinned: req.body?.pinned !== false })
        .where(eq(appdevChatMessages.id, req.params.messageId as string))
        .returning();
      res.json({ message: row ?? null });
    }),
  );

  // Promote a message: chat is upstream of contracts (spec 5.1). Creates the
  // target artifact and stamps promoted_to.
  router.post(
    `${base}/chat/messages/:messageId/promote`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const to = String(req.body?.to ?? "");
      if (to === "spec") assertBoard(req);
      const [msg] = await db
        .select()
        .from(appdevChatMessages)
        .where(eq(appdevChatMessages.id, req.params.messageId as string))
        .limit(1);
      if (!msg) {
        res.status(404).json({ error: "message not found" });
        return;
      }
      const [thread] = await db.select().from(appdevChatThreads).where(eq(appdevChatThreads.id, msg.threadId)).limit(1);
      if (!thread || thread.companyId !== companyId) {
        res.status(404).json({ error: "thread not found" });
        return;
      }
      let created: Record<string, unknown> | null = null;
      if (to === "reference_pack") {
        const [pack] = await db
          .insert(appdevReferencePacks)
          .values({
            companyId,
            appId: thread.appId,
            name: `From chat — ${new Date().toISOString().slice(0, 10)}`,
            items: (msg.attachments ?? []).map((a) => ({ ...(a as Record<string, unknown>), kind: "concept_art" })),
          })
          .returning();
        created = { referencePackId: pack.id };
      } else if (to === "work_order") {
        const existing = await db.select({ id: appdevWorkOrders.id }).from(appdevWorkOrders).where(eq(appdevWorkOrders.appId, thread.appId));
        const [wo] = await db
          .insert(appdevWorkOrders)
          .values({
            companyId,
            appId: thread.appId,
            code: `CHAT-WO-${existing.length + 1}-${msg.id.slice(0, 4)}`,
            type: "feature",
            lane: "design",
            objective: msg.content.slice(0, 500),
            acceptanceCriteria: [{ criterion_id: "chat-1", text: msg.content.slice(0, 2000), kind: "chat_promotion" }],
            status: "draft",
          })
          .returning();
        created = { workOrderId: wo.id };
      } else if (to === "skill") {
        const slash = `/${String(req.body?.slashCommand ?? `chat-${msg.id.slice(0, 6)}`).replace(/^\//, "")}`;
        const [skill] = await db
          .insert(appdevSkills)
          .values({
            companyId,
            name: String(req.body?.name ?? `Chat skill ${msg.id.slice(0, 6)}`).slice(0, 80),
            slashCommand: slash,
            description: msg.content.slice(0, 200),
            sourceThreadId: msg.threadId,
            definition: { lane: thread.lane, prompt_template: msg.content, output_action: "draft_wo" },
          })
          .returning();
        created = { skillId: skill.id };
      } else if (to === "spec") {
        // One click drafts nothing binding by itself — it attempts idea→spec
        // through the gatekeeper (no machine evidence required on that gate).
        const result = await decideGate(db, {
          companyId,
          appId: thread.appId,
          gate: "idea_to_spec",
          verdict: "passed",
          reviewer: actor.actorType === "agent" ? actor.actorId : "tyler",
          actorType: actor.actorType === "agent" ? "agent" : "board",
          evidence: { promoted_message_id: msg.id },
          comments: "Promoted to spec from designer chat",
        });
        created = { gateId: (result.gate as { id: string }).id };
      } else {
        res.status(400).json({ error: "to must be reference_pack | work_order | skill | spec" });
        return;
      }
      await db.update(appdevChatMessages).set({ promotedTo: to }).where(eq(appdevChatMessages.id, msg.id));
      res.status(201).json({ promoted: to, ...created });
    }),
  );

  /* ═══ Phase 5 — feedback inbox + triage ══════════════════════════════ */

  router.get(
    `${base}/apps/:appId/feedback`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const items = await db
        .select()
        .from(appdevFeedbackItems)
        .where(eq(appdevFeedbackItems.appId, req.params.appId as string))
        .orderBy(desc(appdevFeedbackItems.createdAt))
        .limit(200);
      res.json({ items });
    }),
  );

  router.post(
    `${base}/apps/:appId/feedback`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      const appId = req.params.appId as string;
      assertCompanyAccess(req, companyId);
      const { item, deduped } = await ingestFeedback(db, companyId, appId, {
        source: "manual",
        externalId: null,
        title: String(req.body?.title ?? "").slice(0, 300),
        body: String(req.body?.body ?? ""),
        severity: ["p0", "p1", "p2", "p3"].includes(req.body?.severity) ? req.body.severity : "p2",
        clusterKey: null,
        raw: { manual: true },
      });
      let draft = null;
      if (item && req.body?.autoDraft !== false) draft = await autoDraftFromFeedback(db, item);
      res.status(201).json({ item, deduped, draftWorkOrder: draft });
    }),
  );

  router.post(
    `${base}/feedback/:itemId/dismiss`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [row] = await db
        .update(appdevFeedbackItems)
        .set({ status: "dismissed" })
        .where(and(eq(appdevFeedbackItems.id, req.params.itemId as string), eq(appdevFeedbackItems.companyId, companyId)))
        .returning();
      res.json({ item: row ?? null });
    }),
  );

  router.post(
    `${base}/feedback/:itemId/convert`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [item] = await db
        .select()
        .from(appdevFeedbackItems)
        .where(and(eq(appdevFeedbackItems.id, req.params.itemId as string), eq(appdevFeedbackItems.companyId, companyId)))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: "feedback item not found" });
        return;
      }
      const wo = await autoDraftFromFeedback(db, item);
      res.status(201).json({ workOrder: wo });
    }),
  );

  /* ═══ Phase 6 — skills, digest, retro ════════════════════════════════ */

  router.get(
    `${base}/skills`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const skills = await db.select().from(appdevSkills).where(eq(appdevSkills.companyId, companyId)).orderBy(desc(appdevSkills.runCount));
      res.json({ skills });
    }),
  );

  router.post(
    `${base}/skills`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const name = String(req.body?.name ?? "").trim();
      const slash = `/${String(req.body?.slashCommand ?? "").replace(/^\//, "").trim()}`;
      if (!name || slash === "/") {
        res.status(400).json({ error: "name and slashCommand required" });
        return;
      }
      const [skill] = await db
        .insert(appdevSkills)
        .values({
          companyId,
          name,
          slashCommand: slash,
          description: typeof req.body?.description === "string" ? req.body.description : null,
          definition: req.body?.definition ?? { output_action: "draft_wo", prompt_template: "" },
        })
        .returning();
      res.status(201).json({ skill });
    }),
  );

  // Invoke: the system may SUGGEST a skill but never auto-executes one that
  // creates work orders without confirmation (spec 5.2) — confirm:true required.
  router.post(
    `${base}/skills/:skillId/invoke`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [skill] = await db
        .select()
        .from(appdevSkills)
        .where(and(eq(appdevSkills.id, req.params.skillId as string), eq(appdevSkills.companyId, companyId)))
        .limit(1);
      if (!skill) {
        res.status(404).json({ error: "skill not found" });
        return;
      }
      const def = (skill.definition ?? {}) as { output_action?: string; prompt_template?: string; lane?: string };
      if (def.output_action === "draft_wo") {
        if (req.body?.confirm !== true) {
          res.status(409).json({
            confirmationRequired: true,
            preview: { skill: skill.name, action: "draft_wo", template: def.prompt_template ?? "" },
          });
          return;
        }
        const appId = String(req.body?.appId ?? "");
        if (!appId) {
          res.status(400).json({ error: "appId required for draft_wo skills" });
          return;
        }
        const existing = await db.select({ id: appdevWorkOrders.id }).from(appdevWorkOrders).where(eq(appdevWorkOrders.appId, appId));
        const input = String(req.body?.input ?? "");
        const [wo] = await db
          .insert(appdevWorkOrders)
          .values({
            companyId,
            appId,
            code: `SK-WO-${existing.length + 1}-${skill.id.slice(0, 4)}`,
            type: "feature",
            lane: (def.lane as string) || "utility",
            objective: `[skill ${skill.slashCommand}] ${(def.prompt_template ?? "").slice(0, 300)} ${input}`.trim(),
            acceptanceCriteria: [{ criterion_id: "skill-1", text: input || def.prompt_template || skill.name, kind: "skill_invocation" }],
            status: "draft",
          })
          .returning();
        await db.update(appdevSkills).set({ runCount: skill.runCount + 1 }).where(eq(appdevSkills.id, skill.id));
        res.status(201).json({ workOrder: wo });
        return;
      }
      // run_report / custom: return the rendered template (no side effects).
      await db.update(appdevSkills).set({ runCount: skill.runCount + 1 }).where(eq(appdevSkills.id, skill.id));
      res.json({ rendered: (def.prompt_template ?? "").replace("{input}", String(req.body?.input ?? "")) });
    }),
  );

  router.post(
    `${base}/digest/run`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await postDigest(db, companyId);
      res.json(result);
    }),
  );

  router.get(
    `${base}/apps/:appId/retros`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const retros = await db
        .select()
        .from(appdevRetros)
        .where(eq(appdevRetros.appId, req.params.appId as string))
        .orderBy(desc(appdevRetros.createdAt));
      res.json({ retros });
    }),
  );

  router.post(
    `${base}/apps/:appId/retros`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [retro] = await db
        .insert(appdevRetros)
        .values({
          companyId,
          appId: req.params.appId as string,
          doc: String(req.body?.doc ?? ""),
          lessons: Array.isArray(req.body?.lessons) ? req.body.lessons : [],
          fedForwardIds: [],
        })
        .returning();
      res.status(201).json({ retro });
    }),
  );

  // Feed forward — retro feeding Idea is OUROBOROS in the UI (spec Part 11).
  router.post(
    `${base}/retros/:retroId/feed-forward`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [retro] = await db
        .select()
        .from(appdevRetros)
        .where(and(eq(appdevRetros.id, req.params.retroId as string), eq(appdevRetros.companyId, companyId)))
        .limit(1);
      if (!retro) {
        res.status(404).json({ error: "retro not found" });
        return;
      }
      const lessonText = String(req.body?.lesson ?? "").slice(0, 300);
      const kind = String(req.body?.kind ?? "work_order");
      let createdId: string;
      if (kind === "idea") {
        const [app] = await db
          .insert(appdevApps)
          .values({
            companyId,
            name: `Idea: ${lessonText.slice(0, 60) || "from retro"}`,
            slug: `idea-${retro.id.slice(0, 6)}-${Date.now().toString(36)}`,
            phase: "idea",
          })
          .returning();
        createdId = app.id;
      } else {
        const existing = await db.select({ id: appdevWorkOrders.id }).from(appdevWorkOrders).where(eq(appdevWorkOrders.appId, retro.appId));
        const [wo] = await db
          .insert(appdevWorkOrders)
          .values({
            companyId,
            appId: retro.appId,
            code: `RETRO-WO-${existing.length + 1}-${retro.id.slice(0, 4)}`,
            type: "chore",
            lane: "utility",
            objective: `[retro lesson] ${lessonText}`,
            status: "draft",
          })
          .returning();
        createdId = wo.id;
      }
      await db
        .update(appdevRetros)
        .set({ fedForwardIds: [...(retro.fedForwardIds ?? []), createdId] })
        .where(eq(appdevRetros.id, retro.id));
      res.status(201).json({ kind, id: createdId });
    }),
  );

  logger.info("appdev-studio routes mounted (phases 3-6; migrations 0146+0151 gated)");
  return router;
}

/* ── Public Sentry webhook (mounted BEFORE the guarded /api router, same
 *    defense-in-depth pattern as the Baily's App feedback intake): token is a
 *    speed bump, scope is create-feedback-only, dedupe by Sentry issue id. ── */
export function appdevWebhookRoutes(db: Db) {
  const router = Router();
  router.post("/appdev-webhooks/sentry/:companyId/:appId", async (req, res) => {
    try {
      const token = String(req.query.token ?? req.headers["x-appdev-webhook-token"] ?? "");
      const expected = process.env.APPDEV_SENTRY_WEBHOOK_TOKEN || "";
      if (!expected || token !== expected) {
        res.status(401).json({ error: "webhook token invalid or APPDEV_SENTRY_WEBHOOK_TOKEN unset" });
        return;
      }
      const fb = normalizeSentry((req.body ?? {}) as Record<string, unknown>);
      const { item, deduped } = await ingestFeedback(db, req.params.companyId as string, req.params.appId as string, fb);
      let drafted = false;
      if (item) {
        // Auto-draft on ingestion (spec 6) — draft only, never queued.
        drafted = (await autoDraftFromFeedback(db, item)) !== null;
      }
      res.status(deduped ? 200 : 201).json({ ok: true, deduped, drafted });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "42P01" || err instanceof AppdevMigrationPendingError) {
        res.status(409).json({ migrationPending: true });
        return;
      }
      logger.warn({ err }, "sentry webhook ingest failed");
      res.status(500).json({ error: "ingest failed" });
    }
  });
  return router;
}

/**
 * App Dev Control Center routes (spec v1.1) — /companies/:companyId/appdev/*
 *
 * Coexists with routes/app-dev.ts (legacy page) — different prefix, zero overlap.
 *
 * MIGRATION GATING: every handler catches AppdevMigrationPendingError and
 * degrades: GETs return 200 { migrationPending: true, ... } so the UI renders
 * amber pending states; writes return 409 with the same flag. The tab is fully
 * reviewable before 0146 is applied.
 *
 * POST-BACK API: the external build pipeline reports in through
 * /work-orders/:id/{plan,proof-bundles,status,costs}. This seam is the honest
 * v1 replacement for agent dispatch — a future dispatcher posts to the same
 * endpoints and nothing above this layer changes.
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appdevApps,
  appdevGates,
  appdevProofBundles,
  appdevReferencePacks,
  appdevScreens,
  appdevVisualReviews,
  appdevWorkOrders,
} from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo, assertBoard } from "./authz.js";
import { logger } from "../middleware/logger.js";
import {
  APPDEV_GATES,
  APPDEV_PHASES,
  AppdevMigrationPendingError,
  GateRefusedError,
  WO_SIZE_DEFAULT_MAX_STEPS,
  checkGateEvidence,
  decideGate,
  killApp,
  tylerQueue,
  type AppdevGate,
} from "../services/appdev/gatekeeper.js";
import {
  ProofBundleRejectedError,
  submitProofBundle,
  type ProofBundleKind,
} from "../services/appdev/proof-bundles.js";
import {
  VfgDecorrelationError,
  VfgModelUnconfiguredError,
  runVisualReview,
} from "../services/appdev/visual-review.js";
import { publishLiveEvent } from "../services/live-events.js";

type Handler = (req: import("express").Request, res: import("express").Response) => Promise<void>;

/** Wrap a handler with migration-pending + domain-error translation. */
function guarded(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof AppdevMigrationPendingError) {
        const isRead = req.method === "GET";
        res.status(isRead ? 200 : 409).json({
          migrationPending: true,
          migration: "0146_appdev_control_center.sql",
          message: err.message,
        });
        return;
      }
      if (err instanceof GateRefusedError) {
        res.status(422).json({ error: err.message, ...err.details });
        return;
      }
      if (err instanceof ProofBundleRejectedError) {
        res.status(422).json({ error: err.message, ...err.details });
        return;
      }
      if (err instanceof VfgModelUnconfiguredError || err instanceof VfgDecorrelationError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "app";
}

export function appdevControlRoutes(db: Db) {
  const router = Router();
  const base = "/companies/:companyId/appdev";

  /* ── Overview: roster + board + queue count ─────────────────────────── */
  router.get(
    `${base}/overview`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      let apps;
      try {
        apps = await db
          .select()
          .from(appdevApps)
          .where(eq(appdevApps.companyId, companyId))
          .orderBy(desc(appdevApps.updatedAt));
      } catch (err) {
        // First touch — translate undefined_table for the whole overview.
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
      const queue = await tylerQueue(db, companyId);
      res.json({
        migrationPending: false,
        phases: APPDEV_PHASES,
        apps,
        waitingOnTyler: queue.length,
      });
    }),
  );

  /* ── Idea intake (spec 1.1 "+ New Idea") ────────────────────────────── */
  router.post(
    `${base}/apps`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const platform = ["ios", "web", "other"].includes(req.body?.platform)
        ? (req.body.platform as string)
        : "web";
      try {
        const [row] = await db
          .insert(appdevApps)
          .values({
            companyId,
            name,
            slug: String(req.body?.slug ?? "").trim() || slugify(name),
            platform,
            phase: "idea",
            status: "active",
            repoUrl: typeof req.body?.repoUrl === "string" ? req.body.repoUrl : null,
          })
          .returning();
        publishLiveEvent({ companyId, type: "appdev.queue.updated", payload: { appId: row.id } });
        res.status(201).json({ app: row });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── App detail: gates, WOs, screens, latest visual reviews ─────────── */
  router.get(
    `${base}/apps/:appId`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      const appId = req.params.appId as string;
      assertCompanyAccess(req, companyId);
      try {
        const [app] = await db
          .select()
          .from(appdevApps)
          .where(and(eq(appdevApps.id, appId), eq(appdevApps.companyId, companyId)))
          .limit(1);
        if (!app) {
          res.status(404).json({ error: "App not found" });
          return;
        }
        const [gates, workOrders, screens, packs, reviews] = await Promise.all([
          db.select().from(appdevGates).where(eq(appdevGates.appId, appId)).orderBy(desc(appdevGates.createdAt)),
          db.select().from(appdevWorkOrders).where(eq(appdevWorkOrders.appId, appId)).orderBy(desc(appdevWorkOrders.createdAt)),
          db.select().from(appdevScreens).where(eq(appdevScreens.appId, appId)),
          db.select().from(appdevReferencePacks).where(eq(appdevReferencePacks.appId, appId)).orderBy(desc(appdevReferencePacks.createdAt)),
          db.select().from(appdevVisualReviews).where(eq(appdevVisualReviews.appId, appId)).orderBy(desc(appdevVisualReviews.createdAt)),
        ]);
        res.json({ app, gates, workOrders, screens, referencePacks: packs, visualReviews: reviews });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── Gate evidence preflight + decision ─────────────────────────────── */
  router.get(
    `${base}/apps/:appId/gates/:gate/evidence`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const gate = req.params.gate as AppdevGate;
      if (!APPDEV_GATES.includes(gate)) {
        res.status(400).json({ error: `Unknown gate '${gate}'` });
        return;
      }
      const check = await checkGateEvidence(db, companyId, req.params.appId as string, gate);
      res.json({ gate, ...check });
    }),
  );

  router.post(
    `${base}/apps/:appId/gates/:gate`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const gate = req.params.gate as AppdevGate;
      if (!APPDEV_GATES.includes(gate)) {
        res.status(400).json({ error: `Unknown gate '${gate}'` });
        return;
      }
      const verdict = req.body?.verdict as "passed" | "failed" | "changes_requested";
      if (!["passed", "failed", "changes_requested"].includes(verdict)) {
        res.status(400).json({ error: "verdict must be passed | failed | changes_requested" });
        return;
      }
      const result = await decideGate(db, {
        companyId,
        appId: req.params.appId as string,
        gate,
        verdict,
        reviewer:
          actor.actorType === "agent" ? actor.actorId : String(req.body?.reviewer ?? "tyler"),
        actorType: actor.actorType === "agent" ? "agent" : "board",
        evidence: req.body?.evidence,
        comments: typeof req.body?.comments === "string" ? req.body.comments : undefined,
        overrideReason:
          typeof req.body?.overrideReason === "string" && req.body.overrideReason.trim()
            ? req.body.overrideReason.trim()
            : undefined,
      });
      res.status(201).json(result);
    }),
  );

  /* ── Work-order composer (spec 4.2 enforcement at app layer) ────────── */
  router.post(
    `${base}/apps/:appId/work-orders`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      const appId = req.params.appId as string;
      assertCompanyAccess(req, companyId);
      const b = req.body ?? {};
      const type = String(b.type ?? "feature");
      const lane = String(b.lane ?? "code");
      const objective = String(b.objective ?? "").trim();
      const touchesUi = Boolean(b.touchesUi);
      const sizeClass = ["s", "m", "l"].includes(b.sizeClass) ? (b.sizeClass as string) : "s";
      const referencePackId = typeof b.referencePackId === "string" ? b.referencePackId : null;
      if (!objective) {
        res.status(400).json({ error: "objective is required" });
        return;
      }
      // The composer refuses to queue any UI-touching order without a pack
      // (spec 4.2 — app layer; the 0146 CHECK constraint is the DB layer).
      if (touchesUi && !referencePackId) {
        res.status(422).json({
          error:
            "touches_ui work orders require a reference_pack_id — references are contracts (spec 4.2).",
        });
        return;
      }
      const visualCriterion = touchesUi
        ? [
            {
              criterion_id: "visual-1",
              kind: "visual",
              reference_pack_id: referencePackId,
              text: "Rendered output matches the attached reference pack (VFG-2 must pass).",
            },
          ]
        : [];
      try {
        const [app] = await db
          .select()
          .from(appdevApps)
          .where(and(eq(appdevApps.id, appId), eq(appdevApps.companyId, companyId)))
          .limit(1);
        if (!app) {
          res.status(404).json({ error: "App not found" });
          return;
        }
        const existing = await db
          .select({ id: appdevWorkOrders.id })
          .from(appdevWorkOrders)
          .where(eq(appdevWorkOrders.appId, appId));
        const code = `${app.slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "APP"}-WO-${existing.length + 1}`;
        const needsPlan = sizeClass === "m" || sizeClass === "l";
        const [row] = await db
          .insert(appdevWorkOrders)
          .values({
            companyId,
            appId,
            code,
            type,
            lane,
            objective,
            acceptanceCriteria: [
              ...(Array.isArray(b.acceptanceCriteria) ? b.acceptanceCriteria : []),
              ...visualCriterion,
            ],
            referencePackId,
            touchesUi,
            sizeClass,
            planStatus: needsPlan ? "pending" : "not_required",
            proofRequirements: touchesUi
              ? ["build", "test", "screenshot_set", "self_check"]
              : ["build", "test"],
            status: "draft",
            maxSteps: WO_SIZE_DEFAULT_MAX_STEPS[sizeClass] ?? null,
          })
          .returning();
        res.status(201).json({ workOrder: row });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── Post-back API (external pipeline reports in) ───────────────────── */

  // Plan submission (spec 3.4). Routing is deterministic: confidence ≥ 0.8 →
  // approved; below → escalated to the Tyler queue. (Utility-lane critique is
  // a later wire-up; escalation is the safe default meanwhile.)
  router.post(
    `${base}/work-orders/:woId/plan`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const woId = req.params.woId as string;
      const plan = req.body?.plan as Record<string, unknown> | undefined;
      const confidence = Number(plan?.confidence ?? NaN);
      if (!plan || !Array.isArray(plan.steps) || Number.isNaN(confidence)) {
        res.status(400).json({ error: "plan { steps[], confidence 0-1, risks[] } required" });
        return;
      }
      try {
        const [wo] = await db
          .select()
          .from(appdevWorkOrders)
          .where(and(eq(appdevWorkOrders.id, woId), eq(appdevWorkOrders.companyId, companyId)))
          .limit(1);
        if (!wo) {
          res.status(404).json({ error: "Work order not found" });
          return;
        }
        const approved = confidence >= 0.8;
        await db
          .update(appdevWorkOrders)
          .set({
            plan,
            planStatus: approved ? "approved" : "escalated",
            status: wo.status === "draft" || wo.status === "queued" ? "planning" : wo.status,
            updatedAt: new Date(),
          })
          .where(eq(appdevWorkOrders.id, woId));
        if (!approved) {
          publishLiveEvent({
            companyId,
            type: "appdev.plan.escalated",
            payload: { workOrderId: woId, code: wo.code, confidence },
          });
        }
        res.json({ planStatus: approved ? "approved" : "escalated", confidence });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  // Proof-bundle submission (secret-scrubbed, completeness-checked).
  router.post(
    `${base}/work-orders/:woId/proof-bundles`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const b = req.body ?? {};
      let wo: typeof appdevWorkOrders.$inferSelect | undefined;
      try {
        [wo] = await db
          .select()
          .from(appdevWorkOrders)
          .where(and(eq(appdevWorkOrders.id, req.params.woId as string), eq(appdevWorkOrders.companyId, companyId)))
          .limit(1);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
      if (!wo) {
        res.status(404).json({ error: "Work order not found" });
        return;
      }
      const row = await submitProofBundle(db, {
        companyId,
        appId: wo.appId,
        workOrderId: wo.id,
        kind: String(b.kind ?? "misc") as ProofBundleKind,
        payload: b.payload,
        screenshotAssetIds: Array.isArray(b.screenshotAssetIds) ? b.screenshotAssetIds : undefined,
        screenshotsByTag: b.screenshotsByTag,
        selfCheck: b.selfCheck,
        submittedBy: actor.actorId,
      });
      res.status(201).json({ proofBundle: row });
    }),
  );

  // Status transitions from the external pipeline.
  const WO_STATUSES = [
    "draft",
    "queued",
    "planning",
    "in_progress",
    "awaiting_review",
    "changes_requested",
    "done",
    "killed",
  ];
  router.post(
    `${base}/work-orders/:woId/status`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const status = String(req.body?.status ?? "");
      if (!WO_STATUSES.includes(status)) {
        res.status(400).json({ error: `status must be one of ${WO_STATUSES.join(", ")}` });
        return;
      }
      try {
        const [wo] = await db
          .select()
          .from(appdevWorkOrders)
          .where(and(eq(appdevWorkOrders.id, req.params.woId as string), eq(appdevWorkOrders.companyId, companyId)))
          .limit(1);
        if (!wo) {
          res.status(404).json({ error: "Work order not found" });
          return;
        }
        // Plan-before-code (3.4): m/l orders cannot enter in_progress unplanned.
        if (
          status === "in_progress" &&
          (wo.sizeClass === "m" || wo.sizeClass === "l") &&
          wo.planStatus !== "approved"
        ) {
          res.status(422).json({
            error: `Size-${wo.sizeClass} work order cannot enter in_progress without an approved plan (plan_status=${wo.planStatus}).`,
          });
          return;
        }
        const addCost = Number(req.body?.costUsd ?? 0);
        await db
          .update(appdevWorkOrders)
          .set({
            status,
            ...(Number.isFinite(addCost) && addCost > 0
              ? { costUsd: String(Number(wo.costUsd ?? 0) + addCost) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(appdevWorkOrders.id, wo.id));
        res.json({ ok: true, status });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── VFG-2: run a visual review on a proof bundle ───────────────────── */
  router.post(
    `${base}/proof-bundles/:bundleId/visual-review`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const [bundle] = await db
          .select()
          .from(appdevProofBundles)
          .where(and(eq(appdevProofBundles.id, req.params.bundleId as string), eq(appdevProofBundles.companyId, companyId)))
          .limit(1);
        if (!bundle) {
          res.status(404).json({ error: "Proof bundle not found" });
          return;
        }
        const screens = req.body?.screens;
        if (!Array.isArray(screens) || screens.length === 0) {
          res.status(400).json({
            error:
              "screens[] required: { screenTag, comparisonMode, regions, renderB64, referenceB64s[] } per screen (asset-store integration lands with the harness phase).",
          });
          return;
        }
        const [app] = await db
          .select()
          .from(appdevApps)
          .where(eq(appdevApps.id, bundle.appId))
          .limit(1);
        const result = await runVisualReview({
          appName: app?.name ?? "app",
          screens,
          styleTokens: req.body?.styleTokens,
          generatorModelFamily: req.body?.generatorModelFamily,
        });
        const [row] = await db
          .insert(appdevVisualReviews)
          .values({
            companyId,
            appId: bundle.appId,
            workOrderId: bundle.workOrderId,
            proofBundleId: bundle.id,
            referencePackId:
              typeof req.body?.referencePackId === "string" ? req.body.referencePackId : null,
            reviewerLane: "review",
            reviewerModel: result.reviewerModel,
            rubricScores: result.rubricScores as Record<string, Record<string, unknown>>,
            verdict: result.verdict,
            worstScreen: result.worstScreen,
            summary: result.summary,
            raw: result.raw,
          })
          .returning();
        if (result.verdict === "fail" && bundle.workOrderId) {
          // Failure routing (4.4): requeue with the rubric embedded verbatim.
          await db
            .update(appdevWorkOrders)
            .set({ status: "changes_requested", updatedAt: new Date() })
            .where(eq(appdevWorkOrders.id, bundle.workOrderId));
          publishLiveEvent({
            companyId,
            type: "appdev.vfg.failed",
            payload: {
              appId: bundle.appId,
              workOrderId: bundle.workOrderId,
              visualReviewId: row.id,
              worstScreen: result.worstScreen,
            },
          });
        }
        res.status(201).json({ visualReview: row });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── Screens inventory ──────────────────────────────────────────────── */
  router.post(
    `${base}/apps/:appId/screens`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const screenTag = String(req.body?.screenTag ?? "").trim();
      if (!screenTag) {
        res.status(400).json({ error: "screenTag is required" });
        return;
      }
      try {
        const [row] = await db
          .insert(appdevScreens)
          .values({
            companyId,
            appId: req.params.appId as string,
            screenTag,
            description: typeof req.body?.description === "string" ? req.body.description : null,
            launchRoute: typeof req.body?.launchRoute === "string" ? req.body.launchRoute : null,
            comparisonMode: ["strict", "layout", "content"].includes(req.body?.comparisonMode)
              ? req.body.comparisonMode
              : "strict",
            regions: Array.isArray(req.body?.regions) ? req.body.regions : [],
          })
          .returning();
        res.status(201).json({ screen: row });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── Reference packs ────────────────────────────────────────────────── */
  router.post(
    `${base}/apps/:appId/reference-packs`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      try {
        const [row] = await db
          .insert(appdevReferencePacks)
          .values({
            companyId,
            appId: req.params.appId as string,
            name,
            supersedesId: typeof req.body?.supersedesId === "string" ? req.body.supersedesId : null,
            items: Array.isArray(req.body?.items) ? req.body.items : [],
            styleTokens: req.body?.styleTokens ?? null,
            // Pack approval for design→build must be Tyler; board actor required.
            approvedBy: req.body?.approve === true ? (assertBoard(req), "tyler") : null,
          })
          .returning();
        res.status(201).json({ referencePack: row });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "42P01") throw new AppdevMigrationPendingError();
        throw err;
      }
    }),
  );

  /* ── Tyler queue + kill switches ────────────────────────────────────── */
  router.get(
    `${base}/tyler-queue`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const items = await tylerQueue(db, companyId);
      res.json({ migrationPending: false, items });
    }),
  );

  router.post(
    `${base}/apps/:appId/kill`,
    guarded(async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req); // RAIL semantics: only Tyler kills.
      const actor = getActorInfo(req);
      await killApp(
        db,
        companyId,
        req.params.appId as string,
        String(req.body?.reason ?? "killed"),
        actor.actorId,
      );
      res.json({ killed: true });
    }),
  );

  logger.info("appdev-control routes mounted (spec v1.1)");
  return router;
}

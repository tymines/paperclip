import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appDevApps,
  appDevBlueprints,
  agents as agentsTable,
  approvals as approvalsTable,
  heartbeatRuns,
  issues as issuesTable,
} from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/index.js";
import {
  conceptImageStatus,
  resolveConceptImageGenerator,
} from "../services/app-dev/concept-image.js";
import {
  DESIGN_AGENT_MODEL,
  DesignModelUnconfiguredError,
  streamDesignReply,
  geminiApiKey,
} from "../services/app-dev/design-chat.js";

const APP_FEEDBACK_ORIGIN_KIND = "app-feedback";
const COCKPIT_KEY = "missioncontrol";

// Display metadata for known apps. Unknown feedback origins fall back to a
// title-cased name; nothing is fabricated — a row only exists if it has a real
// feedback origin (or is the cockpit).
const APP_META: Record<string, { name: string; tagline: string; accent: string; repo?: string }> = {
  missioncontrol: {
    name: "MissionControl",
    tagline: "The operations cockpit — your agent fleet's home base.",
    accent: "#3B82FF",
    repo: "paperclipai/paperclip",
  },
  bailysapp: {
    name: "Baily's App",
    tagline: "Daily planner & focus companion shipping real user feedback.",
    accent: "#A56EFF",
  },
};

function prettyName(key: string): string {
  return APP_META[key]?.name ?? key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseVersion(description: string | null): number | null {
  const m = (description || "").match(/\bv(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseFeedbackKind(title: string | null): "bug" | "feature" | "feedback" {
  const m = (title || "").match(/\[[^\]]*•\s*(bug|feature)\]/i);
  return (m?.[1]?.toLowerCase() as "bug" | "feature") || "feedback";
}

function cleanTitle(title: string | null): string {
  const t = title || "";
  const m = t.match(/^\[[^\]]*•\s*(?:bug|feature)\]\s*(.*)$/i);
  return m ? m[1] : t;
}

export function appDevRoutes(db: Db) {
  const router = Router();

  /**
   * Ensure the app_dev_apps registry reflects reality for a company:
   *  - a cockpit row (MissionControl) always exists, and
   *  - one row per distinct app-feedback originId (e.g. bailysapp).
   * Self-healing + idempotent; the table is the durable source of truth.
   */
  async function ensureApps(companyId: string): Promise<void> {
    const fb = await db
      .select({ originId: issuesTable.originId })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.companyId, companyId),
          eq(issuesTable.originKind, APP_FEEDBACK_ORIGIN_KIND),
        ),
      );
    const origins = new Set<string>();
    for (const r of fb) {
      const o = (r.originId || "").toLowerCase();
      if (o) origins.add(o);
    }
    const wanted: { key: string; kind: "cockpit" | "app"; feedbackOriginId: string | null }[] = [
      { key: COCKPIT_KEY, kind: "cockpit", feedbackOriginId: null },
      ...[...origins]
        .filter((o) => o !== COCKPIT_KEY)
        .map((o) => ({ key: o, kind: "app" as const, feedbackOriginId: o })),
    ];
    let sort = 0;
    for (const w of wanted) {
      const meta = APP_META[w.key];
      await db
        .insert(appDevApps)
        .values({
          companyId,
          key: w.key,
          name: meta?.name ?? prettyName(w.key),
          tagline: meta?.tagline ?? null,
          kind: w.kind,
          feedbackOriginId: w.feedbackOriginId,
          repo: meta?.repo ?? null,
          accent: meta?.accent ?? "#31D9FF",
          sortOrder: sort++,
        })
        .onConflictDoNothing({ target: [appDevApps.companyId, appDevApps.key] });
    }
  }

  // GET /companies/:companyId/app-dev/apps — registry + live aggregates.
  router.get("/companies/:companyId/app-dev/apps", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await ensureApps(companyId);

    const rows = await db
      .select()
      .from(appDevApps)
      .where(eq(appDevApps.companyId, companyId))
      .orderBy(appDevApps.sortOrder);

    const feedback = await db
      .select({
        originId: issuesTable.originId,
        status: issuesTable.status,
        description: issuesTable.description,
      })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.companyId, companyId),
          eq(issuesTable.originKind, APP_FEEDBACK_ORIGIN_KIND),
        ),
      );

    const pendingApprovals = (
      await db
        .select({ status: approvalsTable.status })
        .from(approvalsTable)
        .where(eq(approvalsTable.companyId, companyId))
    ).filter((a) => a.status === "pending" || a.status === "revision_requested").length;

    const apps = rows.map((row) => {
      const items = feedback.filter(
        (f) => (f.originId || "").toLowerCase() === (row.feedbackOriginId || "").toLowerCase() && row.feedbackOriginId,
      );
      const versions = items.map((i) => parseVersion(i.description)).filter((v): v is number => v != null);
      return {
        id: row.id,
        key: row.key,
        name: row.name,
        tagline: row.tagline,
        kind: row.kind,
        accent: row.accent,
        repo: row.repo,
        feedbackOriginId: row.feedbackOriginId,
        feedbackCount: items.length,
        openFeedback: items.filter((i) => i.status !== "done").length,
        latestVersion: versions.length ? `v${Math.max(...versions)}` : null,
        pendingApprovals,
      };
    });
    res.json({ apps });
  });

  // GET /companies/:companyId/app-dev/blueprints — real starter-template catalog.
  router.get("/companies/:companyId/app-dev/blueprints", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(appDevBlueprints)
      .orderBy(appDevBlueprints.category, appDevBlueprints.sortOrder);
    res.json({ blueprints: rows });
  });

  // Resolve a company app row by key or id.
  async function getApp(companyId: string, appId: string) {
    const byKey = await db
      .select()
      .from(appDevApps)
      .where(and(eq(appDevApps.companyId, companyId), eq(appDevApps.key, appId)))
      .limit(1);
    if (byKey[0]) return byKey[0];
    const byId = await db
      .select()
      .from(appDevApps)
      .where(and(eq(appDevApps.companyId, companyId), eq(appDevApps.id, appId)))
      .limit(1);
    return byId[0] ?? null;
  }

  // GET /companies/:companyId/app-dev/apps/:appId/builds — real agent runs.
  router.get("/companies/:companyId/app-dev/apps/:appId/builds", async (req, res) => {
    const companyId = req.params.companyId as string;
    const appId = req.params.appId as string;
    assertCompanyAccess(req, companyId);
    await ensureApps(companyId);

    // The build pipeline is performed by these fleet roles.
    const pipelineRoles = ["devops", "reviewer", "security"]; // Build / Review / Security
    const fleet = await db
      .select({ id: agentsTable.id, name: agentsTable.name, role: agentsTable.role, status: agentsTable.status })
      .from(agentsTable)
      .where(eq(agentsTable.companyId, companyId));
    const pipelineAgents = fleet.filter((a) => pipelineRoles.includes(a.role));
    const stageForRole = (role: string) =>
      role === "devops" ? "Build" : role === "reviewer" ? "Review" : "Security";

    const agentIds = pipelineAgents.map((a) => a.id);
    let runs: Array<{
      id: string;
      agentId: string;
      status: string;
      startedAt: Date | null;
      finishedAt: Date | null;
      resultJson: Record<string, unknown> | null;
      contextSnapshot: Record<string, unknown> | null;
      createdAt: Date;
    }> = [];
    if (agentIds.length) {
      runs = await db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          resultJson: heartbeatRuns.resultJson,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          createdAt: heartbeatRuns.createdAt,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.agentId, agentIds),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(20);
    }

    const agentById = new Map(pipelineAgents.map((a) => [a.id, a]));
    const progressFor = (status: string) =>
      status === "finished" ? 100 : status === "running" ? 50 : status === "queued" ? 0 : status === "cancelled" ? 100 : 25;
    const builds = runs.map((r) => {
      const ag = agentById.get(r.agentId);
      const ctx = (r.contextSnapshot || {}) as Record<string, unknown>;
      const result = (r.resultJson || {}) as Record<string, unknown>;
      const commit =
        (ctx.commit as string | undefined) ||
        (ctx.commitSha as string | undefined) ||
        (result.commit as string | undefined) ||
        null;
      return {
        runId: r.id,
        stage: ag ? stageForRole(ag.role) : "Build",
        agentName: ag?.name ?? "agent",
        status: r.status,
        progress: progressFor(r.status),
        commit,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        createdAt: r.createdAt,
      };
    });

    // Per-stage current state (latest run per agent role).
    const stages = pipelineAgents.map((a) => {
      const latest = builds.find((b) => b.agentName === a.name) || null;
      return {
        stage: stageForRole(a.role),
        agentId: a.id,
        agentName: a.name,
        agentStatus: a.status,
        latestRunStatus: latest?.status ?? null,
        progress: latest?.progress ?? null,
      };
    });

    res.json({ appKey: appId, stages, builds });
  });

  // GET /companies/:companyId/app-dev/apps/:appId/releases — versions + feedback-by-version.
  router.get("/companies/:companyId/app-dev/apps/:appId/releases", async (req, res) => {
    const companyId = req.params.companyId as string;
    const appId = req.params.appId as string;
    assertCompanyAccess(req, companyId);
    await ensureApps(companyId);

    const app = await getApp(companyId, appId);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    if (!app.feedbackOriginId) {
      res.json({ appKey: app.key, source: "no-feedback-origin", versions: [] });
      return;
    }
    const items = await db
      .select({
        id: issuesTable.id,
        title: issuesTable.title,
        description: issuesTable.description,
        status: issuesTable.status,
        createdAt: issuesTable.createdAt,
      })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.companyId, companyId),
          eq(issuesTable.originKind, APP_FEEDBACK_ORIGIN_KIND),
          eq(issuesTable.originId, app.feedbackOriginId),
        ),
      );

    const byVersion = new Map<number, { version: number; items: Array<{ id: string; title: string; kind: string; status: string }> }>();
    let unversioned = 0;
    for (const i of items) {
      const v = parseVersion(i.description);
      if (v == null) {
        unversioned++;
        continue;
      }
      if (!byVersion.has(v)) byVersion.set(v, { version: v, items: [] });
      byVersion.get(v)!.items.push({
        id: i.id,
        title: cleanTitle(i.title),
        kind: parseFeedbackKind(i.title),
        status: i.status,
      });
    }
    const versions = [...byVersion.values()].sort((a, b) => b.version - a.version);
    res.json({
      appKey: app.key,
      // Honest label: derived from real per-version user feedback (no code-diff
      // source exists yet — see report). Each version lists what users reported.
      source: "feedback-by-reported-version",
      latestVersion: versions[0]?.version ?? null,
      unversionedCount: unversioned,
      versions,
    });
  });

  // PATCH /companies/:companyId/app-dev/apps/:appId — update app metadata.
  router.patch("/companies/:companyId/app-dev/apps/:appId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const appId = req.params.appId as string;
    assertCompanyAccess(req, companyId);

    const app = await getApp(companyId, appId);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const { name, tagline, accent, repo } = req.body || {};
    const update: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        res.status(422).json({ error: "name must be a non-empty string" });
        return;
      }
      update.name = name.trim();
    }

    if (tagline !== undefined) {
      update.tagline = typeof tagline === "string" ? tagline.trim() : null;
    }

    if (accent !== undefined) {
      if (accent !== null && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
        res.status(422).json({ error: "accent must be a hex color (e.g. #3B82FF) or null" });
        return;
      }
      update.accent = accent;
    }

    if (repo !== undefined) {
      update.repo = typeof repo === "string" ? repo.trim() || null : null;
    }

    if (Object.keys(update).length === 0) {
      res.status(422).json({ error: "No valid fields to update" });
      return;
    }

    update.updatedAt = new Date();

    const [updated] = await db
      .update(appDevApps)
      .set(update)
      .where(and(eq(appDevApps.companyId, companyId), eq(appDevApps.id, appId)))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Update failed" });
      return;
    }

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: (req.actor as Record<string, unknown> | null)?.userId as string ?? "board",
      action: "app_dev_update_app",
      entityType: "app_dev_app",
      entityId: appId,
    });

    res.json({ apps: [updated] });
  });

  // POST /companies/:companyId/app-dev/design-chat/stream — Gemini 2.5 Flash (SSE).
  router.post("/companies/:companyId/app-dev/design-chat/stream", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const prompt = String(req.body?.prompt || "").slice(0, 4000);
    const appName = String(req.body?.appName || "your app").slice(0, 80);
    const wantsImage = Boolean(req.body?.generateConcept);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      if (!res.writable) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    res.write(":ok\n\n");

    send("meta", { model: DESIGN_AGENT_MODEL, conceptImage: conceptImageStatus() });

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
      if (!prompt) {
        send("error", { message: "prompt is required" });
        res.end();
        return;
      }
      if (!geminiApiKey()) {
        send("model_unconfigured", {
          message:
            "Gemini 2.5 Flash key not set (GEMINI_API_KEY / GOOGLE_API_KEY). The reasoning model is wired; add the key to go live.",
        });
        res.end();
        return;
      }
      for await (const delta of streamDesignReply({
        appName,
        prompt,
        signal: controller.signal,
      })) {
        send("delta", { text: delta });
      }
      // Concept-image generation — Gemini 3.1 Flash Image.
      if (wantsImage) {
        const generator = resolveConceptImageGenerator();
        if (!generator) {
          // Wired, but the Gemini key isn't set at runtime.
          send("image_needs_key", { reason: conceptImageStatus().reason });
        } else {
          send("image_generating", { model: generator.model });
          try {
            const result = await generator.generate({ prompt, appName });
            send("concept_image", result);
          } catch (imgErr) {
            send("image_error", {
              message: String((imgErr as Error)?.message || imgErr).slice(0, 200),
            });
          }
        }
      }
      send("done", {});
      res.end();
    } catch (err) {
      if (err instanceof DesignModelUnconfiguredError) {
        send("model_unconfigured", { message: err.message });
      } else {
        logger.warn({ err }, "app-dev design-chat stream failed");
        send("error", { message: String((err as Error)?.message || err).slice(0, 200) });
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  });

  return router;
}

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { designRuns, type DesignRun } from "@paperclipai/db";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  odCreateProject,
  odStartChatAndWait,
  odFetchLatestProjectArtifact,
  persistArtifactHtml,
  type OdRunEvent,
} from "./opendesign-client.js";
import { rasterizeArtifact } from "./design-rasterizer.js";

export type DesignRunsService = ReturnType<typeof createDesignRunsService>;

export type StartDesignRunInput = {
  companyId: string | null;
  skill: string;
  prompt: string;
  agentId?: string;
  designSystemId?: string;
  model?: string;
  params?: Record<string, unknown>;
  outputType?: "html" | "png" | "mp4";
  createdBy?: string;
  idempotencyKey?: string | null;
  presetRunId?: string | null;
};

export function createDesignRunsService(db: Db) {
  async function list(companyId: string | null, limit = 50): Promise<DesignRun[]> {
    if (companyId) {
      return db
        .select()
        .from(designRuns)
        .where(eq(designRuns.companyId, companyId))
        .orderBy(desc(designRuns.createdAt))
        .limit(limit);
    }
    return db.select().from(designRuns).orderBy(desc(designRuns.createdAt)).limit(limit);
  }

  async function get(id: string): Promise<DesignRun | null> {
    const rows = await db.select().from(designRuns).where(eq(designRuns.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async function start(input: StartDesignRunInput): Promise<DesignRun> {
    const agentId = input.agentId ?? (process.env.OD_DEFAULT_AGENT?.trim() || "codex");

    if (input.idempotencyKey) {
      const conditions = [eq(designRuns.idempotencyKey, input.idempotencyKey)];
      if (input.companyId) {
        conditions.push(eq(designRuns.companyId, input.companyId));
      }
      const existing = await db
        .select()
        .from(designRuns)
        .where(and(...conditions))
        .limit(1);
      if (existing[0]) return existing[0];
    }

    const odProjectId = `paperclip-${randomUUID().slice(0, 12)}`;
    const inserted = await db
      .insert(designRuns)
      .values({
        companyId: input.companyId ?? null,
        skill: input.skill,
        agentId,
        designSystemId: input.designSystemId ?? null,
        prompt: input.prompt,
        params: input.params ?? {},
        outputType: input.outputType ?? "html",
        status: "running",
        odProjectId,
        createdBy: input.createdBy ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        presetRunId: input.presetRunId ?? null,
      })
      .returning();
    const row = inserted[0];

    // Fire-and-forget the run. Caller polls /api/design/runs/:id for status.
    void executeRun(row, input, agentId, odProjectId).catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(designRuns)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(designRuns.id, row.id));
    });

    return row;
  }

  async function executeRun(
    row: DesignRun,
    input: StartDesignRunInput,
    agentId: string,
    odProjectId: string,
  ): Promise<void> {
    try {
      await odCreateProject(
        odProjectId,
        `paperclip-${input.skill}-${row.id.slice(0, 8)}`,
        input.skill,
        input.designSystemId,
      );
    } catch (err) {
      // Project may already exist if id collision (unlikely with uuid); rethrow other
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already.*exists|409|duplicate/i.test(msg)) throw err;
    }

    const events: OdRunEvent[] = [];
    const result = await odStartChatAndWait(
      {
        agentId,
        message: input.prompt,
        projectId: odProjectId,
        skillId: input.skill,
        designSystemId: input.designSystemId,
        model: input.model,
      },
      {
        onEvent: (e) => {
          events.push(e);
        },
      },
    );

    let assetPath: string | null = null;
    let assetUrl: string | null = null;
    if (result.artifactHtml) {
      const persisted = await persistArtifactHtml(row.id, result.artifactHtml);
      assetPath = persisted.path;
      assetUrl = persisted.url;
    } else {
      const artifact = await odFetchLatestProjectArtifact(odProjectId);
      if (artifact) {
        const persisted = await persistArtifactHtml(row.id, artifact.html, artifact.name);
        assetPath = persisted.path;
        assetUrl = persisted.url;
      }
    }

    await db
      .update(designRuns)
      .set({
        status: result.status === "completed" ? "completed" : "failed",
        odRunId: result.runId,
        assetPath,
        assetUrl,
        previewUrl: assetUrl,
        error: result.error ?? null,
        tokensIn: result.tokensIn ?? null,
        tokensOut: result.tokensOut ?? null,
        tokenCostUsd: result.totalUsd != null ? String(result.totalUsd) : null,
        completedAt: new Date(),
        metadata: { eventCount: events.length },
      })
      .where(eq(designRuns.id, row.id));

    // Fire-and-forget rasterization. Failure is recorded on the row but
    // does NOT mark the parent run failed — the HTML artifact still exists.
    if (result.status === "completed" && assetPath) {
      void rasterizeRun(row.id, input.skill, assetPath).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(designRuns)
          .set({ rasterStatus: "failed", rasterError: msg })
          .where(eq(designRuns.id, row.id));
      });
    }
  }

  async function rasterizeRun(runId: string, skillId: string, htmlPath: string): Promise<void> {
    await db
      .update(designRuns)
      .set({ rasterStatus: "running" })
      .where(eq(designRuns.id, runId));
    const result = await rasterizeArtifact({ runId, skillId, htmlPath });
    const ok = result.pngPaths.length > 0 || !!result.mp4Path;
    await db
      .update(designRuns)
      .set({
        rasterStatus: ok ? "completed" : "skipped",
        rasterError: ok ? null : result.notes.join("; ") || "no output",
        pngPaths: result.pngPaths,
        mp4Path: result.mp4Path,
      })
      .where(eq(designRuns.id, runId));
  }

  async function readAssetHtml(id: string): Promise<string | null> {
    const row = await get(id);
    if (!row || !row.assetPath) return null;
    try {
      return await fs.readFile(row.assetPath, "utf8");
    } catch {
      return null;
    }
  }

  return { list, get, start, readAssetHtml };
}

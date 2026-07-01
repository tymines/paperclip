import { designRuns, designAssets } from "../packages/db/src/index.js";
import { eq, and, isNotNull, or, sql } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, execSync } from "node:child_process";
import { createDb } from "../packages/db/src/client.js";

async function main() {
  console.log("Connecting to database...");
  const db = createDb({ connectionString: undefined });
  
  const runs = await db.select({
    id: designRuns.id,
    companyId: designRuns.companyId,
    skill: designRuns.skill,
    prompt: designRuns.prompt,
    agentId: designRuns.agentId,
    pngPaths: designRuns.pngPaths,
    mp4Path: designRuns.mp4Path,
    createdAt: designRuns.createdAt,
    metadata: designRuns.metadata,
  }).from(designRuns).where(
    and(
      eq(designRuns.status, "completed"),
      or(
        isNotNull(designRuns.pngPaths),
        isNotNull(designRuns.mp4Path)
      )
    )
  ).orderBy(designRuns.createdAt);

  console.log(`Found ${runs.length} runs with assets`);

  let inserted = 0;
  for (const run of runs) {
    const pngPaths: string[] = Array.isArray(run.pngPaths) ? run.pngPaths : [];
    const mp4Path: string | null = run.mp4Path;

    for (let i = 0; i < pngPaths.length; i++) {
      const p = pngPaths[i];
      if (!p) continue;
      try { await fs.access(p); } catch { continue; }
      const url = `/api/design/runs/${run.id}/asset.png?slide=${i}`;
      await db.insert(designAssets).values({
        runId: run.id,
        companyId: run.companyId,
        kind: "image",
        path: p,
        url,
        slideIndex: i,
        skill: run.skill,
        prompt: run.prompt,
        agentId: run.agentId,
        createdAt: run.createdAt ?? new Date(),
      });
      inserted++;
    }

    if (mp4Path) {
      try { await fs.access(mp4Path); } catch { continue; }
      const url = `/api/design/runs/${run.id}/asset.mp4`;
      await db.insert(designAssets).values({
        runId: run.id,
        companyId: run.companyId,
        kind: "video",
        path: mp4Path,
        url,
        slideIndex: 0,
        skill: run.skill,
        prompt: run.prompt,
        agentId: run.agentId,
        createdAt: run.createdAt ?? new Date(),
      });
      inserted++;
    }
  }

  console.log(`Inserted ${inserted} assets`);
  const total = await db.select({ count: sql<number>`count(*)` }).from(designAssets);
  console.log(`Total design_assets: ${total[0].count}`);
}

main().catch(err => { console.error(err); process.exit(1); });

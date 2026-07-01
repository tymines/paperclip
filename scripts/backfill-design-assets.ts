#!/usr/bin/env tsx
/**
 * Backfill: scan completed design_runs that have pngPaths / mp4Path and
 * insert corresponding rows into design_assets.
 *
 * Usage:
 *    tsx scripts/backfill-design-assets.ts [--dry-run]
 *
 * Dry-run mode prints what it would do without inserting anything.
 */

import { designRuns, designAssets } from "../packages/db/src/index.js";
import { eq, and } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, execSync } from "node:child_process";
import { createDb } from "../packages/db/src/client.js";

// ── helpers ────────────────────────────────────────────────────────────

function assetKind(filename: string): "image" | "video" {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".mp4" ? "video" : "image";
}

async function getImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  // Try ImageMagick identify first
  try {
    const out = execSync(
      `identify -format "%w %h" "${filePath}" 2>/dev/null || echo "0 0"`,
      { encoding: "utf8", timeout: 5000 },
    );
    const parts = out.trim().split(" ");
    if (parts.length >= 2) {
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: w, height: h };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function getVideoDimensions(filePath: string): Promise<{ width: number; height: number; durationMs: number } | null> {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.env.PAPERCLIP_FFPROBE_BIN?.trim() || "ffprobe",
        [
          "-v", "error",
          "-show_entries", "stream=width,height",
          "-show_entries", "format=duration",
          "-of", "csv=p=0",
          filePath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
      child.on("close", (code: number | null) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`ffprobe exit code ${code}`));
      });
      child.on("error", reject);
    });
    const parts = result.split("\n").filter(Boolean);
    if (parts.length >= 2) {
      const dimParts = parts[0].split(",");
      const w = parseInt(dimParts[0], 10);
      const h = parseInt(dimParts[1], 10);
      const dur = parseFloat(parts[1]) * 1000; // seconds → ms
      return {
        width: Number.isFinite(w) ? w : 0,
        height: Number.isFinite(h) ? h : 0,
        durationMs: Number.isFinite(dur) ? Math.round(dur) : 0,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL env var required");
    process.exit(1);
  }

  const db = createDb(connectionString);
  const done = await db
    .select()
    .from(designRuns)
    .where(
      and(
        eq(designRuns.rasterStatus, "completed"),
      ),
    )
    .orderBy(designRuns.createdAt);

  console.log(`Found ${done.length} completed design runs`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const run of done) {
    const pngPaths = Array.isArray(run.pngPaths) ? (run.pngPaths as string[]) : [];
    const mp4Path = run.mp4Path;

    if (pngPaths.length === 0 && !mp4Path) {
      skipped++;
      continue;
    }

    // Check if any assets already exist for this run
    const existing = await db
      .select({ id: designAssets.id })
      .from(designAssets)
      .where(eq(designAssets.runId, run.id))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const skill = run.skill;
    const prompt = run.prompt;
    const agentId = run.agentId;
    const persona = run.metadata && typeof run.metadata === "object"
      ? ((run.metadata as Record<string, unknown>).persona as string ?? null)
      : null;

    // Insert PNG assets
    for (let i = 0; i < pngPaths.length; i++) {
      const p = pngPaths[i];
      try {
        await fs.access(p);
      } catch {
        console.warn(`  ⚠ PNG not found: ${p}`);
        continue;
      }

      const dims = await getImageDimensions(p);
      const rows = [
        {
          companyId: run.companyId,
          runId: run.id,
          kind: "image" as const,
          path: p,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          slideIndex: i,
          skill: skill ?? null,
          prompt: prompt ?? null,
          agentId: agentId ?? null,
          persona: persona as string | null,
        },
      ];

      if (dryRun) {
        console.log(`  [dry-run] would insert PNG: ${p} (${dims?.width ?? "?"}x${dims?.height ?? "?"})`);
      } else {
        try {
          await db.insert(designAssets).values(rows);
          inserted++;
        } catch (err) {
          console.error(`  ✗ failed to insert PNG ${p}: ${err}`);
          errors++;
        }
      }
    }

    // Insert MP4 asset
    if (mp4Path) {
      try {
        await fs.access(mp4Path);
      } catch {
        console.warn(`  ⚠ MP4 not found: ${mp4Path}`);
        continue;
      }

      const vdims = await getVideoDimensions(mp4Path);
      const rows = [
        {
          companyId: run.companyId,
          runId: run.id,
          kind: "video" as const,
          path: mp4Path,
          width: vdims?.width ?? null,
          height: vdims?.height ?? null,
          durationMs: vdims?.durationMs ?? null,
          slideIndex: 0,
          skill: skill ?? null,
          prompt: prompt ?? null,
          agentId: agentId ?? null,
          persona: persona as string | null,
        },
      ];

      if (dryRun) {
        console.log(`  [dry-run] would insert MP4: ${mp4Path}`);
      } else {
        try {
          await db.insert(designAssets).values(rows);
          inserted++;
        } catch (err) {
          console.error(`  ✗ failed to insert MP4 ${mp4Path}: ${err}`);
          errors++;
        }
      }
    }
  }

  console.log("");
  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}, Errors: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main();

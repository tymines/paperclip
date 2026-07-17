/**
 * VFG-R — deterministic perceptual regression diff (spec 4.1/4.6). No LLM.
 *
 * PNG decoding is pure Node (zlib inflate + scanline unfilter) — zero new
 * dependencies, so the lockfile stays untouched. Supports the PNGs our
 * Playwright harness emits: 8-bit, RGB/RGBA, non-interlaced. Anything else
 * fails loudly rather than guessing.
 *
 * Comparison modes (per screen, spec 4.6):
 *   strict  — per-pixel delta; fail ratio threshold.
 *   layout  — 32×32 block-mean comparison (structure over exact pixels).
 *   content — NOT pixel-checked in v1 (needs OCR); returns informational.
 *
 * Regions: `ignore` rects are fully masked. `floating` rects are excluded
 *   from the fail count like ignore, but their activity is measured and
 *   reported separately — honest v1 of positional tolerance; true ±shift
 *   matching is a later refinement, noted in the result.
 *
 * Merge-base baselines (spec 4.6): the server has no git, so ancestry is
 *   approximated deterministically: (1) baseline with commit_sha == the WO's
 *   branch_point_sha if one exists, else (2) newest baseline approved BEFORE
 *   the WO was created, else (3) the screen's current baseline_asset_id.
 *   The chosen rule is recorded in the result for the audit trail.
 */
import { inflateSync } from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { appdevScreenBaselines, appdevScreens } from "@paperclipai/db";
import { uploadsRoot } from "../image-studio/uploads.js";
import { rethrowMigrationPending } from "./gatekeeper.js";

/* ── Minimal PNG decoder ──────────────────────────────────────────────────── */

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes/pixel. */
  pixels: Uint8Array;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (harness emits 8-bit)`);
  if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported PNG color type ${colorType} (RGB/RGBA only)`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[x] = v;
    }
    for (let px = 0; px < width; px++) {
      const s = px * channels;
      const d = (y * width + px) * 4;
      pixels[d] = cur[s];
      pixels[d + 1] = cur[s + 1];
      pixels[d + 2] = cur[s + 2];
      pixels[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, pixels };
}

/* ── Diff engine ──────────────────────────────────────────────────────────── */

export interface Region {
  rect: { x: number; y: number; w: number; h: number };
  kind: "ignore" | "floating";
  note?: string;
}

export interface DiffResult {
  mode: string;
  comparable: boolean;
  reason?: string;
  /** 0–1 fraction of counted pixels/blocks that differ. */
  diffRatio: number;
  /** activity inside floating regions (informational, never fails a screen). */
  floatingActivity: number;
  countedPixels: number;
  threshold: number;
  exceedsThreshold: boolean;
}

const PIXEL_DELTA = 32; // per-channel delta considered "different"
const STRICT_FAIL_RATIO = 0.01; // 1% of counted pixels
const LAYOUT_BLOCK = 32;
const LAYOUT_FAIL_RATIO = 0.08; // 8% of blocks

function inRegion(x: number, y: number, r: Region): boolean {
  return x >= r.rect.x && x < r.rect.x + r.rect.w && y >= r.rect.y && y < r.rect.y + r.rect.h;
}

export function diffImages(
  baseline: DecodedPng,
  candidate: DecodedPng,
  mode: string,
  regions: Region[],
): DiffResult {
  if (mode === "content") {
    return {
      mode, comparable: false, reason: "content mode is informational in v1 (no OCR layer)",
      diffRatio: 0, floatingActivity: 0, countedPixels: 0, threshold: 0, exceedsThreshold: false,
    };
  }
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    return {
      mode, comparable: false,
      reason: `dimension mismatch ${baseline.width}x${baseline.height} vs ${candidate.width}x${candidate.height}`,
      diffRatio: 1, floatingActivity: 0, countedPixels: 0,
      threshold: mode === "layout" ? LAYOUT_FAIL_RATIO : STRICT_FAIL_RATIO, exceedsThreshold: true,
    };
  }
  const ignores = regions.filter((r) => r.kind === "ignore");
  const floats = regions.filter((r) => r.kind === "floating");

  if (mode === "layout") {
    const bx = Math.ceil(baseline.width / LAYOUT_BLOCK);
    const by = Math.ceil(baseline.height / LAYOUT_BLOCK);
    let diffBlocks = 0;
    let counted = 0;
    for (let gy = 0; gy < by; gy++) {
      for (let gx = 0; gx < bx; gx++) {
        const cx = gx * LAYOUT_BLOCK + LAYOUT_BLOCK / 2;
        const cy = gy * LAYOUT_BLOCK + LAYOUT_BLOCK / 2;
        if (ignores.some((r) => inRegion(cx, cy, r)) || floats.some((r) => inRegion(cx, cy, r))) continue;
        let bSum = 0;
        let cSum = 0;
        let n = 0;
        for (let y = gy * LAYOUT_BLOCK; y < Math.min((gy + 1) * LAYOUT_BLOCK, baseline.height); y += 4) {
          for (let x = gx * LAYOUT_BLOCK; x < Math.min((gx + 1) * LAYOUT_BLOCK, baseline.width); x += 4) {
            const i = (y * baseline.width + x) * 4;
            bSum += baseline.pixels[i] + baseline.pixels[i + 1] + baseline.pixels[i + 2];
            cSum += candidate.pixels[i] + candidate.pixels[i + 1] + candidate.pixels[i + 2];
            n++;
          }
        }
        counted++;
        if (n > 0 && Math.abs(bSum - cSum) / n > PIXEL_DELTA * 3) diffBlocks++;
      }
    }
    const ratio = counted ? diffBlocks / counted : 0;
    return {
      mode, comparable: true, diffRatio: ratio, floatingActivity: 0, countedPixels: counted,
      threshold: LAYOUT_FAIL_RATIO, exceedsThreshold: ratio > LAYOUT_FAIL_RATIO,
    };
  }

  // strict
  let counted = 0;
  let diff = 0;
  let floatCounted = 0;
  let floatDiff = 0;
  for (let y = 0; y < baseline.height; y++) {
    for (let x = 0; x < baseline.width; x++) {
      if (ignores.some((r) => inRegion(x, y, r))) continue;
      const i = (y * baseline.width + x) * 4;
      const d =
        Math.abs(baseline.pixels[i] - candidate.pixels[i]) +
        Math.abs(baseline.pixels[i + 1] - candidate.pixels[i + 1]) +
        Math.abs(baseline.pixels[i + 2] - candidate.pixels[i + 2]);
      const isDiff = d > PIXEL_DELTA * 3;
      if (floats.some((r) => inRegion(x, y, r))) {
        floatCounted++;
        if (isDiff) floatDiff++;
        continue;
      }
      counted++;
      if (isDiff) diff++;
    }
  }
  const ratio = counted ? diff / counted : 0;
  return {
    mode, comparable: true, diffRatio: ratio,
    floatingActivity: floatCounted ? floatDiff / floatCounted : 0,
    countedPixels: counted, threshold: STRICT_FAIL_RATIO, exceedsThreshold: ratio > STRICT_FAIL_RATIO,
  };
}

/* ── Baseline selection (merge-base approximation) ────────────────────────── */

export async function selectBaseline(
  db: Db,
  screen: { id: string; baselineAssetId: string | null },
  workOrder: { branchPointSha: string | null; createdAt: Date } | null,
): Promise<{ assetId: string | null; rule: string }> {
  try {
    if (workOrder?.branchPointSha) {
      const [exact] = await db
        .select()
        .from(appdevScreenBaselines)
        .where(and(eq(appdevScreenBaselines.screenId, screen.id), eq(appdevScreenBaselines.commitSha, workOrder.branchPointSha)))
        .orderBy(desc(appdevScreenBaselines.approvedAt))
        .limit(1);
      if (exact) return { assetId: exact.assetId, rule: "branch_point_sha exact match" };
    }
    if (workOrder) {
      const [temporal] = await db
        .select()
        .from(appdevScreenBaselines)
        .where(and(eq(appdevScreenBaselines.screenId, screen.id), lte(appdevScreenBaselines.approvedAt, workOrder.createdAt)))
        .orderBy(desc(appdevScreenBaselines.approvedAt))
        .limit(1);
      if (temporal) return { assetId: temporal.assetId, rule: "newest baseline approved before WO start (temporal merge-base approximation)" };
    }
    const [latest] = await db
      .select()
      .from(appdevScreenBaselines)
      .where(eq(appdevScreenBaselines.screenId, screen.id))
      .orderBy(desc(appdevScreenBaselines.approvedAt))
      .limit(1);
    if (latest) return { assetId: latest.assetId, rule: "latest approved baseline" };
  } catch (err) {
    rethrowMigrationPending(err);
  }
  return { assetId: screen.baselineAssetId, rule: "screens.baseline_asset_id fallback (no versioned baselines)" };
}

/* ── Asset loading ────────────────────────────────────────────────────────── */

export async function loadAssetPng(storagePath: string): Promise<DecodedPng> {
  const root = uploadsRoot();
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(path.resolve(root))) throw new Error("asset path escapes uploads root");
  return decodePng(await fs.readFile(abs));
}

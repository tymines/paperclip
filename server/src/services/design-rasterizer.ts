/**
 * HTML → PNG / MP4 rasterizer for design_runs artifacts.
 *
 * We don't pull in puppeteer — Chrome's `--headless=new --screenshot=...`
 * CLI is enough for the shapes we need, and macOS already has multiple
 * Chromium binaries cached (puppeteer + playwright). MP4 export piggybacks
 * on a frame-sequence + ffmpeg concat for Hyperframes-style motion artifacts.
 *
 * Output kind is driven by the skill catalog, not the user:
 *   - "carousel"  → N×PNG, 1080×1080, one per <section data-slide> / .slide
 *   - "poster"    → 1×PNG at natural intrinsic size (default 1080×1350)
 *   - "card"      → 1×PNG at 1080×1080
 *   - "magazine"  → 1×PNG at 1080×1620 (4:6 long)
 *   - "email"     → 1×PNG at 800×1200
 *   - "landing"   → 1×PNG at 1280×1600
 *   - "motion"    → MP4 via 5s × 30fps frame sequence + ffmpeg concat
 *
 * Falls back gracefully: if Chrome can't be located, marks raster_status
 * = "skipped" with a reason rather than failing the parent run.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type RasterKind =
  | "carousel"
  | "poster"
  | "card"
  | "magazine"
  | "email"
  | "landing"
  | "motion"
  | "auto";

export type RasterResult = {
  kind: RasterKind;
  pngPaths: string[];
  mp4Path: string | null;
  durationMs: number;
  notes: string[];
};

export type RasterDims = { width: number; height: number };

const DIM_BY_KIND: Record<Exclude<RasterKind, "auto">, RasterDims> = {
  carousel: { width: 1080, height: 1080 },
  poster: { width: 1080, height: 1350 },
  card: { width: 1080, height: 1080 },
  magazine: { width: 1080, height: 1620 },
  email: { width: 800, height: 1200 },
  landing: { width: 1280, height: 1600 },
  motion: { width: 1080, height: 1080 },
};

/**
 * Per-skill output-kind map. Keys are open-design skill ids; values are the
 * RasterKind we should produce. Skills not listed fall through to inferKind
 * (which sniffs the HTML).
 */
const SKILL_KIND_MAP: Record<string, RasterKind> = {
  // social carousels
  "card-xiaohongshu": "carousel",
  "card-twitter": "card",
  "social-x-post-card": "card",
  "social-reddit-card": "card",
  "social-instagram-feed": "carousel",
  "social-linkedin-card": "card",
  // posters / hero
  "poster-hero": "poster",
  "poster-event": "poster",
  // magazine / long
  "article-magazine": "magazine",
  // email
  "email-marketing": "email",
  "email-newsletter": "email",
  // landing pages
  "landing-saas": "landing",
  "landing-product": "landing",
  "landing-portfolio": "landing",
  // motion / hyperframes
  "hyperframes-template": "motion",
  "8-bit-orbit-video-template": "motion",
};

export function rasterKindForSkill(skillId: string): RasterKind {
  return SKILL_KIND_MAP[skillId] ?? "auto";
}

function inferKindFromHtml(html: string): Exclude<RasterKind, "auto"> {
  const lc = html.toLowerCase();
  if (/data-hyperframes|hyperframes\s*=|<video|@keyframes\s+\w+/.test(lc)) {
    if (/data-slide|class=["'][^"']*\bslide\b/.test(lc)) return "carousel";
    return "motion";
  }
  if (/data-slide|class=["'][^"']*\bslide\b/.test(lc)) return "carousel";
  if (/landing|hero.*cta|features-grid/.test(lc)) return "landing";
  if (/email-body|mso-table|<center>/.test(lc)) return "email";
  return "card";
}

function resolveKind(skillId: string | null, html: string): Exclude<RasterKind, "auto"> {
  const fromSkill = skillId ? SKILL_KIND_MAP[skillId] : undefined;
  if (fromSkill && fromSkill !== "auto") return fromSkill;
  return inferKindFromHtml(html);
}

async function findChromeBinary(): Promise<string | null> {
  if (process.env.PAPERCLIP_CHROME_BIN && process.env.PAPERCLIP_CHROME_BIN.trim()) {
    return process.env.PAPERCLIP_CHROME_BIN.trim();
  }
  const home = os.homedir();
  const candidates = [
    // Puppeteer-installed Chrome for Testing (latest first)
    path.join(
      home,
      ".cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
    path.join(
      home,
      ".cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
    // Playwright chromium
    path.join(
      home,
      "Library/Caches/ms-playwright/chromium-1208/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ),
    path.join(
      home,
      "Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-mac/headless_shell",
    ),
    // System Chrome / Edge
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux fallbacks
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* keep searching */
    }
  }
  return null;
}

async function runChrome(args: string[], timeoutMs = 90_000): Promise<{ code: number; stderr: string }> {
  const bin = await findChromeBinary();
  if (!bin) throw new Error("No Chrome/Chromium binary found");
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const tHandle = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`chrome timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      clearTimeout(tHandle);
      resolve({ code: code ?? 1, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(tHandle);
      reject(err);
    });
  });
}

async function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<{ code: number; stderr: string }> {
  const bin = process.env.PAPERCLIP_FFMPEG_BIN?.trim() || "ffmpeg";
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const tHandle = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      clearTimeout(tHandle);
      resolve({ code: code ?? 1, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(tHandle);
      reject(err);
    });
  });
}

const CHROME_BASE_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
];

/**
 * Generate a wrapper HTML that hides all but the Nth slide. The wrapper
 * loads the original artifact as the document body via document.write,
 * then injects CSS to hide siblings of the requested slide.
 */
async function writeSlideWrapper(
  originalHtmlPath: string,
  slideIndex: number,
  tmpDir: string,
): Promise<string> {
  const html = await fs.readFile(originalHtmlPath, "utf8");
  const wrapper = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  /* Slide isolation — keep only the Nth .slide / [data-slide] visible. */
  [data-slide]:not([data-slide-active]),
  .slide:not(.slide-active),
  section.slide:not(.slide-active) { display: none !important; }
</style>
<script>
window.addEventListener("DOMContentLoaded", function () {
  var idx = ${slideIndex};
  var slides = document.querySelectorAll("[data-slide], .slide, section.slide");
  if (slides.length === 0) return;
  var pick = slides[Math.min(idx, slides.length - 1)];
  pick.setAttribute("data-slide-active", "true");
  pick.classList.add("slide-active");
});
</script>
</head>
<body>${html.replace(/^[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "")}</body></html>`;
  const filename = `slide-${slideIndex}.html`;
  const out = path.join(tmpDir, filename);
  await fs.writeFile(out, wrapper, "utf8");
  return out;
}

async function countSlides(html: string): Promise<number> {
  const matches = html.match(/data-slide(?!=)|class=["'][^"']*\bslide\b/g);
  if (!matches) return 1;
  // Best-effort dedupe: count distinct slide blocks, not the css class hits.
  const sectionMatches = html.match(/<section[^>]*(?:data-slide|class=["'][^"']*\bslide\b)[^>]*>/g);
  if (sectionMatches) return Math.max(1, Math.min(sectionMatches.length, 20));
  return Math.min(matches.length, 20);
}

/**
 * Public entry: rasterize an artifact HTML file.
 *
 * Returns the paths of produced PNGs (in slide order) and optional MP4.
 * On failure, returns { pngPaths: [], mp4Path: null } and includes a note;
 * caller decides whether to fail the parent run.
 */
export async function rasterizeArtifact(opts: {
  runId: string;
  skillId: string | null;
  htmlPath: string;
  outDir?: string;
}): Promise<RasterResult> {
  const started = Date.now();
  const notes: string[] = [];
  const outDir =
    opts.outDir ?? path.join(os.homedir(), ".paperclip", "design-runs", opts.runId);
  await fs.mkdir(outDir, { recursive: true });

  const html = await fs.readFile(opts.htmlPath, "utf8");
  const kind = resolveKind(opts.skillId, html);
  const dims = DIM_BY_KIND[kind];

  const pngPaths: string[] = [];
  let mp4Path: string | null = null;

  if (kind === "motion") {
    // Frame sequence + ffmpeg. We render 30 frames over 5s of virtual time.
    const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), `pc-frames-${opts.runId}-`));
    try {
      const fps = 30;
      const totalMs = 5_000;
      const frameStep = Math.round(1000 / fps);
      const url = `file://${opts.htmlPath}`;
      for (let i = 0; i < (totalMs / frameStep); i += 1) {
        const framePath = path.join(frameDir, `f-${String(i).padStart(4, "0")}.png`);
        const budget = (i + 1) * frameStep;
        const res = await runChromeWithRetry(
          [
            ...CHROME_BASE_ARGS,
            `--window-size=${dims.width},${dims.height}`,
            `--screenshot=${framePath}`,
            `--virtual-time-budget=${budget}`,
            url,
          ],
          90_000,
        );
        if (res.code !== 0) {
          notes.push(`chrome frame ${i} rc=${res.code}: ${res.stderr.slice(0, 120)}`);
          break;
        }
      }
      const captured = (await fs.readdir(frameDir)).filter((f) => f.endsWith(".png"));
      if (captured.length >= 2) {
        mp4Path = path.join(outDir, "artifact.mp4");
        const ff = await runFfmpeg(
          [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            path.join(frameDir, "f-%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            mp4Path,
          ],
          60_000,
        );
        if (ff.code !== 0) {
          notes.push(`ffmpeg rc=${ff.code}: ${ff.stderr.slice(0, 200)}`);
          mp4Path = null;
        }
      } else {
        notes.push("not enough frames captured for mp4");
      }
      // Also publish the first frame as a poster PNG.
      const firstFrame = captured.sort()[0];
      if (firstFrame) {
        const posterPath = path.join(outDir, "artifact-poster.png");
        await fs.copyFile(path.join(frameDir, firstFrame), posterPath);
        pngPaths.push(posterPath);
      }
    } finally {
      await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } else if (kind === "carousel") {
    const slideCount = await countSlides(html);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `pc-slides-${opts.runId}-`));
    try {
      for (let i = 0; i < slideCount; i += 1) {
        const wrapperPath = await writeSlideWrapper(opts.htmlPath, i, tmpDir);
        const outPng = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
        const res = await runChromeWithRetry(
          [
            ...CHROME_BASE_ARGS,
            `--window-size=${dims.width},${dims.height}`,
            `--screenshot=${outPng}`,
            `--virtual-time-budget=1500`,
            `file://${wrapperPath}`,
          ],
          90_000,
        );
        if (res.code === 0) {
          pngPaths.push(outPng);
        } else {
          notes.push(`slide ${i + 1} rc=${res.code}: ${res.stderr.slice(0, 120)}`);
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (pngPaths.length === 0) {
      notes.push("no carousel slides rendered; falling back to single full-page PNG");
      const fallback = path.join(outDir, "artifact.png");
      const res = await runChromeWithRetry(
        [
          ...CHROME_BASE_ARGS,
          `--window-size=${dims.width},${dims.height}`,
          `--screenshot=${fallback}`,
          `--virtual-time-budget=1500`,
          `file://${opts.htmlPath}`,
        ],
        90_000,
      );
      if (res.code === 0) pngPaths.push(fallback);
    }
  } else {
    const outPng = path.join(outDir, "artifact.png");
    const res = await runChromeWithRetry(
      [
        ...CHROME_BASE_ARGS,
        `--window-size=${dims.width},${dims.height}`,
        `--screenshot=${outPng}`,
        `--virtual-time-budget=2000`,
        `file://${opts.htmlPath}`,
      ],
      90_000,
    );
    if (res.code === 0) {
      pngPaths.push(outPng);
    } else {
      notes.push(`chrome rc=${res.code}: ${res.stderr.slice(0, 200)}`);
    }
  }

  return {
    kind,
    pngPaths,
    mp4Path,
    durationMs: Date.now() - started,
    notes,
  };
}

/**
 * Probe — returns whether rasterization will work in this environment.
 * Used at startup to log a warning instead of failing every run.
 */
/** Retry runChrome with exponential backoff: 5s, 15s, 45s */
async function runChromeWithRetry(
  args: string[],
  timeoutMs = 90_000,
  maxRetries = 3,
): Promise<{ code: number; stderr: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await runChrome(args, timeoutMs);
      if (res.code === 0) return res;
      if (attempt < maxRetries) {
        const delay = [5_000, 15_000, 45_000][attempt] ?? 60_000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        return res;
      }
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = [5_000, 15_000, 45_000][attempt] ?? 60_000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  // Unreachable but ts needs it
  return { code: 1, stderr: "max retries exceeded" };
}

export async function rasterizerProbe(): Promise<{
  chrome: string | null;
  ffmpeg: boolean;
}> {
  const chrome = await findChromeBinary();
  const ffmpeg = await new Promise<boolean>((resolve) => {
    const child = spawn(process.env.PAPERCLIP_FFMPEG_BIN?.trim() || "ffmpeg", ["-version"], {
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
  return { chrome, ffmpeg };
}

// Re-export id helper for tests
export const _internal = {
  resolveKind,
  countSlides,
  newRunId: () => randomUUID(),
};

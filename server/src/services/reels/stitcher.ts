/**
 * Stitcher — FFmpeg wrapper that concatenates video clips into a final reel.
 *
 * Downloads each clip URL → temp file → ffmpeg concat + scale to 1080x1920 →
 * saves to /workspace/reels/<reelId>/final.mp4. Returns the file path + URL.
 *
 * Music mixing (per the spec) is a follow-on enhancement — start with
 * silent reels, add audio in v1.1.
 */
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import type { Reel, ReelScene } from "@paperclipai/db";

const execFileAsync = promisify(execFile);

const REELS_OUTPUT_DIR =
  process.env.REELS_OUTPUT_DIR ?? path.join(os.homedir(), ".paperclip/reels");

export type StitchResult = {
  url: string;
  localPath: string;
  durationSeconds: number;
  totalCostUsd: number;
};

export async function stitchReel(
  reel: Reel,
  scenes: ReelScene[],
): Promise<StitchResult> {
  // Filter scenes that have completed video clips, sort by index
  const ready = scenes
    .filter((s) => s.videoClipUrl)
    .sort((a, b) => a.sceneIndex - b.sceneIndex);

  if (ready.length === 0) {
    throw new Error("no scenes with video clips ready for stitching");
  }

  // Create per-reel working directory
  const reelDir = path.join(REELS_OUTPUT_DIR, reel.id);
  await fs.mkdir(reelDir, { recursive: true });

  const clipPaths: string[] = [];

  // Download each video clip to disk
  for (const scene of ready) {
    const clipPath = path.join(reelDir, `clip_${scene.sceneIndex}.mp4`);
    if (!(await fileExists(clipPath))) {
      console.log(`[stitcher] downloading scene ${scene.sceneIndex}...`);
      await downloadToFile(scene.videoClipUrl!, clipPath);
    }
    clipPaths.push(clipPath);
  }

  // Build FFmpeg concat list
  const concatListPath = path.join(reelDir, "concat_list.txt");
  await fs.writeFile(
    concatListPath,
    clipPaths.map((p) => `file '${p}'`).join("\n"),
  );

  // Target dimensions from aspectRatio
  const { width, height } = aspectRatioToPixels(reel.aspectRatio);
  const outputPath = path.join(reelDir, "final.mp4");

  const ffmpegArgs = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-an", // no audio for v1; music in v1.1
    outputPath,
  ];

  console.log(`[stitcher] ffmpeg ${ffmpegArgs.join(" ")}`);
  await execFileAsync("ffmpeg", ffmpegArgs, { maxBuffer: 1024 * 1024 * 10 });

  // Calculate total duration and cost
  const totalDurationSeconds = ready.reduce(
    (sum, s) => sum + parseFloat(s.sceneDurationSeconds.toString()),
    0,
  );
  const totalCostUsd = ready.reduce((sum, s) => {
    const kf = parseFloat(s.keyframeCostUsd?.toString() ?? "0");
    const vid = parseFloat(s.videoCostUsd?.toString() ?? "0");
    return sum + kf + vid;
  }, 0);

  return {
    url: pathToServeUrl(outputPath, reel.id),
    localPath: outputPath,
    durationSeconds: totalDurationSeconds,
    totalCostUsd,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`download failed ${r.status}: ${url}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(dest, buf);
}

function aspectRatioToPixels(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default:
      return { width: 1080, height: 1920 };
  }
}

function pathToServeUrl(localPath: string, reelId: string): string {
  // Paperclip already has an upload-serving path. Mount reels under a known prefix.
  // TODO: wire to the actual static-file route. For now, return a placeholder URL.
  const filename = path.basename(localPath);
  return `/api/reels/files/${reelId}/${filename}`;
}

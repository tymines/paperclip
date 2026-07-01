/**
 * Video clip generator — fires image-to-video for each scene's keyframe.
 *
 * Same shape as keyframe-generator but goes through video-providers/.
 * Returns true when all scenes have video_ready status.
 */
import type { Db } from "@paperclipai/db";
import type { Reel, ReelScene } from "@paperclipai/db";
import { reelScenes } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { getVideoProvider, DEFAULT_VIDEO_PROVIDER_HOST } from "./video-providers/index.js";
// Ensure providers register themselves at import time
import "./video-providers/atlascloud.js";

export async function generateVideoClips(
  db: Db,
  reel: Reel,
  scenes: ReelScene[],
): Promise<boolean> {
  const provider = getVideoProvider(DEFAULT_VIDEO_PROVIDER_HOST);
  if (!provider) {
    throw new Error(`video provider ${DEFAULT_VIDEO_PROVIDER_HOST} not registered`);
  }

  let allReady = true;

  for (const scene of scenes) {
    if (scene.videoClipUrl) continue; // done
    if (!scene.keyframeImageUrl) {
      // can't make video without keyframe
      allReady = false;
      continue;
    }

    if (!scene.videoJobId) {
      // Submit
      try {
        const { jobId, estimatedCostUsd } = await provider.submit({
          imageUrl: scene.keyframeImageUrl,
          motionPrompt: scene.motionHint ?? scene.description,
          durationSeconds: parseFloat(scene.sceneDurationSeconds.toString()),
          aspectRatio: reel.aspectRatio as "9:16" | "16:9" | "1:1",
        });
        await db
          .update(reelScenes)
          .set({
            videoJobId: jobId,
            videoProviderHost: provider.host,
            videoModel: "bytedance/seedance-v1.5-pro/image-to-video",
            status: "video_submitted",
            updatedAt: new Date(),
          })
          .where(eq(reelScenes.id, scene.id));
      } catch (err) {
        await db
          .update(reelScenes)
          .set({
            status: "failed",
            errorMessage: `submit failed: ${(err as Error).message}`,
            updatedAt: new Date(),
          })
          .where(eq(reelScenes.id, scene.id));
      }
      allReady = false;
      continue;
    }

    // Poll
    try {
      const result = await provider.poll(scene.videoJobId);
      if (result.status === "completed") {
        await db
          .update(reelScenes)
          .set({
            videoClipUrl: result.videoUrl,
            videoCostUsd: result.actualCostUsd?.toString() ?? null,
            status: "video_ready",
            updatedAt: new Date(),
          })
          .where(eq(reelScenes.id, scene.id));
      } else if (result.status === "failed") {
        await db
          .update(reelScenes)
          .set({
            status: "failed",
            errorMessage: result.error,
            updatedAt: new Date(),
          })
          .where(eq(reelScenes.id, scene.id));
      } else {
        allReady = false;
      }
    } catch (err) {
      console.error(`[video-clip-generator] poll failed for scene ${scene.id}:`, err);
      allReady = false;
    }
  }

  return allReady;
}

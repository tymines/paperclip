/**
 * Keyframe generator — fires image gen for each scene's keyframe_prompt.
 *
 * Reuses the existing image-providers/ abstraction. Picks provider based on
 * persona content rating + cost preferences (defaults to WaveSpeed Klein
 * for cheap SFW, RunPod self-hosted Klein for explicit personas).
 *
 * Returns true when all scenes have keyframe_ready status.
 */
import type { Db } from "@paperclipai/db";
import type { Reel, ReelScene } from "@paperclipai/db";
import { reelScenes } from "@paperclipai/db";
import { eq } from "drizzle-orm";

/**
 * Idempotent: for each scene without a keyframe, submit; for each in-flight,
 * poll. Updates reel_scenes rows in place.
 *
 * Returns true when all scenes have keyframeImageUrl set.
 */
export async function generateKeyframes(
  db: Db,
  reel: Reel,
  scenes: ReelScene[],
): Promise<boolean> {
  let allReady = true;

  for (const scene of scenes) {
    if (scene.keyframeImageUrl) continue; // already done

    if (!scene.keyframeJobId) {
      // Submit new keyframe gen
      // TODO: wire to image-providers/ — pseudo-code shows shape
      // const provider = getProvider("wavespeedai"); // or runpod for explicit
      // const { jobId, estimatedCost } = await provider.submit({
      //   prompt: scene.keyframePrompt,
      //   aspectRatio: reel.aspectRatio,
      //   model: "wavespeed-ai/flux-2-klein-9b/text-to-image-lora",
      //   loras: pickPersonaLoras(reel.personaId),  // Raven-Klein LoRA when trained
      // });
      // await db
      //   .update(reelScenes)
      //   .set({
      //     keyframeJobId: jobId,
      //     keyframeProviderHost: "wavespeedai",
      //     status: "keyframe_submitted",
      //     updatedAt: new Date(),
      //   })
      //   .where(eq(reelScenes.id, scene.id));
      allReady = false;
      continue;
    }

    // Poll in-flight job
    // TODO: const result = await provider.poll(scene.keyframeJobId);
    // if (result.status === "completed") {
    //   await db
    //     .update(reelScenes)
    //     .set({
    //       keyframeImageUrl: result.imageUrl,
    //       keyframeCostUsd: result.actualCostUsd?.toString(),
    //       status: "keyframe_ready",
    //       updatedAt: new Date(),
    //     })
    //     .where(eq(reelScenes.id, scene.id));
    // } else if (result.status === "failed") {
    //   await db
    //     .update(reelScenes)
    //     .set({
    //       status: "failed",
    //       errorMessage: result.error,
    //       updatedAt: new Date(),
    //     })
    //     .where(eq(reelScenes.id, scene.id));
    // }
    allReady = false;
  }

  return allReady;
}

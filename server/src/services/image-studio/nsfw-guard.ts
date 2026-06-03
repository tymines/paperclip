/**
 * NSFW content-rating guard.
 *
 * Sidney's NSFW LoRA (trigger word `sidney_nsfw`) produces explicit-rated
 * output. Its training job is tagged `content_rating='explicit'` in
 * lora_training_jobs (see migration 0113). This guard is the publish-time
 * enforcement: explicit-rated media must never reach SFW-only surfaces
 * (Instagram, TikTok).
 *
 * IMPORTANT — fail-open by design: posts with no rating signal are treated as
 * allowed, so existing untagged posts are unaffected. The guard only blocks
 * when a post is *explicitly* marked explicit. For it to actually fire, the
 * image-gen → social pipeline must stamp the post's metadata with a rating
 * (or the nsfw trigger word) when it attaches media from an explicit LoRA.
 *
 * TODO(tyler): wire the gen→post pipeline to set
 *   post.metadata.contentRating = 'explicit'  (or .triggerWord = 'sidney_nsfw')
 * when an image generated from the Sidney NSFW persona is attached to a post.
 */

/** Platforms that reject explicit content outright. */
export const SFW_ONLY_PLATFORMS = new Set<string>(["instagram", "tiktok"]);

export function isPlatformSfwOnly(platform: string): boolean {
  return SFW_ONLY_PLATFORMS.has(platform);
}

export type ContentRating = "sfw" | "explicit";

/**
 * Extract a content-rating signal from a post's metadata. Recognises an
 * explicit `contentRating`/`content_rating` field, an `nsfw: true` flag, or an
 * nsfw-suffixed LoRA trigger word. Returns null when no signal is present.
 */
export function metadataContentRating(
  metadata: Record<string, unknown> | null | undefined,
): ContentRating | null {
  if (!metadata) return null;
  const rating = metadata.contentRating ?? metadata.content_rating;
  if (rating === "explicit" || rating === "sfw") return rating;
  if (metadata.nsfw === true) return "explicit";
  const trigger = metadata.triggerWord ?? metadata.trigger_word;
  if (typeof trigger === "string" && /nsfw/i.test(trigger)) return "explicit";
  return null;
}

export interface GuardVerdict {
  blocked: boolean;
  reason?: string;
}

/**
 * Decide whether a post may be published to a platform. Blocks explicit-rated
 * content on SFW-only platforms; otherwise allows.
 */
export function evaluateNsfwGuard(
  platform: string,
  metadata: Record<string, unknown> | null | undefined,
): GuardVerdict {
  if (!isPlatformSfwOnly(platform)) return { blocked: false };
  if (metadataContentRating(metadata) === "explicit") {
    return {
      blocked: true,
      reason: `explicit-rated content is not permitted on ${platform}`,
    };
  }
  return { blocked: false };
}

import type { GenerationTickResult } from "../replicate-generator.js";

type SanitizedGenerationLogger = {
  warn(fields: Record<string, unknown>, message: string): void;
};

export type GenerationTickSource = "enqueue" | "startup" | "scheduled" | "shutdown";

/**
 * Emit only fixed lifecycle counters. Never spread a provider result/error or
 * attach job ids, prompts, handles, URLs, paths, assets, or secrets.
 */
export function logGenerationTickWarnings(
  log: SanitizedGenerationLogger,
  result: GenerationTickResult,
  source: GenerationTickSource,
): void {
  if (
    result.failed === 0 &&
    result.pollDeferred === 0 &&
    result.quarantinedSubmissions === 0 &&
    result.quarantinedLandings === 0
  ) {
    return;
  }
  log.warn(
    {
      source,
      failed: result.failed,
      pollDeferred: result.pollDeferred,
      quarantinedSubmissions: result.quarantinedSubmissions,
      quarantinedLandings: result.quarantinedLandings,
    },
    "image-studio generation tick completed with failed, deferred, or quarantined work",
  );
}

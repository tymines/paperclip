/**
 * Gym Studio scoring utilities.
 * Normalizes, aggregates, and computes drift between evaluation scores.
 */

export interface ScoreEntry {
  testCaseId: string;
  score: number;
  reasoning: string;
  latencyMs: number;
}

/**
 * Normalize a raw score to 0-100 integer scale.
 * Accepts scores in range 0-100 (int) or 0.0-1.0 (float).
 */
export function normalizeScore(raw: number): number {
  if (raw >= 0 && raw <= 1) {
    return Math.round(raw * 100);
  }
  if (raw >= 0 && raw <= 100) {
    return Math.round(raw);
  }
  // Clamp out-of-range values
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/**
 * Aggregate scores into a single overall score (0-100).
 * Uses weighted averaging if weights are provided.
 */
export function aggregateScores(scores: ScoreEntry[]): number {
  if (!scores.length) return 0;
  const sum = scores.reduce((acc, s) => acc + s.score, 0);
  return Math.round(sum / scores.length);
}

/**
 * Compute drift between two sets of scores.
 * Returns the mean absolute difference between paired scores, as a percentage.
 */
export function computeDrift(
  baseline: ScoreEntry[],
  current: ScoreEntry[],
): number {
  const baselineMap = new Map(baseline.map((s) => [s.testCaseId, s.score]));
  const diffs: number[] = [];
  for (const cur of current) {
    const base = baselineMap.get(cur.testCaseId);
    if (base !== undefined) {
      diffs.push(Math.abs(cur.score - base));
    }
  }
  if (!diffs.length) return 0;
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
}

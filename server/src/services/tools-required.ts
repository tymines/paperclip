/**
 * tools-required manifest — Part B / Phases 1–2 of project-scoped dynamic tool
 * loading (see dynamic-tool-loading-plan.md).
 *
 * Hermes appends a fenced ```tools-required``` JSON block to its FINAL PLAN
 * (brainstorm-kickoff.ts). This module parses that block out of the plan
 * artifact so the Hermes->Ares handoff can attach it verbatim onto the
 * delegation `metadata` (metadata.tools_required), which already rides
 * payload.metadata to {bridge}/jarvis/dispatch with NO transport/schema change.
 *
 * Contract: the manifest is OPTIONAL and additive. An absent or malformed block
 * yields `null` — callers fall back to the lean context7-only baseline and the
 * build is never blocked. Only `version` is required; every other field is
 * normalized to a safe default.
 */
import { logger } from "../middleware/logger.js";

export interface ToolsRequiredManifest {
  version: number;
  /** MCP servers to activate for this job (drives the bridge activate call). */
  servers: string[];
  /** Skill names to load (Level-2) for the worker beyond baseline. */
  skills: string[];
  /** Optional explicit tool-name allowlist (-> gateway pluginToolAllowlist). */
  tools_allow: string[];
  /** Optional subtractive denylist (-> gateway pluginToolDenylist). */
  tools_deny: string[];
  /** What "reset" returns to. Defaults to ["context7"]. */
  baseline_servers: string[];
  /** reset-to-baseline (default) | keep (debug only). */
  teardown: "reset-to-baseline" | "keep";
  /** Free-text rationale (logged, not enforced). */
  reason: string;
  /** Hard expiry so a crashed worker can't leave a session hot. */
  ttl_seconds: number;
}

const DEFAULT_BASELINE_SERVERS = ["context7"];
const DEFAULT_TTL_SECONDS = 1800;

// Matches a fenced block tagged `tools-required` (optionally with surrounding
// whitespace), capturing the inner JSON. Non-greedy body, dot-matches-newline.
const TOOLS_REQUIRED_FENCE_RE =
  /```[ \t]*tools-required[ \t]*\r?\n([\s\S]*?)```/i;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Normalize a parsed JSON object into a fully-populated manifest, applying the
 * documented defaults. Returns null if `version` is not a positive number.
 */
export function normalizeManifest(raw: unknown): ToolsRequiredManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const version =
    typeof obj.version === "number" && Number.isFinite(obj.version)
      ? obj.version
      : NaN;
  if (!Number.isFinite(version) || version < 1) return null;

  const teardown = obj.teardown === "keep" ? "keep" : "reset-to-baseline";

  const baseline = asStringArray(obj.baseline_servers);
  const ttlRaw = obj.ttl_seconds;
  const ttl_seconds =
    typeof ttlRaw === "number" && Number.isFinite(ttlRaw) && ttlRaw > 0
      ? Math.floor(ttlRaw)
      : DEFAULT_TTL_SECONDS;

  return {
    version,
    servers: asStringArray(obj.servers),
    skills: asStringArray(obj.skills),
    tools_allow: asStringArray(obj.tools_allow),
    tools_deny: asStringArray(obj.tools_deny),
    baseline_servers: baseline.length ? baseline : [...DEFAULT_BASELINE_SERVERS],
    teardown,
    reason: typeof obj.reason === "string" ? obj.reason : "",
    ttl_seconds,
  };
}

/**
 * Extract + validate the `tools-required` manifest from a plan artifact.
 *
 * @returns the normalized manifest, or null when the block is absent or
 *          malformed (logged at debug/warn; never throws).
 */
export function parseToolsRequired(
  text: string | null | undefined,
): ToolsRequiredManifest | null {
  if (!text || typeof text !== "string") return null;
  const match = TOOLS_REQUIRED_FENCE_RE.exec(text);
  if (!match) return null;

  const body = match[1]?.trim();
  if (!body) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    logger.warn(
      { err, snippet: body.slice(0, 200) },
      "tools-required: fenced block found but JSON.parse failed; ignoring (baseline)",
    );
    return null;
  }

  const manifest = normalizeManifest(parsed);
  if (!manifest) {
    logger.warn(
      { snippet: body.slice(0, 200) },
      "tools-required: block parsed but invalid (missing version?); ignoring (baseline)",
    );
    return null;
  }
  return manifest;
}

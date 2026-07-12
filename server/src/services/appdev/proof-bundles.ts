/**
 * Proof-bundle ingestion (spec 2.6, 4.3, Part 8).
 *
 * - Payloads are verbatim blobs — never summarized. Proof, not prose.
 * - A secret-pattern scrubber runs on ingest and REJECTS bundles that trip it
 *   (spec Part 8: "no key material ever renders in this tab").
 * - UI work orders: a build bundle without a screenshot_set is invalid, and a
 *   screenshot_set without a populated self_check is invalid (spec 4.3).
 * - This is the post-back seam: the external pipeline (or Tyler, manually)
 *   POSTs bundles here. A future dispatcher posts to the same endpoint.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { appdevProofBundles, appdevScreens, appdevWorkOrders } from "@paperclipai/db";
import { rethrowMigrationPending } from "./gatekeeper.js";

export const PROOF_BUNDLE_KINDS = [
  "build",
  "test",
  "deploy",
  "screenshot_set",
  "release",
  "misc",
] as const;
export type ProofBundleKind = (typeof PROOF_BUNDLE_KINDS)[number];

/* ── Secret scrubber ──────────────────────────────────────────────────────── */

/** Patterns that indicate leaked key material. Conservative: reject, never store. */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "openai_style_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "bearer_header", re: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { name: "env_assignment_key", re: /\b(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*['"]?[A-Za-z0-9+/._-]{16,}/i },
];

export interface SecretScanResult {
  clean: boolean;
  hits: string[]; // pattern names only — never the matched text
}

export function scanForSecrets(text: string): SecretScanResult {
  const hits: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) hits.push(name);
  }
  return { clean: hits.length === 0, hits };
}

/* ── Ingestion ────────────────────────────────────────────────────────────── */

export class ProofBundleRejectedError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProofBundleRejectedError";
  }
}

export interface SubmitProofBundleInput {
  companyId: string;
  appId: string;
  workOrderId?: string;
  kind: ProofBundleKind;
  payload?: Record<string, unknown>;
  screenshotAssetIds?: string[];
  /** Map of screen_tag → asset id/path — used for completeness checking. */
  screenshotsByTag?: Record<string, string>;
  selfCheck?: Record<string, unknown>;
  submittedBy: string;
}

export async function submitProofBundle(db: Db, input: SubmitProofBundleInput) {
  if (!PROOF_BUNDLE_KINDS.includes(input.kind)) {
    throw new ProofBundleRejectedError(`Unknown bundle kind: ${input.kind}`);
  }

  // Secret scan across the raw payload (verbatim blobs included).
  const serialized = JSON.stringify(input.payload ?? {}) + JSON.stringify(input.selfCheck ?? {});
  const scan = scanForSecrets(serialized);
  if (!scan.clean) {
    throw new ProofBundleRejectedError(
      "Bundle rejected — secret-pattern scrubber tripped. Keys never enter this tab.",
      { patterns: scan.hits },
    );
  }

  try {
    // UI work-order rules (spec 4.3).
    if (input.workOrderId) {
      const [wo] = await db
        .select()
        .from(appdevWorkOrders)
        .where(
          and(
            eq(appdevWorkOrders.id, input.workOrderId),
            eq(appdevWorkOrders.companyId, input.companyId),
          ),
        )
        .limit(1);
      if (!wo) throw new ProofBundleRejectedError("Work order not found");

      if (input.kind === "screenshot_set") {
        if (wo.touchesUi && (!input.selfCheck || Object.keys(input.selfCheck).length === 0)) {
          throw new ProofBundleRejectedError(
            "screenshot_set for a UI work order requires a populated self_check (spec 4.3 — definition of done).",
          );
        }
        // Completeness: every declared screen_tag must be present when the
        // submitter provides a tag map.
        if (input.screenshotsByTag) {
          const screens = await db
            .select({ screenTag: appdevScreens.screenTag })
            .from(appdevScreens)
            .where(eq(appdevScreens.appId, input.appId));
          const provided = new Set(Object.keys(input.screenshotsByTag));
          const missing = screens.map((s) => s.screenTag).filter((t) => !provided.has(t));
          if (screens.length > 0 && missing.length > 0) {
            throw new ProofBundleRejectedError(
              "screenshot_set incomplete — one asset per declared screen_tag required.",
              { missingScreenTags: missing },
            );
          }
        }
      }
    }

    const [row] = await db
      .insert(appdevProofBundles)
      .values({
        companyId: input.companyId,
        appId: input.appId,
        workOrderId: input.workOrderId ?? null,
        kind: input.kind,
        payload: {
          ...(input.payload ?? {}),
          ...(input.screenshotsByTag ? { screenshots_by_tag: input.screenshotsByTag } : {}),
        },
        screenshotAssetIds: input.screenshotAssetIds ?? [],
        selfCheck: input.selfCheck ?? null,
        submittedBy: input.submittedBy,
      })
      .returning();
    return row;
  } catch (err) {
    if (err instanceof ProofBundleRejectedError) throw err;
    rethrowMigrationPending(err);
  }
}

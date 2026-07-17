/**
 * Web screenshot harness (spec 4.3, web half) — deterministic script, output
 * part of the proof bundle. One PNG per (screen_tag × viewport), sha256'd;
 * a bundle missing a declared screen is invalid (enforced at ingest).
 *
 * Uses the repo-root Playwright CLI (`npx playwright screenshot`) via execFile
 * — no new server dependency; the e2e suite already ships the binary. If the
 * CLI/browser is unavailable the run fails loudly with the raw stderr in the
 * result (proof, not summary). iOS simctl variant: DEFERRED (Mac hardware).
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { appdevAssets, appdevScreens } from "@paperclipai/db";
import { uploadsRoot } from "../image-studio/uploads.js";
import { rethrowMigrationPending } from "./gatekeeper.js";

const execFile = promisify(execFileCb);

/** Device matrix minimum (spec 4.3): one small, one large. Web viewports. */
export const HARNESS_VIEWPORTS = [
  { name: "small", size: "390,844" }, // SE/iPhone-13-mini-class
  { name: "large", size: "1280,800" }, // desktop/tablet-class
] as const;

export interface HarnessShot {
  screenTag: string;
  viewport: string;
  assetId: string;
  storagePath: string;
  sha256: string;
}

export interface HarnessRunResult {
  ok: boolean;
  shots: HarnessShot[];
  /** screen_tag → asset id of the LARGE viewport shot (bundle completeness map). */
  screenshotsByTag: Record<string, string>;
  failures: Array<{ screenTag: string; viewport: string; error: string }>;
  rawLog: string[];
}

/**
 * Run the harness for every declared screen of an app against a running
 * instance at `baseUrl` (e.g. the app's dev/staging URL). launch_route is
 * appended per screen. Screenshots land under uploads/appdev/<appId>/shots/.
 */
export async function runWebHarness(
  db: Db,
  input: { companyId: string; appId: string; baseUrl: string },
): Promise<HarnessRunResult> {
  let screens;
  try {
    screens = await db.select().from(appdevScreens).where(eq(appdevScreens.appId, input.appId));
  } catch (err) {
    rethrowMigrationPending(err);
  }
  if (!screens || screens.length === 0) {
    return {
      ok: false,
      shots: [],
      screenshotsByTag: {},
      failures: [{ screenTag: "(none)", viewport: "-", error: "no appdev_screens declared for this app" }],
      rawLog: ["harness refused: empty screen inventory"],
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relDir = path.join("appdev", input.appId, "shots", stamp);
  const absDir = path.join(uploadsRoot(), relDir);
  await fs.mkdir(absDir, { recursive: true });

  const shots: HarnessShot[] = [];
  const failures: HarnessRunResult["failures"] = [];
  const rawLog: string[] = [];
  const byTag: Record<string, string> = {};

  for (const screen of screens) {
    const route = screen.launchRoute ?? "/";
    const url = input.baseUrl.replace(/\/$/, "") + (route.startsWith("/") ? route : `/${route}`);
    for (const vp of HARNESS_VIEWPORTS) {
      const fileName = `${screen.screenTag}.${vp.name}.png`;
      const abs = path.join(absDir, fileName);
      const rel = path.join(relDir, fileName);
      try {
        // Deterministic capture; --full-page off so the viewport is the frame.
        const { stdout, stderr } = await execFile(
          "npx",
          ["playwright", "screenshot", `--viewport-size=${vp.size}`, "--wait-for-timeout=1500", url, abs],
          { timeout: 60_000, cwd: process.cwd() },
        );
        rawLog.push(`[${screen.screenTag}/${vp.name}] ${stdout.trim()} ${stderr.trim()}`.trim());
        const buf = await fs.readFile(abs);
        const sha = createHash("sha256").update(buf).digest("hex");
        const [asset] = await db
          .insert(appdevAssets)
          .values({
            companyId: input.companyId,
            appId: input.appId,
            kind: "screenshot",
            storagePath: rel,
            mime: "image/png",
            sha256: sha,
            source: "screenshot",
          })
          .returning();
        shots.push({ screenTag: screen.screenTag, viewport: vp.name, assetId: asset.id, storagePath: rel, sha256: sha });
        if (vp.name === "large" || !byTag[screen.screenTag]) byTag[screen.screenTag] = asset.id;
      } catch (err) {
        const msg = String((err as Error & { stderr?: string })?.stderr || (err as Error)?.message || err).slice(0, 400);
        failures.push({ screenTag: screen.screenTag, viewport: vp.name, error: msg });
        rawLog.push(`[${screen.screenTag}/${vp.name}] FAILED: ${msg}`);
      }
    }
  }

  return { ok: failures.length === 0, shots, screenshotsByTag: byTag, failures, rawLog };
}

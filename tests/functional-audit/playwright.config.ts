/**
 * Functional-audit Playwright config.
 *
 * Default mode (AUDIT_TARGET unset or "auditco"):
 *   Spins up a throwaway `paperclipai onboard --yes --run` instance on
 *   port 3299, bootstraps a fresh AuditCo company via global-setup, then
 *   runs the audit against it. Safe for CI / cold runs.
 *
 *     npx playwright test --config tests/functional-audit/playwright.config.ts
 *
 * Pass-2 mode (AUDIT_TARGET=tyl):
 *   Reuses Tyler's LIVE local dev server on port 3100 (no webServer spawn,
 *   no fresh company creation). Reads the operator session cookie from
 *   ~/.paperclip/.session-cookie and injects it as `paperclip_session`
 *   so the audit walks the real TYL/ instance with populated companies,
 *   agents, runs, goals, approvals and routines instead of an empty
 *   throwaway shell.
 *
 *     # one-time: write your operator cookie value to ~/.paperclip/.session-cookie
 *     AUDIT_TARGET=tyl npx playwright test \
 *       --config tests/functional-audit/playwright.config.ts --reporter=list
 *
 *   Override the live URL with PAPERCLIP_AUDIT_BASE_URL=http://127.0.0.1:9999
 *   if your dev server is on a non-default port. Override the cookie path
 *   with PAPERCLIP_AUDIT_COOKIE_FILE=/path/to/cookie if you keep it
 *   elsewhere.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIT_TARGET = (process.env.AUDIT_TARGET ?? "auditco").toLowerCase();
const TARGETING_TYL = AUDIT_TARGET === "tyl";

// Default throwaway-instance port; TYL pass uses the live dev server on 3100.
const TYL_PORT = Number(process.env.PAPERCLIP_AUDIT_PORT ?? 3100);
const AUDITCO_PORT = Number(process.env.PAPERCLIP_AUDIT_PORT ?? 3299);
const PORT = TARGETING_TYL ? TYL_PORT : AUDITCO_PORT;
const BASE_URL =
  process.env.PAPERCLIP_AUDIT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const PAPERCLIP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-audit-home-"));

function readTylCookie(): string | null {
  const cookieFile =
    process.env.PAPERCLIP_AUDIT_COOKIE_FILE ??
    path.join(os.homedir(), ".paperclip", ".session-cookie");
  try {
    const raw = fs.readFileSync(cookieFile, "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

const tylCookieValue = TARGETING_TYL ? readTylCookie() : null;
if (TARGETING_TYL && !tylCookieValue) {
  // eslint-disable-next-line no-console
  console.warn(
    `[audit] AUDIT_TARGET=tyl but no session cookie found at ${
      process.env.PAPERCLIP_AUDIT_COOKIE_FILE ?? "~/.paperclip/.session-cookie"
    }. Audit will run unauthenticated — expect redirects to /auth.`,
  );
}

const tylStorageState = tylCookieValue
  ? {
      cookies: [
        {
          name: "paperclip_session",
          value: tylCookieValue,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    }
  : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: process.env.AUDIT_SPEC ?? "full-audit.spec.ts",
  timeout: 600_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  // TYL pass talks to a live server with real data — no bootstrap needed.
  globalSetup: TARGETING_TYL ? undefined : "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    ...(tylStorageState ? { storageState: tylStorageState } : {}),
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl"] },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 393, height: 852 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
        launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl"] },
      },
    },
  ],
  // Only spin up a fresh instance for the default AuditCo pass.
  webServer: TARGETING_TYL
    ? undefined
    : {
        command: `pnpm paperclipai onboard --yes --run`,
        cwd: path.resolve(__dirname, "../.."),
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PORT: String(PORT),
          PAPERCLIP_HOME,
          PAPERCLIP_INSTANCE_ID: "playwright-audit",
          PAPERCLIP_BIND: "loopback",
          PAPERCLIP_DEPLOYMENT_MODE: "local_trusted",
          PAPERCLIP_DEPLOYMENT_EXPOSURE: "private",
        },
      },
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "./results/audit.json" }],
  ],
});

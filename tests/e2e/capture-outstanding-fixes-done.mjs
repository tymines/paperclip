/**
 * Standalone Playwright capture of the Personas page after the outstanding
 * fixes round — both Sidney personas show a "ready" status (previously stuck at
 * "training" / "needs photos").
 *
 * Drives the running dev UI (Vite :5173 → dev server :3100, trusted localhost).
 *
 *   node tests/e2e/capture-outstanding-fixes-done.mjs
 */
import { chromium } from "@playwright/test";

const UI = process.env.UI_URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "outstanding-fixes-done.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

await page.goto(`${UI}/TYL/personas`, { waitUntil: "networkidle" });

// Wait for both built-in personas to render with their status badges.
await page.getByText("Sidney SFW").first().waitFor({ state: "visible", timeout: 15000 });
await page.getByText("Sidney NSFW").first().waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(500);

await page.screenshot({ path: OUT });
console.log(`Saved ${OUT}`);

await browser.close();

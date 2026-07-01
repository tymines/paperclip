/**
 * Standalone Playwright capture of the multi-provider model picker.
 *
 * Drives the running dev UI (Vite :5173 → dev server :3100, trusted localhost)
 * which has the live Sidney persona, opens its studio, and screenshots the
 * provider-grouped ModelPicker (Replicate · Atlas Cloud · WaveSpeed AI) to
 * multi-provider-picker.png at the repo root.
 *
 *   node tests/e2e/capture-multi-provider-picker.mjs
 */
import { chromium } from "@playwright/test";

const UI = process.env.UI_URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "multi-provider-picker.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 2300 } });

await page.goto(`${UI}/TYL/image-studio`, { waitUntil: "networkidle" });

// Open the first persona's studio (Sidney SFW).
await page.getByRole("button", { name: /open studio/i }).first().click();

const picker = page.locator('[data-testid="model-picker"]');
await picker.waitFor({ state: "visible", timeout: 15000 });
// Table mode shows all models across all 3 providers (with provider chips +
// per-render cost) compactly in a single frame.
await page.locator('[data-testid="model-mode-table"]').click();
await page.waitForTimeout(400);
await picker.scrollIntoViewIfNeeded();

// Element screenshot of the full picker (header + table + compare toggle).
await picker.screenshot({ path: OUT });
console.log(`Saved ${OUT}`);

await browser.close();

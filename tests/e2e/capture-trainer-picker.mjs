/**
 * Standalone Playwright capture of the New Persona wizard's Step-3 trainer
 * picker — the provider-grouped LoRA trainer dropdown (Replicate · WaveSpeed AI)
 * with per-provider cost + ETA and the ⭐ recommended pick.
 *
 *   node tests/e2e/capture-trainer-picker.mjs
 *
 * Creates a throwaway persona to reach Step 3; the caller deletes it after.
 */
import { chromium } from "@playwright/test";

const UI = process.env.UI_URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "trainer-picker.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

await page.goto(`${UI}/TYL/personas`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /new persona/i }).first().click();

// Step 1 — identity.
await page.getByTestId("np-name").fill("Picker Demo");
await page.getByTestId("np-next").click();

// Step 2 — skip photos straight to Step 3.
await page.getByTestId("np-skip").click();

// Step 3 — open the trainer picker so the grouped options are visible.
await page.getByTestId("np-trainer").waitFor({ state: "visible", timeout: 10000 });
await page.waitForTimeout(400);
await page.getByTestId("np-trainer").click();
await page.waitForTimeout(500);

await page.screenshot({ path: OUT });
console.log(`Saved ${OUT}`);

await browser.close();

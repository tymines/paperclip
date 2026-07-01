#!/usr/bin/env node
// Capture the SocialConnectWizard at each of its 4 steps for Instagram.
// Reads the demo entry at /social-wizard-demo.html with ?step=N&platform=instagram.
// Usage: node scripts/capture-social-wizard-screens.mjs <outDir> [baseUrl]
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] || path.join(process.cwd(), "audit-screenshots");
const BASE = process.argv[3] || "http://localhost:5188";
const PLATFORM = process.env.PLATFORM || "instagram";

const STEPS = [
  { step: 1, slug: "step1" },
  { step: 2, slug: "step2" },
  { step: 3, slug: "step3" },
  { step: 4, slug: "step4" },
];

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page]", msg.text());
  });
  for (const { step, slug } of STEPS) {
    const url = `${BASE}/social-wizard-demo.html?platform=${PLATFORM}&step=${step}`;
    console.log("→", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for the dialog to mount.
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    await page.waitForTimeout(800);
    const file = path.join(OUT, `social-oauth-wizard-ig-${slug}__desktop.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log("wrote", file);
  }
  await ctx.close();
} finally {
  await browser.close();
}

#!/usr/bin/env node
// Capture phase-D Knowledge Graph screenshots.
// Usage: node scripts/capture-kg-phase-d.mjs [outDir]
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const OUT =
  process.argv[2] ||
  path.resolve(process.cwd(), "audit-screenshots");
const BASE = "http://localhost:5181";

await fs.mkdir(OUT, { recursive: true });

// Headless chromium has no GPU; force software-rasterized WebGL via SwiftShader.
const browser = await chromium.launch({
  args: [
    "--use-gl=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  // ── Desktop 1440×900 ──────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/TYL/knowledge-graph`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(3500); // let graph settle
    await page.screenshot({
      path: path.join(OUT, "kg-phase-d-desktop.png"),
      fullPage: false,
    });
    console.log("wrote desktop");

    // ── Camera drag verification: drag the middle of the canvas pane.
    // Use viewport coordinates directly to avoid race with locator after
    // initial graph settle / HMR-related re-layout.
    {
      const startX = 900;
      const startY = 450;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(startX + (i + 1) * 12, startY + (i + 1) * 6, {
          steps: 2,
        });
      }
      await page.mouse.up();
      await page.waitForTimeout(900);
    }
    await page.screenshot({
      path: path.join(OUT, "kg-phase-d-after-drag.png"),
      fullPage: false,
    });
    console.log("wrote after-drag");

    // ── FPS overlay: ?debug=fps
    await page.goto(`${BASE}/TYL/knowledge-graph?debug=fps`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(3500);
    await page.screenshot({
      path: path.join(OUT, "kg-phase-d-fps.png"),
      fullPage: false,
    });
    console.log("wrote fps overlay");
    await ctx.close();
  }

  // ── Mobile 393×852 ────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/TYL/knowledge-graph`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(3500);
    await page.screenshot({
      path: path.join(OUT, "kg-phase-d-mobile.png"),
      fullPage: false,
    });
    console.log("wrote mobile");
    await ctx.close();
  }
} finally {
  await browser.close();
}

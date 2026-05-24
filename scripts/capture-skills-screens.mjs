#!/usr/bin/env node
/**
 * Capture v2 Skills catalog screenshots used in PR review.
 *
 * Assumes Storybook is running locally on port 6107 (the `skills-storybook`
 * preview config in /Users/augi/paperclip/.claude/launch.json). Writes three
 * PNGs into audit-screenshots/.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "audit-screenshots");
const STORYBOOK_BASE = "http://localhost:6107";

/**
 * Open the populated story, wait for the catalog to render, then return the
 * page. We toggle the `dark` class because Storybook's preview mounts the
 * iframe with the system theme; the catalog cards lean on dark tokens.
 */
async function loadCatalog(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(
    `${STORYBOOK_BASE}/iframe.html?id=surfaces-skills-catalog--populated&viewMode=story`,
    { waitUntil: "networkidle" },
  );
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.body.style.background = "#0a0a0a";
  });
  await page.waitForSelector('[data-testid="skill-card"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="skill-card"]').length >= 3,
  );
  return { context, page };
}

async function main() {
  const browser = await chromium.launch();
  try {
    // Desktop catalog (3-col grid).
    {
      const { context, page } = await loadCatalog(browser, { width: 1280, height: 800 });
      await page.screenshot({
        path: path.join(outDir, "skills__desktop.png"),
        fullPage: true,
      });
      await context.close();
    }

    // Mobile catalog (1-col grid + condensed header).
    {
      const { context, page } = await loadCatalog(browser, { width: 390, height: 844 });
      await page.screenshot({
        path: path.join(outDir, "skills__mobile.png"),
        fullPage: true,
      });
      await context.close();
    }

    // Desktop with detail drawer open. Click the first card and wait for the
    // sheet to slide in, then snapshot the viewport.
    {
      const { context, page } = await loadCatalog(browser, { width: 1280, height: 800 });
      await page.evaluate(() => {
        const button = document.querySelector(
          '[data-testid="skill-card"] button[aria-label^="Open"]',
        );
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForSelector('[data-testid="skill-detail-drawer"]');
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(outDir, "skills-detail__desktop.png"),
        fullPage: false,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
console.log("Wrote skills__desktop.png, skills__mobile.png, skills-detail__desktop.png");

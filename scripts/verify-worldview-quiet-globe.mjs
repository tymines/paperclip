#!/usr/bin/env node
import { firefox } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [url, outputDirArg] = process.argv.slice(2);
if (!url || !outputDirArg) {
  console.error("usage: node scripts/verify-worldview-quiet-globe.mjs <route-url> <output-dir>");
  process.exit(2);
}
const outputDir = resolve(outputDirArg);
await mkdir(outputDir, { recursive: true });
const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleMessages = [];
const pageErrors = [];
const responses = [];
page.on("console", (message) => {
  if (message.type() !== "timeStamp") consoleMessages.push({ type: message.type(), text: message.text() });
});
page.on("pageerror", (error) => pageErrors.push(String(error.stack || error.message)));
page.on("response", (response) => {
  if (/worldview|cartocdn|celestrak|eonet|earthquake/i.test(response.url())) responses.push({ status: response.status(), url: response.url() });
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('[data-pp-page-v4="world-view-quiet-globe"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.locator("canvas.maplibregl-canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(8_000);
  const desktopPath = resolve(outputDir, "quiet-globe-desktop-1440x900.png");
  await page.screenshot({ path: desktopPath, fullPage: false });

  const modeButton = page.getByRole("button", { name: /mode world pulse/i });
  await modeButton.click();
  for (const label of ["Satellites", "Severe weather"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${label}`) });
    if (await button.count()) await button.click();
  }
  await page.keyboard.press("Escape");
  const frameSample = await page.evaluate(() => new Promise((resolveFrame) => {
    let frames = 0;
    const started = performance.now();
    const tick = (now) => {
      frames += 1;
      if (now - started >= 2000) resolveFrame({ frames, elapsedMs: now - started, fps: frames * 1000 / (now - started) });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1_000);
  const phonePath = resolve(outputDir, "quiet-globe-phone-390x844.png");
  await page.screenshot({ path: phonePath, fullPage: false });

  const dom = await page.evaluate(() => {
    const root = document.querySelector('[data-pp-page-v4="world-view-quiet-globe"]');
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const rect = canvas?.getBoundingClientRect();
    return {
      route: location.href,
      title: document.title,
      rootVisible: !!root,
      canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      mode: document.body.innerText.includes("WORLD PULSE"),
      timeline: document.body.innerText.includes("LIVE"),
      degradationText: [...document.querySelectorAll("header div")].map((node) => node.textContent?.trim()).filter(Boolean).find((text) => /direct feed|reconnecting|awaiting feed access/i.test(text || "")) || null,
    };
  });
  const report = { capturedAt: new Date().toISOString(), url, viewportDesktop: { width: 1440, height: 900 }, viewportPhone: { width: 390, height: 844 }, desktopPath, phonePath, dom, frameSample, consoleMessages, pageErrors, responses };
  const reportPath = resolve(outputDir, "browser-proof.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!dom.rootVisible || !dom.canvas || pageErrors.length || consoleMessages.some((message) => message.type === "error")) process.exitCode = 1;
} catch (error) {
  const debug = { error: String(error), url: page.url(), title: await page.title().catch(() => ""), text: (await page.locator("body").innerText().catch(() => "")).slice(0, 2000), consoleMessages, pageErrors, responses };
  await page.screenshot({ path: resolve(outputDir, "quiet-globe-debug.png"), fullPage: false }).catch(() => {});
  await writeFile(resolve(outputDir, "browser-proof-debug.json"), `${JSON.stringify(debug, null, 2)}\n`);
  console.error(JSON.stringify(debug, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}

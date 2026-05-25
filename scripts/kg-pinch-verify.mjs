#!/usr/bin/env node
/**
 * Pinch-zoom regression test for the v2 Knowledge Graph at iPhone viewport.
 *
 * Tyler hit this on his phone: pinch was dead, only the +/- buttons worked.
 * Root cause was v2-gestures.ts intercepting iOS gesturechange with
 * preventDefault + running a parallel cameraPosition tween that fought
 * react-force-graph-3d's built-in TrackballControls.
 *
 * The pinch is driven with synthetic PointerEvents of pointerType:"touch"
 * because CDP `Input.dispatchTouchEvent` doesn't reliably surface multi-
 * pointer streams to TrackballControls in headless Chrome. The events go
 * through the exact path TrackballControls listens on (pointerdown on the
 * canvas → pointermove on window). Move events are spaced across rAF ticks
 * so the controls' internal update() loop sees each intermediate distance.
 *
 * Run:
 *   node scripts/kg-pinch-verify.mjs http://localhost:5184/TYL/knowledge-graph
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(
  "/private/tmp/kg-pinch-fix/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright",
);

const URL = process.argv[2] ?? "http://localhost:5184/TYL/knowledge-graph";
const OUT_DIR = path.resolve(process.cwd(), "audit-screenshots");
await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
  ...devices["iPhone 14 Pro"],
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[page error] ${m.text().slice(0, 200)}`);
});

console.log(`→ navigating ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForSelector("canvas", { timeout: 15_000 });
// Let the graph settle and the dev controls-config effect run.
await page.waitForTimeout(3500);

async function cameraLen() {
  return await page.evaluate(() => {
    const fg = window.__kgFg;
    if (!fg || typeof fg.camera !== "function") return null;
    const p = fg.camera().position;
    return Math.hypot(p.x, p.y, p.z);
  });
}

async function resetCamera(z = 1000) {
  await page.evaluate(
    (z) => window.__kgFg.cameraPosition({ x: 0, y: 0, z }, { x: 0, y: 0, z: 0 }, 0),
    z,
  );
  await page.waitForTimeout(300);
}

/** Drive a two-finger pinch with rAF-spaced moves. */
async function pinch(direction /* "out" | "in" */, steps = 16) {
  const fromGap = direction === "out" ? 30 : 200;
  const toGap = direction === "out" ? 200 : 30;
  await page.evaluate(
    ({ fromGap, toGap }) => {
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      window.__pinchCtx = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, fromGap, toGap };
      window.__pinchSend = (type, x, y, id, primary) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: id,
            pointerType: "touch",
            isPrimary: primary,
            clientX: x,
            clientY: y,
            buttons: 1,
            button: 0,
            pressure: 0.5,
          }),
        );
      const c = window.__pinchCtx;
      window.__pinchSend("pointerdown", c.cx - c.fromGap, c.cy, 1, true);
      window.__pinchSend("pointerdown", c.cx + c.fromGap, c.cy, 2, false);
    },
    { fromGap, toGap },
  );
  for (let i = 1; i <= steps; i++) {
    await page.evaluate(
      ({ i, steps }) => {
        const c = window.__pinchCtx;
        const g = c.fromGap + (c.toGap - c.fromGap) * (i / steps);
        window.__pinchSend("pointermove", c.cx - g, c.cy, 1, true);
        window.__pinchSend("pointermove", c.cx + g, c.cy, 2, false);
      },
      { i, steps },
    );
    await page.waitForTimeout(30);
  }
  await page.evaluate(() => {
    const c = window.__pinchCtx;
    window.__pinchSend("pointerup", c.cx - c.toGap, c.cy, 1, true);
    window.__pinchSend("pointerup", c.cx + c.toGap, c.cy, 2, false);
  });
  await page.waitForTimeout(700);
}

await resetCamera(1000);
const beforeOut = await cameraLen();
await page.screenshot({ path: path.join(OUT_DIR, "kg-pinch-before.png") });

console.log("→ pinch-OUT (fingers spread → camera moves CLOSER → |cam| shrinks)");
await pinch("out");
const afterOut = await cameraLen();
await page.screenshot({ path: path.join(OUT_DIR, "kg-pinch-after-out.png") });

await resetCamera(1000);
const beforeIn = await cameraLen();
console.log("→ pinch-IN (fingers together → camera moves AWAY → |cam| grows)");
await pinch("in");
const afterIn = await cameraLen();
await page.screenshot({ path: path.join(OUT_DIR, "kg-pinch-after-in.png") });

await browser.close();

console.log(`\nResults:`);
console.log(`  pinch-OUT: ${beforeOut?.toFixed(2)} → ${afterOut?.toFixed(2)}`);
console.log(`  pinch-IN : ${beforeIn?.toFixed(2)} → ${afterIn?.toFixed(2)}`);

const outDelta = Math.abs((afterOut ?? 0) - beforeOut) / beforeOut;
const inDelta = Math.abs((afterIn ?? 0) - beforeIn) / beforeIn;
let fail = false;
if (!(outDelta > 0.1) || !(afterOut < beforeOut)) {
  console.error(`FAIL: pinch-out should move camera closer by >10%, got delta=${(outDelta * 100).toFixed(1)}% direction ${afterOut < beforeOut ? "ok" : "WRONG"}`);
  fail = true;
}
if (!(inDelta > 0.1) || !(afterIn > beforeIn)) {
  console.error(`FAIL: pinch-in should move camera away by >10%, got delta=${(inDelta * 100).toFixed(1)}% direction ${afterIn > beforeIn ? "ok" : "WRONG"}`);
  fail = true;
}
if (fail) process.exit(4);
console.log(`PASS: two-finger pinch drives TrackballControls in both directions (out=${(outDelta * 100).toFixed(0)}%, in=${(inDelta * 100).toFixed(0)}%).`);

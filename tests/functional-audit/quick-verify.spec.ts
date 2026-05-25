/**
 * Targeted spot-check for the most interesting findings — captures screenshots
 * + extra DOM detail so the report can cite specifics.
 */
import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = JSON.parse(fs.readFileSync(path.resolve(__dirname, "results/context.json"), "utf8"));
const screenshotsDir = path.resolve(__dirname, "results/screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

test.describe("Spot checks", () => {
  test("mobile: /costs overflow detail", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "mobile") test.skip();
    await page.goto(`/${ctx.companyPrefix}/costs`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const dims = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      offenders: Array.from(document.querySelectorAll("*"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > document.documentElement.clientWidth + 4) {
            return {
              tag: el.tagName.toLowerCase(),
              cls: (el.className || "").toString().slice(0, 80),
              right: Math.round(r.right),
              w: Math.round(r.width),
            };
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 10),
    }));
    fs.writeFileSync(path.resolve(__dirname, "results/costs-mobile-overflow.json"), JSON.stringify(dims, null, 2));
    await page.screenshot({ path: path.resolve(screenshotsDir, "costs-mobile.png"), fullPage: true });
  });
  test("mobile: /cost-watcher overflow detail", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "mobile") test.skip();
    await page.goto(`/${ctx.companyPrefix}/cost-watcher`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const dims = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      offenders: Array.from(document.querySelectorAll("*"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > document.documentElement.clientWidth + 4) {
            return {
              tag: el.tagName.toLowerCase(),
              cls: (el.className || "").toString().slice(0, 80),
              right: Math.round(r.right),
              w: Math.round(r.width),
            };
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 10),
    }));
    fs.writeFileSync(path.resolve(__dirname, "results/cost-watcher-mobile-overflow.json"), JSON.stringify(dims, null, 2));
    await page.screenshot({ path: path.resolve(screenshotsDir, "cost-watcher-mobile.png"), fullPage: true });
  });
  test("mobile: /home tap-target detail", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "mobile") test.skip();
    await page.goto(`/${ctx.companyPrefix}/home`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.resolve(screenshotsDir, "home-mobile.png"), fullPage: true });
  });
  test("desktop: /jarvis snapshot", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") test.skip();
    await page.goto(`/${ctx.companyPrefix}/jarvis`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.resolve(screenshotsDir, "jarvis-desktop.png"), fullPage: false });
    // Capture which controls actually exist
    const inventory = await page.evaluate(() => {
      return {
        hasInputBar: !!document.querySelector(".jarvis-input-bar"),
        hasMic: !!document.querySelector(".jarvis-input-mic"),
        hasSend: !!document.querySelector(".jarvis-input-send"),
        hasInput: !!document.querySelector(".jarvis-input-bar input"),
        hasModeTabs: document.querySelectorAll(".jarvis-mode-tab").length,
        textInPage: (document.body.innerText || "").length,
      };
    });
    fs.writeFileSync(path.resolve(__dirname, "results/jarvis-inventory.json"), JSON.stringify(inventory, null, 2));
  });
  test("desktop: /issues/AUD-1 detail snapshot", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") test.skip();
    await page.goto(`/${ctx.companyPrefix.toUpperCase()}/issues/AUD-1`);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.resolve(screenshotsDir, "issue-detail-desktop.png"), fullPage: true });
    const inventory = await page.evaluate(() => {
      const text = (document.body.innerText || "");
      return {
        text_len: text.length,
        text_head: text.slice(0, 400),
        markDoneBtn: !!Array.from(document.querySelectorAll("button")).find((b) => /mark done/i.test(b.textContent || "")),
        deleteBtn: !!Array.from(document.querySelectorAll("button")).find((b) => /^delete$/i.test((b.textContent || "").trim())),
        commentTextarea: !!document.querySelector('textarea[placeholder*="comment" i], textarea'),
        statusButtons: document.querySelectorAll("[data-pp-issue-status], [data-testid*=status]").length,
      };
    });
    fs.writeFileSync(path.resolve(__dirname, "results/issue-detail-inventory.json"), JSON.stringify(inventory, null, 2));
  });
});

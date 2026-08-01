import { test, expect } from "@playwright/test";

/**
 * Regression: fresh service-worker install must not wedge the page.
 *
 * Root cause (fixed in ui/public/sw.js): the SW `activate` handler awaited
 * `client.navigate(client.url)` inside `event.waitUntil(...)`. On a fresh
 * install the forced navigation's fetch handling is queued until the worker
 * finishes activating, while activation cannot finish until `navigate()`
 * settles — a circular wait that left the document request pending forever
 * (page never commits; main thread unresponsive to evaluate/screenshot).
 *
 * This test loads a board route in a fresh browser profile (guaranteeing a
 * first-time SW install + activate), waits past the activate + forced-reload
 * window, and asserts the main thread answers evaluate and the shell renders.
 * With the old sw.js the evaluate below times out and the test fails.
 */

test.describe("service worker fresh install", () => {
  test("board route stays responsive after SW install + forced reload", async ({ page }) => {
    // Create a company via API so a board route exists in this throwaway home.
    const createRes = await page.request.post("/api/companies", {
      data: { name: `SW-Regression-${Date.now()}` },
    });
    expect(createRes.ok()).toBe(true);
    const company = await createRes.json();
    expect(company.issuePrefix).toBeTruthy();

    await page.goto(`/${company.issuePrefix}/home`, { waitUntil: "domcontentloaded" });

    // Window `load` triggers SW registration; install -> skipWaiting ->
    // activate -> forced reload. Give the whole cycle time to complete.
    await page.waitForLoadState("load");
    await page.waitForTimeout(8000);

    // The wedge signature: main thread never answers evaluate.
    const state = await Promise.race([
      page.evaluate(async () => ({
        ready: document.readyState,
        len: document.body ? document.body.innerText.length : -1,
        hasRoot: !!document.getElementById("root")?.hasChildNodes(),
        swControlled: !!navigator.serviceWorker?.controller,
        swActive: !!(await navigator.serviceWorker?.getRegistration())?.active,
      })),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("main thread blocked (SW activate deadlock)")), 5000),
      ),
    ]) as {
      ready: string;
      len: number;
      hasRoot: boolean;
      swControlled: boolean;
      swActive: boolean;
    };

    expect(state.ready).toBe("complete");
    expect(state.hasRoot).toBe(true);
    expect(state.len).toBeGreaterThan(0);
    // Non-vacuous: the service worker must actually have installed, activated,
    // and taken control — otherwise this test exercises nothing.
    expect(state.swActive).toBe(true);
    expect(state.swControlled).toBe(true);
  });
});

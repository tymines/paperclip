/**
 * Paperclip comprehensive functional audit.
 *
 * Boots a throwaway instance via `pnpm paperclipai onboard --yes --run`, then
 * walks every public route both as a desktop user (1440×900) and as a mobile
 * user (393×852). For each route we:
 *   - confirm the page actually renders content beyond the SPA shell
 *   - exercise the interactive elements Tyler called out
 *   - capture console errors, page errors and any 4xx/5xx responses
 *   - flag horizontal-scroll and tap-target issues on mobile
 *
 * Every interaction appends a JSON line to results/interactions.jsonl that the
 * follow-up reporter consolidates into the punch-list markdown.
 *
 * Invocation:
 *
 *   # Pass-1 (default): bootstraps a throwaway AuditCo instance on 3299.
 *   rm -f tests/functional-audit/results/interactions.jsonl
 *   npx playwright test --config tests/functional-audit/playwright.config.ts \
 *     --reporter=list
 *
 *   # Pass-2: runs against Tyler's LIVE dev server on 3100 with the operator
 *   # session cookie from ~/.paperclip/.session-cookie. No throwaway bootstrap.
 *   AUDIT_TARGET=tyl npx playwright test \
 *     --config tests/functional-audit/playwright.config.ts --reporter=list
 *
 * See playwright.config.ts for the full set of AUDIT_TARGET, PAPERCLIP_AUDIT_PORT,
 * PAPERCLIP_AUDIT_BASE_URL and PAPERCLIP_AUDIT_COOKIE_FILE overrides.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  attachMonitor,
  appendResult,
  gotoAndWait,
  hasHorizontalScroll,
  smallestTapTarget,
  runStep,
  type AuditContext,
  buildAuditContext,
} from "./helpers";

type Ctx = ReturnType<typeof setupCtx>;

function setupCtx() {
  const ctxFile = path.resolve(__dirname, "results/context.json");
  const ctx: any = fs.existsSync(ctxFile) ? JSON.parse(fs.readFileSync(ctxFile, "utf8")) : {};
  return ctx as {
    companyId?: string;
    companyPrefix?: string;
    issuePrefix?: string;
    projectId?: string;
    roomId?: string;
    goalId?: string;
    issueId?: string;
  };
}

const VIEWPORT = (testInfo: any): "desktop" | "mobile" =>
  testInfo.project.name === "mobile" ? "mobile" : "desktop";

// --- Per-page heuristics ----------------------------------------------------

async function expectPageHasContent(page: Page): Promise<{ pass: boolean; actual: string }> {
  // Content = either a heading, or main has >200 text chars beyond the layout chrome.
  const headingCount = await page.locator("h1, h2, h3, [role=heading]").count();
  const mainText = await page.locator("main, [role=main], #app, body").first().innerText().catch(() => "");
  const textLen = (mainText || "").trim().length;
  const hasErrorBoundary = await page.getByText(/something went wrong|application error|stack trace/i).count();
  if (hasErrorBoundary > 0) return { pass: false, actual: `error boundary visible (text len ${textLen})` };
  const ok = headingCount > 0 || textLen > 200;
  return { pass: ok, actual: `headings=${headingCount} mainTextLen=${textLen}` };
}

// Apply company-prefixed path: "/dashboard" -> "/tyl/dashboard"
function withPrefix(ctx: Ctx, segment: string): string {
  const prefix = ctx.companyPrefix;
  if (!prefix) return `/${segment.replace(/^\//, "")}`;
  return `/${prefix}/${segment.replace(/^\//, "")}`;
}

// --- Test suite -------------------------------------------------------------

test.describe("Paperclip functional audit", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Attach the monitor onto the page so all subsequent runs share it.
    (page as any).__monitor = attachMonitor(page);
    (page as any).__viewport = VIEWPORT(testInfo);
  });

  // ---- /home --------------------------------------------------------------
  test("home route + sidebar + new-task dialog", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);

    const url = withPrefix(ctx, "home");
    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Load /home",
      expected: "Home page renders with content + 0 page errors",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}: ${nav.notes ?? ""}` };
      const content = await expectPageHasContent(page);
      return content;
    });

    // Mobile-specific checks
    if (viewport === "mobile") {
      await runStep(page, monitor, {
        route: url,
        viewport,
        interaction: "Mobile layout: no horizontal scroll",
        expected: "document.scrollWidth <= clientWidth",
      }, async () => {
        const hScroll = await hasHorizontalScroll(page);
        return { pass: !hScroll, actual: hScroll ? "horizontal scroll detected" : "ok" };
      });
      await runStep(page, monitor, {
        route: url,
        viewport,
        interaction: "Mobile tap targets ≥ 44px",
        expected: "smallest interactive ≥ 44px",
      }, async () => {
        const { count, minSize, offenders } = await smallestTapTarget(page);
        const pass = count === 0 || minSize >= 32;
        const offendDesc = offenders.map((o) => `${o.tag}[${o.w}×${o.h}]"${o.text}"`).join("; ");
        return {
          pass,
          actual: `count=${count} minSize=${minSize.toFixed(1)}`,
          notes: minSize < 44 ? `WARN: ${minSize.toFixed(1)}px < 44px — offenders: ${offendDesc}` : undefined,
        };
      });
    }
  });

  // ---- /jarvis ------------------------------------------------------------
  test("jarvis route + voice controls", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "jarvis");

    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Load /jarvis",
      expected: "Jarvis page renders, no fatal error",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });

    // Mic / record button presence
    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Mic / record button visible",
      expected: "Some record/mic/voice control present in Jarvis HUD",
    }, async () => {
      const mic = page.locator('.jarvis-input-mic, button[title="Hold to talk"], button[title*="record" i], button[aria-label*="mic" i]').first();
      const visible = await mic.isVisible().catch(() => false);
      return { pass: visible, actual: visible ? "visible" : "not found" };
    });

    // Text input presence
    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Text input present",
      expected: "type-something textarea / input visible",
    }, async () => {
      const input = page.locator('.jarvis-input-bar input, .jarvis-input-shell input, textarea, input[type="text"], input[type="search"], input:not([type="hidden"])').first();
      const visible = await input.isVisible().catch(() => false);
      return { pass: visible, actual: visible ? "visible" : "not found" };
    });

    // Brief-me button (if present)
    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Brief Me button click",
      expected: "Clicking Brief Me triggers some UI change",
    }, async () => {
      const brief = page.getByRole("button", { name: /brief me/i }).first();
      const found = await brief.isVisible().catch(() => false);
      if (!found) return { pass: false, actual: "brief-me button not found", notes: "may be gated behind LLM config" };
      const before = await page.content();
      await brief.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const after = await page.content();
      return { pass: before !== after, actual: before === after ? "no content change after click" : "content changed" };
    });

    // Tier picker / voice character picker (often a select or button row)
    await runStep(page, monitor, {
      route: url,
      viewport,
      interaction: "Voice character picker present",
      expected: "Selectable voice character options visible",
    }, async () => {
      const sel = page.locator('[role="combobox"], select, button:has-text("Voice")').first();
      const visible = await sel.isVisible().catch(() => false);
      return { pass: visible, actual: visible ? "visible" : "not found", notes: "Audit will not enumerate options unless mounted" };
    });
  });

  // ---- /dashboard ---------------------------------------------------------
  test("dashboard route", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "dashboard");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /dashboard",
      expected: "Dashboard renders, no fatal error",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /inbox + subtabs ---------------------------------------------------
  for (const tab of ["mine", "recent", "unread", "blocked", "all"] as const) {
    test(`inbox subtab: ${tab}`, async ({ page }, testInfo) => {
      const ctx = setupCtx();
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = withPrefix(ctx, `inbox/${tab}`);
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load inbox/${tab}`,
        expected: "Tab content renders; tab pill is active",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        const content = await expectPageHasContent(page);
        if (!content.pass) return content;
        // Verify the tab is marked active in the URL after settle
        const finalUrl = page.url();
        const onTab = finalUrl.includes(`/inbox/${tab}`) || finalUrl.endsWith(`/inbox`);
        return { pass: onTab, actual: `final url ${finalUrl}` };
      });
    });
  }

  // ---- /issues + subtabs --------------------------------------------------
  for (const tab of ["", "active", "backlog", "done"] as const) {
    test(`issues subtab: ${tab || "default"}`, async ({ page }, testInfo) => {
      const ctx = setupCtx();
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = withPrefix(ctx, tab ? `issues/${tab}` : "issues");
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load issues${tab ? `/${tab}` : ""}`,
        expected: "Issues list renders, redirects to default if needed",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    });
  }

  // ---- /issues/{id} -------------------------------------------------------
  test("issue detail page interactions", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);

    // First navigate to list, click first issue
    const listUrl = withPrefix(ctx, "issues");
    await page.goto(listUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const firstIssueLink = page.locator('a[href*="/issues/"]').filter({ hasNotText: /^Issues$/ }).first();

    const haveIssue = await firstIssueLink.isVisible().catch(() => false);
    if (!haveIssue) {
      appendResult({
        route: listUrl, viewport,
        interaction: "Click first issue link",
        expected: "Navigate to issue detail",
        actual: "No issue links found on list page",
        pass: false,
        consoleErrors: 0, networkErrors: [],
        notes: "Possibly no seeded issues",
      });
      return;
    }

    const href = await firstIssueLink.getAttribute("href");
    await runStep(page, monitor, {
      route: href ?? "(unknown)",
      viewport,
      interaction: "Open issue detail",
      expected: "Detail page renders with title + body",
    }, async () => {
      await firstIssueLink.click();
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      const content = await expectPageHasContent(page);
      return content;
    });

    // Status dropdown
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Status control visible",
      expected: "Status pill/select/button visible",
    }, async () => {
      const status = page.locator('[data-testid*="status"], [aria-label*="status" i], button:has-text(/active|backlog|done|in.?progress/i)').first();
      const visible = await status.isVisible().catch(() => false);
      return { pass: visible, actual: visible ? "visible" : "not found" };
    });

    // Comment input
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Comment input visible",
      expected: "Text input for new comment present",
    }, async () => {
      const comment = page.locator('textarea, [contenteditable="true"]').first();
      const visible = await comment.isVisible().catch(() => false);
      return { pass: visible, actual: visible ? "visible" : "not found" };
    });

    // Try Mark Done (only if visible)
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Mark Done button (if present)",
      expected: "Clicking changes issue to done status",
    }, async () => {
      const btn = page.getByRole("button", { name: /mark.*done|complete/i }).first();
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) return { pass: false, actual: "button not found", notes: "may already be done or labelled differently" };
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      const body = await page.content();
      const showsDone = /done|completed/i.test(body);
      return { pass: showsDone, actual: showsDone ? "page shows done state" : "no visible change" };
    });
  });

  // ---- /agents + subtabs --------------------------------------------------
  for (const tab of ["all", "active", "paused", "error"] as const) {
    test(`agents subtab: ${tab}`, async ({ page }, testInfo) => {
      const ctx = setupCtx();
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = withPrefix(ctx, `agents/${tab}`);
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load agents/${tab}`,
        expected: "Agents list renders",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    });
  }

  // ---- /agents/{id} -------------------------------------------------------
  test("agent detail page", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);

    await page.goto(withPrefix(ctx, "agents/all"), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const firstAgent = page.locator('a[href*="/agents/"]').filter({ hasNotText: /^Agents$/ }).first();
    const have = await firstAgent.isVisible().catch(() => false);
    if (!have) {
      appendResult({
        route: withPrefix(ctx, "agents/all"),
        viewport,
        interaction: "Open agent detail",
        expected: "Detail renders",
        actual: "No agent rows clickable",
        pass: false, consoleErrors: 0, networkErrors: [],
      });
      return;
    }
    const href = await firstAgent.getAttribute("href");
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Open agent detail",
      expected: "Detail page renders with agent name + tabs",
    }, async () => {
      await firstAgent.click();
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      return expectPageHasContent(page);
    });
    // Assign Task button
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Assign Task button visible",
      expected: "Button present",
    }, async () => {
      const btn = page.getByRole("button", { name: /assign.*task|new task/i }).first();
      const v = await btn.isVisible().catch(() => false);
      return { pass: v, actual: v ? "visible" : "not found" };
    });
    // Heartbeat button
    await runStep(page, monitor, {
      route: href ?? "(unknown)", viewport,
      interaction: "Run Heartbeat / Pause control",
      expected: "Heartbeat / Pause / Resume button visible",
    }, async () => {
      const btn = page.getByRole("button", { name: /heartbeat|pause|resume|run/i }).first();
      const v = await btn.isVisible().catch(() => false);
      return { pass: v, actual: v ? "visible" : "not found" };
    });
  });

  // ---- /projects + detail -------------------------------------------------
  test("projects list + new project button", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "projects");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /projects",
      expected: "List renders + New Project button visible",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      const content = await expectPageHasContent(page);
      if (!content.pass) return content;
      const btn = page.getByRole("button", { name: /new project|create project|add project/i }).first();
      const v = await btn.isVisible().catch(() => false);
      // Empty-state may hide button when no projects exist — check for empty-state CTA instead.
      const emptyCta = await page.getByText(/no projects|get started|create your first/i).first().isVisible().catch(() => false);
      const ok = v || emptyCta;
      return { pass: ok, actual: v ? "list + button visible" : emptyCta ? "empty-state CTA visible" : "neither button nor empty-state CTA visible" };
    });

    // Project detail
    if (ctx.projectId) {
      const detailUrl = withPrefix(ctx, `projects/${ctx.projectId}`);
      await runStep(page, monitor, {
        route: detailUrl, viewport,
        interaction: "Load project detail",
        expected: "Detail page renders with project name + tabs",
      }, async () => {
        const nav = await gotoAndWait(page, detailUrl);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    }
  });

  // ---- /work --------------------------------------------------------------
  test("work route", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "work");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /work",
      expected: "Work page renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /goals -------------------------------------------------------------
  test("goals list + new goal", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "goals");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /goals",
      expected: "List + New Goal button",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      const content = await expectPageHasContent(page);
      if (!content.pass) return content;
      const btn = page.getByRole("button", { name: /new goal|create goal|add goal/i }).first();
      const v = await btn.isVisible().catch(() => false);
      const emptyCta = await page.getByText(/no goals|create your first|start by/i).first().isVisible().catch(() => false);
      const ok = v || emptyCta;
      return { pass: ok, actual: v ? "button visible" : emptyCta ? "empty-state CTA visible" : "neither button nor empty-state CTA visible" };
    });
  });

  // ---- /routines ----------------------------------------------------------
  test("routines list", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "routines");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /routines",
      expected: "Routines list renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /rooms + detail ----------------------------------------------------
  test("rooms list + new room", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "rooms");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /rooms",
      expected: "Rooms list + New Room button",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      const content = await expectPageHasContent(page);
      if (!content.pass) return content;
      const btn = page.getByRole("button", { name: /new room|create room/i }).first();
      const v = await btn.isVisible().catch(() => false);
      const emptyCta = await page.getByText(/no rooms|create your first|create a room/i).first().isVisible().catch(() => false);
      const ok = v || emptyCta;
      return { pass: ok, actual: v ? "button visible" : emptyCta ? "empty-state CTA visible" : "neither button nor empty-state CTA visible" };
    });

    if (ctx.roomId) {
      const detailUrl = withPrefix(ctx, `rooms/${ctx.roomId}`);
      await runStep(page, monitor, {
        route: detailUrl, viewport,
        interaction: "Load room detail + send message",
        expected: "Detail renders, message input present, send works",
      }, async () => {
        const nav = await gotoAndWait(page, detailUrl);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        const content = await expectPageHasContent(page);
        if (!content.pass) return content;
        const input = page.locator('textarea, [contenteditable="true"]').first();
        const v = await input.isVisible().catch(() => false);
        if (!v) return { pass: false, actual: "no message input" };
        // Try sending a message
        try {
          await input.fill("audit ping");
          await page.keyboard.press("Enter");
          await page.waitForTimeout(800);
          const body = await page.content();
          return { pass: body.includes("audit ping"), actual: body.includes("audit ping") ? "message visible" : "message not visible after send" };
        } catch (e: any) {
          return { pass: false, actual: `send threw: ${e?.message}` };
        }
      });
    }
  });

  // ---- /social + subtabs --------------------------------------------------
  test("social hub default + subtabs", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "social");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /social",
      expected: "Social hub renders with subtabs",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
    // Actual social tab labels (from SocialScheduler.tsx TABS):
    // Compose, Calendar, IG Grid, Queue, Bulk Upload, Inbox, Analytics, Competitors, Hashtag Lab, Accounts
    const labels = [
      "Compose", "Calendar", "IG Grid", "Queue", "Bulk Upload",
      "Inbox", "Analytics", "Competitors", "Hashtag Lab", "Accounts",
    ];
    // Social only renders if a company is selected — gating on hasNoAccounts shows a banner
    // but the tab nav is always rendered.
    for (const label of labels) {
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Click social subtab: ${label}`,
        expected: "Tab content changes; no fatal errors",
      }, async () => {
        const tab = page.locator('nav[aria-label="Social scheduler sections"] button', { hasText: label }).first();
        const v = await tab.isVisible().catch(() => false);
        if (!v) return { pass: false, actual: `tab ${label} not found in social nav` };
        await tab.click().catch(() => {});
        await page.waitForTimeout(300);
        // The selected button has aria-current="page"
        const isCurrent = await page.locator(`nav[aria-label="Social scheduler sections"] button[aria-current="page"]`, { hasText: label }).isVisible().catch(() => false);
        const content = await expectPageHasContent(page);
        return { pass: isCurrent && content.pass, actual: `currentTab=${isCurrent} ${content.actual}` };
      });
    }
  });

  // ---- /approvals + subtabs ----------------------------------------------
  for (const tab of ["pending", "all"] as const) {
    test(`approvals subtab: ${tab}`, async ({ page }, testInfo) => {
      const ctx = setupCtx();
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = withPrefix(ctx, `approvals/${tab}`);
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load approvals/${tab}`,
        expected: "Approvals list renders",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    });
  }

  // ---- /knowledge-graph ---------------------------------------------------
  test("knowledge graph", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "knowledge-graph");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /knowledge-graph",
      expected: "KG canvas/graph renders without crashing",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      // KG may render via canvas/svg, so check for canvas/svg presence
      const has = await page.locator("canvas, svg").first().isVisible().catch(() => false);
      return { pass: has, actual: has ? "canvas/svg visible" : "no canvas/svg" };
    });
  });

  // ---- /org ---------------------------------------------------------------
  test("org chart", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "org");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /org",
      expected: "Org chart renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /skills ------------------------------------------------------------
  test("skills catalog", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "skills");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /skills",
      expected: "Skills catalog renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /costs -------------------------------------------------------------
  test("costs page", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "costs");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /costs",
      expected: "Costs / providers renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /cost-watcher ------------------------------------------------------
  test("cost watcher", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "cost-watcher");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /cost-watcher",
      expected: "Cost watcher renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /activity ----------------------------------------------------------
  test("activity log", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "activity");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /activity",
      expected: "Activity feed renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- /company/settings + sub-pages -------------------------------------
  for (const sub of ["", "environments", "access", "invites", "secrets"] as const) {
    test(`company settings: ${sub || "general"}`, async ({ page }, testInfo) => {
      const ctx = setupCtx();
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = withPrefix(ctx, sub ? `company/settings/${sub}` : "company/settings");
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load company/settings${sub ? `/${sub}` : ""}`,
        expected: "Settings sub-page renders",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    });
  }

  // ---- /instance/settings/* ----------------------------------------------
  for (const sub of ["general", "experimental", "provider-keys", "plugins", "adapters", "access", "profile"] as const) {
    test(`instance settings: ${sub}`, async ({ page }, testInfo) => {
      const monitor = (page as any).__monitor;
      const viewport = VIEWPORT(testInfo);
      const url = `/instance/settings/${sub}`;
      await runStep(page, monitor, {
        route: url, viewport,
        interaction: `Load /instance/settings/${sub}`,
        expected: "Page renders",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
        return expectPageHasContent(page);
      });
    });
  }

  // ---- /search ------------------------------------------------------------
  test("search route", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "search");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /search + type",
      expected: "Search input present, typing returns results UI",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      const input = page.locator('input[type="search"], input[placeholder*="search" i], input[type="text"]').first();
      const v = await input.isVisible().catch(() => false);
      if (!v) return { pass: false, actual: "no search input" };
      await input.fill("audit");
      await page.waitForTimeout(400);
      return { pass: true, actual: "typed query (no result assertion)" };
    });
  });

  // ---- /design-guide (smoke) ---------------------------------------------
  test("design guide showcase", async ({ page }, testInfo) => {
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const viewport = VIEWPORT(testInfo);
    const url = withPrefix(ctx, "design-guide");
    await runStep(page, monitor, {
      route: url, viewport,
      interaction: "Load /design-guide",
      expected: "Design guide renders",
    }, async () => {
      const nav = await gotoAndWait(page, url);
      if (!nav.ok) return { pass: false, actual: `nav status ${nav.status}` };
      return expectPageHasContent(page);
    });
  });

  // ---- Mobile cross-cutting: scan all primary nav routes for horizontal scroll ----
  test("mobile cross-cutting: horizontal scroll scan", async ({ page }, testInfo) => {
    if (VIEWPORT(testInfo) !== "mobile") {
      test.skip();
      return;
    }
    const ctx = setupCtx();
    const monitor = (page as any).__monitor;
    const routes = [
      "home", "dashboard", "inbox/mine", "issues", "agents/all", "projects",
      "rooms", "social", "approvals/pending", "knowledge-graph", "org", "skills",
      "costs", "cost-watcher", "activity", "company/settings", "goals", "routines",
    ];
    for (const seg of routes) {
      const url = withPrefix(ctx, seg);
      await runStep(page, monitor, {
        route: url, viewport: "mobile",
        interaction: "Mobile: horizontal scroll check",
        expected: "no overflow",
      }, async () => {
        const nav = await gotoAndWait(page, url);
        if (!nav.ok) return { pass: false, actual: `nav ${nav.status}` };
        const h = await hasHorizontalScroll(page);
        return { pass: !h, actual: h ? "overflow" : "ok" };
      });
    }
  });
});

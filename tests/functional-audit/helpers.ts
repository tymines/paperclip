import { type Page, type APIRequestContext, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type InteractionResult = {
  route: string;
  viewport: "desktop" | "mobile";
  interaction: string;
  expected: string;
  actual: string;
  pass: boolean;
  consoleErrors: number;
  firstConsoleError?: string;
  networkErrors: string[];
  notes?: string;
};

const RESULTS_FILE = path.resolve(__dirname, "results/interactions.jsonl");

export function ensureResultsDir() {
  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
}

export function appendResult(r: InteractionResult) {
  ensureResultsDir();
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(r) + "\n");
}

export type PageMonitor = {
  consoleErrors: { text: string; location?: string }[];
  pageErrors: string[];
  networkErrors: { url: string; status: number; method: string }[];
  reset: () => void;
};

export function attachMonitor(page: Page): PageMonitor {
  const monitor: PageMonitor = {
    consoleErrors: [],
    pageErrors: [],
    networkErrors: [],
    reset() {
      this.consoleErrors.length = 0;
      this.pageErrors.length = 0;
      this.networkErrors.length = 0;
    },
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter known noisy errors that aren't real bugs.
      if (text.includes("favicon") || text.includes("Failed to load resource: net::ERR_ABORTED")) return;
      monitor.consoleErrors.push({ text, location: msg.location().url });
    }
  });
  page.on("pageerror", (err) => {
    monitor.pageErrors.push(err.message + "\n" + err.stack);
  });
  page.on("response", (resp) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 400 && !url.includes("/api/health") && !url.includes("favicon")) {
      monitor.networkErrors.push({ url, status, method: resp.request().method() });
    }
  });
  return monitor;
}

export async function discoverCompanyPrefix(request: APIRequestContext, baseURL: string): Promise<string | null> {
  const res = await request.get(`${baseURL}/api/companies`);
  if (!res.ok()) return null;
  const data: any = await res.json();
  const list: any[] = Array.isArray(data) ? data : data?.companies ?? [];
  const first = list[0];
  if (!first) return null;
  return (first.issuePrefix || first.slug || "").toLowerCase();
}

export type AuditContext = {
  baseURL: string;
  companyPrefix: string;
  companyId: string;
  agentIds: string[];
  issueIds: string[];
  projectIds: string[];
  goalIds: string[];
  roomIds: string[];
  routineIds: string[];
};

export async function buildAuditContext(request: APIRequestContext, baseURL: string): Promise<AuditContext> {
  const companiesRes = await request.get(`${baseURL}/api/companies`);
  const companies: any[] = await companiesRes.json();
  const company = Array.isArray(companies) ? companies[0] : companies.companies?.[0];
  const ctx: AuditContext = {
    baseURL,
    companyPrefix: (company?.issuePrefix || "").toLowerCase(),
    companyId: company?.id,
    agentIds: [],
    issueIds: [],
    projectIds: [],
    goalIds: [],
    roomIds: [],
    routineIds: [],
  };
  // Discover entities
  try {
    const r = await request.get(`${baseURL}/api/agents?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.agents ?? [];
      ctx.agentIds = list.map((a) => a.id).filter(Boolean);
    }
  } catch {}
  try {
    const r = await request.get(`${baseURL}/api/issues?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.issues ?? [];
      ctx.issueIds = list.map((i) => i.id || i.shortKey).filter(Boolean);
    }
  } catch {}
  try {
    const r = await request.get(`${baseURL}/api/projects?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.projects ?? [];
      ctx.projectIds = list.map((p) => p.id).filter(Boolean);
    }
  } catch {}
  try {
    const r = await request.get(`${baseURL}/api/goals?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.goals ?? [];
      ctx.goalIds = list.map((g) => g.id).filter(Boolean);
    }
  } catch {}
  try {
    const r = await request.get(`${baseURL}/api/rooms?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.rooms ?? [];
      ctx.roomIds = list.map((r) => r.id).filter(Boolean);
    }
  } catch {}
  try {
    const r = await request.get(`${baseURL}/api/routines?companyId=${ctx.companyId}`);
    if (r.ok()) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j) ? j : j.routines ?? [];
      ctx.routineIds = list.map((r) => r.id).filter(Boolean);
    }
  } catch {}
  return ctx;
}

export async function runStep(
  page: Page,
  monitor: PageMonitor,
  meta: { route: string; viewport: "desktop" | "mobile"; interaction: string; expected: string },
  fn: () => Promise<{ pass: boolean; actual: string; notes?: string }>,
): Promise<InteractionResult> {
  monitor.reset();
  let result: { pass: boolean; actual: string; notes?: string };
  try {
    result = await fn();
  } catch (err: any) {
    result = { pass: false, actual: `THREW: ${err?.message ?? String(err)}` };
  }
  const r: InteractionResult = {
    ...meta,
    pass: result.pass && monitor.pageErrors.length === 0,
    actual: result.actual + (monitor.pageErrors.length ? ` | pageerror: ${monitor.pageErrors[0].slice(0, 200)}` : ""),
    consoleErrors: monitor.consoleErrors.length,
    firstConsoleError: monitor.consoleErrors[0]?.text?.slice(0, 200),
    networkErrors: monitor.networkErrors.map((e) => `${e.status} ${e.method} ${e.url}`).slice(0, 5),
    notes: result.notes,
  };
  appendResult(r);
  return r;
}

export async function gotoAndWait(page: Page, url: string): Promise<{ ok: boolean; status: number; notes?: string }> {
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const status = resp?.status() ?? 0;
    // Give the SPA a moment to render content beyond the shell.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    return { ok: status >= 200 && status < 400, status };
  } catch (err: any) {
    return { ok: false, status: 0, notes: err?.message };
  }
}

export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

export async function smallestTapTarget(page: Page): Promise<{ count: number; minSize: number; offenders: { tag: string; text: string; w: number; h: number }[] }> {
  return await page.evaluate(() => {
    // Only flag interactive elements with explicit pointer surface — not 1px hairline
    // dividers, focus-traps, screen-reader-only labels, or links inside other links.
    const targets = Array.from(document.querySelectorAll(
      'button:not([aria-hidden="true"]):not([tabindex="-1"]), a[href]:not([aria-hidden="true"]), [role="button"]:not([aria-hidden="true"]), [role="link"]:not([aria-hidden="true"]), input:not([type="hidden"]):not([aria-hidden="true"]):not([disabled]), select, textarea'
    )).filter((el) => {
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el as Element);
      if (rect.width === 0 || rect.height === 0) return false;
      if (styles.visibility === "hidden" || styles.display === "none" || styles.pointerEvents === "none") return false;
      // Skip elements positioned off-screen (common for sr-only focus traps).
      if (rect.top + rect.height < 0 || rect.left + rect.width < 0) return false;
      // Skip elements that are <2px in either dimension — those are decorative/hairline.
      if (rect.width < 2 || rect.height < 2) return false;
      return true;
    });
    let minSize = Infinity;
    const offenders: { tag: string; text: string; w: number; h: number }[] = [];
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const m = Math.min(r.width, r.height);
      if (m < minSize) minSize = m;
      if (m < 44) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    offenders.sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
    return {
      count: targets.length,
      minSize: minSize === Infinity ? 0 : minSize,
      offenders: offenders.slice(0, 5),
    };
  });
}

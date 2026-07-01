#!/usr/bin/env node
// Reads results/interactions.jsonl + results/context.json and emits the
// punch-list markdown report.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(__dirname, "results/interactions.jsonl");
const CTX = path.resolve(__dirname, "results/context.json");
const OUT = process.argv[2] || "/Users/augi/.openclaw/agents/codex/workspace/full-paperclip-audit.md";

function load() {
  if (!fs.existsSync(RESULTS)) {
    console.error(`No results file at ${RESULTS}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(RESULTS, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 240);
}

function mdTable(rows) {
  const header = "| Route | Viewport | Interaction | Expected | Actual | Pass | Console | Network | Notes |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => {
    const netSummary = (r.networkErrors || []).slice(0, 2).join("; ");
    return `| \`${esc(r.route)}\` | ${r.viewport} | ${esc(r.interaction)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.pass ? "✓" : "✗"} | ${r.consoleErrors}${r.firstConsoleError ? ` — ${esc(r.firstConsoleError)}` : ""} | ${esc(netSummary)} | ${esc(r.notes)} |`;
  });
  return [header, sep, ...body].join("\n");
}

function urgentRank(r) {
  // Higher score = more urgent.
  let s = 0;
  if (!r.pass) s += 10;
  if ((r.networkErrors || []).some((n) => n.startsWith("5"))) s += 5;
  if (r.consoleErrors > 0) s += 1;
  if (/page error|threw|nav status [45]/i.test(r.actual)) s += 5;
  if (/THREW/.test(r.actual)) s += 4;
  return s;
}

function main() {
  const ctx = fs.existsSync(CTX) ? JSON.parse(fs.readFileSync(CTX, "utf8")) : {};
  const all = load();
  const pass = all.filter((r) => r.pass).length;
  const fail = all.filter((r) => !r.pass).length;
  const total = all.length;
  const failures = all.filter((r) => !r.pass).sort((a, b) => urgentRank(b) - urgentRank(a));
  const desktopFail = failures.filter((r) => r.viewport === "desktop");
  const mobileFail = failures.filter((r) => r.viewport === "mobile");
  const top5 = failures.slice(0, 5);

  // Group by route
  const byRoute = new Map();
  for (const r of all) {
    if (!byRoute.has(r.route)) byRoute.set(r.route, []);
    byRoute.get(r.route).push(r);
  }
  const routeNames = Array.from(byRoute.keys()).sort();

  // Cross-cutting detectors
  const hScroll = all.filter((r) => /horizontal scroll/.test(r.interaction) && !r.pass);
  const tapWarn = all.filter((r) => /tap target/i.test(r.interaction) && (r.notes || "").includes("WARN"));
  const pageErrors = all.filter((r) => /pageerror/.test(r.actual));
  const networkFiveXx = all.filter((r) => (r.networkErrors || []).some((n) => n.startsWith("5")));
  const networkFourXx = all.filter((r) => (r.networkErrors || []).some((n) => /^4(0[03-9]|[12]\d)/.test(n)));

  // P0: pass=false AND (5xx OR pageerror OR THREW)
  const p0 = failures.filter((r) =>
    (r.networkErrors || []).some((n) => n.startsWith("5"))
    || /pageerror|THREW/.test(r.actual)
  );
  const p1 = failures.filter((r) => !p0.includes(r));
  const p2_mobile = [...hScroll, ...tapWarn];

  const lines = [];
  lines.push(`# Paperclip Full Functional Audit`);
  lines.push("");
  lines.push(`> Generated ${new Date().toISOString()} — fork \`codex/v2-pass-all\` worktree at \`/tmp/full-audit\`.`);
  lines.push("");
  lines.push(`## Executive summary`);
  lines.push("");
  lines.push(`- **Total interactions tested:** ${total} (${all.filter((r) => r.viewport === "desktop").length} desktop, ${all.filter((r) => r.viewport === "mobile").length} mobile)`);
  lines.push(`- **Pass:** ${pass} (${total ? Math.round((pass / total) * 100) : 0}%)`);
  lines.push(`- **Fail:** ${fail} (${total ? Math.round((fail / total) * 100) : 0}%)`);
  lines.push(`- **Desktop failures:** ${desktopFail.length}`);
  lines.push(`- **Mobile failures:** ${mobileFail.length}`);
  lines.push(`- **5xx responses observed:** ${networkFiveXx.length}`);
  lines.push(`- **4xx responses observed:** ${networkFourXx.length}`);
  lines.push(`- **Page errors (uncaught):** ${pageErrors.length}`);
  lines.push("");
  lines.push(`### Bootstrap context`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(ctx, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`### Top 5 most urgent broken interactions`);
  lines.push("");
  if (top5.length === 0) {
    lines.push("_None — all interactions passed (or the audit did not surface failures)._");
  } else {
    lines.push(mdTable(top5));
  }
  lines.push("");

  lines.push(`## Per-route breakdown`);
  lines.push("");
  for (const name of routeNames) {
    const rs = byRoute.get(name);
    const passCnt = rs.filter((r) => r.pass).length;
    const failCnt = rs.length - passCnt;
    lines.push(`### \`${name}\` — ${passCnt}/${rs.length} passing${failCnt ? ` (⚠ ${failCnt} fail)` : ""}`);
    lines.push("");
    lines.push(mdTable(rs));
    lines.push("");
  }

  lines.push(`## Cross-cutting issues`);
  lines.push("");
  lines.push(`### Mobile: horizontal-scroll overflow`);
  if (hScroll.length === 0) {
    lines.push("_No routes triggered horizontal-scroll detection._");
  } else {
    lines.push(`${hScroll.length} routes have horizontal overflow on 393px mobile viewport:`);
    for (const r of hScroll) lines.push(`- \`${r.route}\``);
  }
  lines.push("");
  lines.push(`### Mobile: tap targets below 44px`);
  if (tapWarn.length === 0) {
    lines.push("_All measured tap targets ≥ 44px._");
  } else {
    lines.push(`${tapWarn.length} routes have at least one tap target below the 44px Apple HIG target:`);
    for (const r of tapWarn) lines.push(`- \`${r.route}\` — ${r.actual} ${r.notes ?? ""}`);
  }
  lines.push("");
  lines.push(`### Network: 5xx responses`);
  if (networkFiveXx.length === 0) {
    lines.push("_No 5xx responses observed during audit._");
  } else {
    for (const r of networkFiveXx) {
      lines.push(`- \`${r.route}\` (${r.viewport}) — ${r.networkErrors.filter((n) => n.startsWith("5")).join(", ")}`);
    }
  }
  lines.push("");
  lines.push(`### Network: 4xx responses (excluding 401/404 on legit guards)`);
  if (networkFourXx.length === 0) {
    lines.push("_No 4xx responses observed during audit._");
  } else {
    const sample = networkFourXx.slice(0, 30);
    for (const r of sample) {
      lines.push(`- \`${r.route}\` (${r.viewport}) — ${r.networkErrors.filter((n) => /^4/.test(n)).join(", ")}`);
    }
    if (networkFourXx.length > 30) lines.push(`_(…${networkFourXx.length - 30} more)_`);
  }
  lines.push("");
  lines.push(`### Page errors (uncaught JS)`);
  if (pageErrors.length === 0) {
    lines.push("_No uncaught JS errors._");
  } else {
    for (const r of pageErrors) lines.push(`- \`${r.route}\` (${r.viewport}) — ${esc(r.actual)}`);
  }
  lines.push("");

  lines.push(`## Recommended fix order`);
  lines.push("");
  lines.push(`### P0 — Blockers (page errors, 5xx, uncaught exceptions)`);
  if (p0.length === 0) lines.push("_None._");
  else for (const r of p0) lines.push(`- \`${r.route}\` (${r.viewport}) — ${esc(r.interaction)} → ${esc(r.actual)}`);
  lines.push("");
  lines.push(`### P1 — Broken interactions`);
  if (p1.length === 0) lines.push("_None._");
  else for (const r of p1) lines.push(`- \`${r.route}\` (${r.viewport}) — ${esc(r.interaction)} → ${esc(r.actual)}`);
  lines.push("");
  lines.push(`### P2 — Visual polish / mobile-only`);
  if (p2_mobile.length === 0) lines.push("_None._");
  else for (const r of p2_mobile) lines.push(`- \`${r.route}\` (${r.viewport}) — ${esc(r.interaction)} → ${esc(r.actual)} ${r.notes ? `(${esc(r.notes)})` : ""}`);
  lines.push("");

  lines.push(`## Notes & honest caveats`);
  lines.push("");
  lines.push(`- The throwaway instance was bootstrapped via \`pnpm paperclipai onboard --yes --run\` with **no LLM provider key**, so any Jarvis/LLM-dependent interaction is operating in stub/mock mode. Failures on Brief-Me, transcription, and AI-driven actions should be interpreted as "feature relies on missing key" unless the failure is structural (no button found, JS error).`);
  lines.push(`- The audit covers the routes Tyler called out; some entity-detail pages (project, room, goal) were exercised only if global setup successfully created an entity via the public API. Failures to seed are surfaced in the bootstrap context JSON above.`);
  lines.push(`- Heuristic locators ("button matching /heartbeat|pause/i") may miss controls renamed to less expected labels — when a Pass appears with \`notes\` flagging a fallback locator, prefer to spot-check manually.`);
  lines.push(`- Tap-target threshold uses a soft floor of 32px for hard-fail and a 44px warning to surface borderline controls without flooding the queue.`);

  fs.writeFileSync(OUT, lines.join("\n"));
  console.log(`Report written to ${OUT}`);
  console.log(`Total: ${total}, Pass: ${pass}, Fail: ${fail}`);
}

main();

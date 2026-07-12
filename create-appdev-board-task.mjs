#!/usr/bin/env node
/**
 * Creates the Paperclip board task for the App Dev Control Center build.
 * Run on the HOST (where the server at :3100 is reachable):
 *   node create-appdev-board-task.mjs
 *
 * Auth: deployment is "authenticated" — supply one of:
 *   PAPERCLIP_AUTH_HEADER='Cookie: <your session cookie>'
 *   PAPERCLIP_AUTH_HEADER='Authorization: Bearer <agent api key>'
 * If unauthorized, the script prints the task body so it can be pasted into
 * the board manually.
 */
const BASE = process.env.PAPERCLIP_URL || "http://localhost:3100";
const AUTH = process.env.PAPERCLIP_AUTH_HEADER || "";

const TASK = {
  title: "[AppDev • feature] Control Center — review fable/appdev-control-center (Phases 1+2+VFG port)",
  description: [
    "Branch: fable/appdev-control-center (worktree .paperclip/worktrees/fable-appdev, off fable-snapshot-20260712).",
    "",
    "Landed: appdev_* schema (migration 0146 written, GATED — not journaled, not applied);",
    "deterministic gatekeeper (evidence-enforcing, typed appdev.* live events; supersedes ponytail — gate.ts untouched);",
    "routes /companies/:id/appdev/* incl. post-back API for the external pipeline;",
    "proof-bundle ingestion w/ secret scrubber; VFG-2 review ported OFF OpenAI to Claude vision;",
    "UI: /appdev board, /appdev/:appId/:tab detail, /appdev/queue (evidence-gated Approve); amber migration-pending states.",
    "",
    "To verify: run verify-appdev-build.cmd in the worktree (full pnpm install + shared/db build + server tsc + ui build).",
    "Decisions needing Tyler: (1) apply 0146 + journal reconciliation; (2) ponytail supersede ruling — see vault doc;",
    "(3) VFG reviewer model binding/cost. NO merge to master — behind Gym → War Room → World View → KG in the queue.",
  ].join("\n"),
  status: "todo",
  originKind: "app-feedback",
  originId: "missioncontrol",
};

async function main() {
  const headers = { "Content-Type": "application/json" };
  if (AUTH) {
    const idx = AUTH.indexOf(":");
    headers[AUTH.slice(0, idx).trim()] = AUTH.slice(idx + 1).trim();
  }
  try {
    const companiesRes = await fetch(`${BASE}/api/companies`, { headers });
    if (!companiesRes.ok) throw new Error(`GET /api/companies → ${companiesRes.status}`);
    const companies = await companiesRes.json();
    const company = (companies.companies ?? companies)[0];
    if (!company?.id) throw new Error("no company found");
    const res = await fetch(`${BASE}/api/companies/${company.id}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify(TASK),
    });
    if (!res.ok) throw new Error(`POST issues → ${res.status}: ${await res.text()}`);
    const issue = await res.json();
    console.log("Board task created:", issue.id ?? issue);
  } catch (err) {
    console.error("Could not create board task automatically:", err.message);
    console.error("\nPaste manually:\n\nTITLE: " + TASK.title + "\n\n" + TASK.description);
    process.exitCode = 1;
  }
}
main();

/**
 * Wire the canonical planning pipeline into the org hierarchy.
 *
 *   Hermes      (orchestrator / Chief of Staff — leader)
 *     └─ Brainstorm  (strategist / plan critic)   ⇄ planning loop with Hermes
 *          └─ Ares   (coo / execution distributor)
 *               └─ workers
 *
 * The org chart (GET /companies/:id/org) is auto-computed from each agent's
 * `reportsTo`. Brainstorm and Ares were previously *siblings* under Hermes, so
 * Brainstorm rendered as a dangling leaf off to the side of Ares' worker
 * subtree (it read as sitting at the bottom/edge of the org). This script
 * repositions the plan critic *between* the leader and the distributor, by ROLE
 * (not by hard-coded id), so the auto-layout draws a clean
 * Hermes → Brainstorm → Ares → workers chain:
 *
 *   strategist.reportsTo = orchestrator   (Brainstorm under Hermes)
 *   coo.reportsTo        = strategist     (Ares under Brainstorm — the handoff)
 *
 * Additive + idempotent: only rewires a company that has an orchestrator, a
 * strategist, and a coo, and only writes when a value actually changes. Does
 * NOT touch the bridge, memory-core, OpenViking, or QMD.
 *
 * Run from /Users/augi/paperclip:
 *   pnpm --filter @paperclipai/server exec tsx scripts/wire-planning-pipeline.ts
 *   pnpm --filter @paperclipai/server exec tsx scripts/wire-planning-pipeline.ts --company TYL
 *   pnpm --filter @paperclipai/server exec tsx scripts/wire-planning-pipeline.ts --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { createDb, agents, companies } from "@paperclipai/db";
import { and, eq, ne } from "drizzle-orm";

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  let port = 54329;
  const cfgPath = `${process.env.HOME}/.paperclip/instances/default/config.json`;
  if (existsSync(cfgPath)) {
    try {
      const p = JSON.parse(readFileSync(cfgPath, "utf8"))?.database?.embeddedPostgresPort;
      if (Number.isInteger(p) && p > 0) port = p as number;
    } catch {
      /* fall back to default port */
    }
  }
  return `postgresql://paperclip:paperclip@localhost:${port}/paperclip`;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const companyIdx = argv.indexOf("--company");
const companyFilter = companyIdx >= 0 ? argv[companyIdx + 1] ?? null : null;

async function main() {
  const db = createDb(resolveDatabaseUrl());
  const allCompanies = await db.select().from(companies);
  const targets = allCompanies.filter(
    (c) =>
      !companyFilter ||
      c.id === companyFilter ||
      c.issuePrefix === companyFilter ||
      c.name === companyFilter,
  );

  if (targets.length === 0) {
    console.log(`No companies matched${companyFilter ? ` "${companyFilter}"` : ""}.`);
    return;
  }

  let totalChanges = 0;
  for (const co of targets) {
    const roster = await db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, co.id), ne(agents.status, "terminated")));

    const byRole = (role: string) =>
      roster.find((a) => String(a.role).toLowerCase() === role) ?? null;
    const orchestrator = byRole("orchestrator");
    const strategist = byRole("strategist");
    const coo = byRole("coo");

    if (!orchestrator || !strategist || !coo) {
      console.log(
        `[skip] ${co.name} (${co.issuePrefix}) — needs orchestrator+strategist+coo; ` +
          `have orchestrator=${!!orchestrator} strategist=${!!strategist} coo=${!!coo}`,
      );
      continue;
    }

    console.log(`\n[company] ${co.name} (${co.issuePrefix})`);
    console.log(`  leader      : ${orchestrator.name}  [${orchestrator.id}]`);
    console.log(`  plan critic : ${strategist.name}  [${strategist.id}]`);
    console.log(`  distributor : ${coo.name}  [${coo.id}]`);

    const changes: Array<{ id: string; to: string; label: string }> = [];
    if (strategist.reportsTo !== orchestrator.id) {
      changes.push({
        id: strategist.id,
        to: orchestrator.id,
        label: `${strategist.name} → ${orchestrator.name}`,
      });
    }
    if (coo.reportsTo !== strategist.id) {
      changes.push({
        id: coo.id,
        to: strategist.id,
        label: `${coo.name} → ${strategist.name}`,
      });
    }

    if (changes.length === 0) {
      console.log("  already wired — no change.");
      continue;
    }

    for (const change of changes) {
      console.log(`  ${dryRun ? "[dry-run] would set" : "set"} reportsTo: ${change.label}`);
      if (!dryRun) {
        await db
          .update(agents)
          .set({ reportsTo: change.to, updatedAt: new Date() })
          .where(eq(agents.id, change.id));
      }
      totalChanges += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done. ${totalChanges} reportsTo value(s) ${
      dryRun ? "would change" : "changed"
    }.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("wire-planning-pipeline failed:", err);
    process.exit(1);
  });

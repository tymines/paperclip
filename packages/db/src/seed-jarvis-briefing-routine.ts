// Seeds the "Daily Jarvis Briefing" routine — a cron-scheduled trigger at
// 7am Tyler-local that fires the Daddy's Home morning briefing flow on
// the server. Idempotent: existing routines with the same title are
// updated in place rather than duplicated.
//
//   pnpm --filter @paperclipai/db exec tsx src/seed-jarvis-briefing-routine.ts
//
// Picks the first company in the database. Pass --company-id <uuid> to
// target a specific company. Pass --timezone <iana> to override the cron TZ.
//
// The runtime cron worker calls POST /api/companies/:id/jarvis/daddys-home
// when this trigger fires (handled by the routine dispatch code, which
// reads the trigger payload and hits the URL). This seed only registers
// the routine + trigger rows.

import { and, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  companies,
  routines,
  routineRevisions,
  routineTriggers,
} from "./schema/index.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);

const args = process.argv.slice(2);
let targetCompanyId: string | null = null;
let timezone = "America/Los_Angeles";
let cronExpression = "0 7 * * *"; // 7am local, every day
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--company-id" && args[i + 1]) {
    targetCompanyId = args[i + 1]!;
    i++;
  } else if (args[i] === "--timezone" && args[i + 1]) {
    timezone = args[i + 1]!;
    i++;
  } else if (args[i] === "--cron" && args[i + 1]) {
    cronExpression = args[i + 1]!;
    i++;
  }
}

const company = targetCompanyId
  ? await db
      .select()
      .from(companies)
      .where(eq(companies.id, targetCompanyId))
      .then((rows) => rows[0] ?? null)
  : await db
      .select()
      .from(companies)
      .limit(1)
      .then((rows) => rows[0] ?? null);

if (!company) {
  console.error("No company found. Run the base seed first or pass --company-id.");
  process.exit(1);
}

console.log(`Seeding daily-jarvis-briefing into "${company.name}" (${company.id})`);

const ROUTINE_TITLE = "Daily Jarvis Briefing";
const ROUTINE_DESCRIPTION =
  "Fires the Daddy's Home morning briefing every day at 7am Tyler-local. Calls POST /api/companies/:id/jarvis/daddys-home with source=schedule, which gathers a live ops snapshot (shipped overnight, blocked work, fleet health, project progress) and asks Augi for a 4-6 sentence spoken briefing per the persona's morning-briefing section.";

const existing = await db
  .select()
  .from(routines)
  .where(
    and(eq(routines.companyId, company.id), eq(routines.title, ROUTINE_TITLE)),
  )
  .then((rows) => rows[0] ?? null);

let routineId: string;
if (existing) {
  console.log(`  routine already exists (${existing.id}) — updating description`);
  await db
    .update(routines)
    .set({
      description: ROUTINE_DESCRIPTION,
      status: "active",
      priority: "high",
      updatedAt: new Date(),
    })
    .where(eq(routines.id, existing.id));
  routineId = existing.id;
} else {
  const [created] = await db
    .insert(routines)
    .values({
      companyId: company.id,
      title: ROUTINE_TITLE,
      description: ROUTINE_DESCRIPTION,
      status: "active",
      priority: "high",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      variables: [],
      latestRevisionNumber: 1,
    })
    .returning();
  if (!created) throw new Error("Failed to insert routine");
  routineId = created.id;
  console.log(`  routine inserted (${routineId})`);

  await db.insert(routineRevisions).values({
    companyId: company.id,
    routineId,
    revisionNumber: 1,
    title: ROUTINE_TITLE,
    description: ROUTINE_DESCRIPTION,
    snapshot: {
      version: 1,
      routine: {
        id: routineId,
        companyId: company.id,
        projectId: null,
        goalId: null,
        parentIssueId: null,
        title: ROUTINE_TITLE,
        description: ROUTINE_DESCRIPTION,
        assigneeAgentId: null,
        priority: "high",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        variables: [],
        env: null,
      },
      triggers: [],
    },
    changeSummary: "Initial seed of daily-jarvis-briefing.",
  });
}

const existingTrigger = await db
  .select()
  .from(routineTriggers)
  .where(
    and(
      eq(routineTriggers.companyId, company.id),
      eq(routineTriggers.routineId, routineId),
      eq(routineTriggers.kind, "schedule"),
    ),
  )
  .then((rows) => rows[0] ?? null);

if (existingTrigger) {
  console.log(
    `  trigger already exists (${existingTrigger.id}) — updating cron/timezone`,
  );
  await db
    .update(routineTriggers)
    .set({
      cronExpression,
      timezone,
      enabled: true,
      label: "Daily 7am Tyler-local",
      updatedAt: new Date(),
    })
    .where(eq(routineTriggers.id, existingTrigger.id));
} else {
  await db.insert(routineTriggers).values({
    companyId: company.id,
    routineId,
    kind: "schedule",
    label: "Daily 7am Tyler-local",
    enabled: true,
    cronExpression,
    timezone,
  });
  console.log(`  trigger inserted (cron="${cronExpression}" tz="${timezone}")`);
}

console.log("Seed complete");
process.exit(0);

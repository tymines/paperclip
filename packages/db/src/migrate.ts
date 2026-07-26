import { applyPendingMigrations, inspectMigrations } from "./client.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main(): Promise<void> {
  const resolved = await resolveMigrationConnection();

  console.log(`Migrating database via ${resolved.source}`);

  try {
    const before = await inspectMigrations(resolved.connectionString);
    if (before.status === "upToDate") {
      console.log("No pending migrations");
      return;
    }

    console.log(`Applying ${before.pendingMigrations.length} pending migration(s)...`);
    await applyPendingMigrations(resolved.connectionString);

    const after = await inspectMigrations(resolved.connectionString);
    if (after.status !== "upToDate") {
      throw new Error(`Migrations incomplete: ${after.pendingMigrations.join(", ")}`);
    }
    console.log("Migrations complete");

    // Data migrations — awaited, part of the deploy gate: writes must never
    // be accepted against un-backfilled state (0158 vault human_locked →
    // manuscript_chapters.locked, idempotent, strictly upward).
    const { runChapterLockBackfill } = await import("./data-migrations/index.js");
    const { createDb } = await import("./client.js");
    const db = createDb(resolved.connectionString);
    const imported = await runChapterLockBackfill(db);
    if (imported > 0) {
      console.log(`Data migration: imported ${imported} human_locked chapter(s) into manuscript_chapters.locked`);
    } else {
      console.log("Data migrations complete (nothing to backfill)");
    }
  } finally {
    await resolved.stop();
  }
}

await main();

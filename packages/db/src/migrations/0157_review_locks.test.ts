import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, "0157_review_locks.sql"), "utf8");
const journal = JSON.parse(
  fs.readFileSync(path.join(here, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

describe("0157 review-lock migration safety", () => {
  it("is registered in the migration journal at the next index", () => {
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 153,
      tag: "0157_review_locks",
    });
  });

  it("backfills human_locked frontmatter before making locked non-null", () => {
    const addColumnAt = migration.indexOf('ADD COLUMN IF NOT EXISTS "locked" boolean;');
    const backfillAt = migration.indexOf('UPDATE "manuscript_chapters"');
    const notNullAt = migration.indexOf('ALTER COLUMN "locked" SET NOT NULL');

    expect(addColumnAt).toBeGreaterThanOrEqual(0);
    expect(backfillAt).toBeGreaterThan(addColumnAt);
    expect(notNullAt).toBeGreaterThan(backfillAt);
    expect(migration).toContain("human_locked[[:space:]]*:[[:space:]]*true");
    expect(migration).toContain("human_locked[[:space:]]*:[[:space:]]*false");
  });

  it("fails closed for legacy prose whose frontmatter is unavailable", () => {
    expect(migration).toContain(
      `WHEN BTRIM("content") <> '' THEN true`,
    );
    expect(migration).toContain('ALTER COLUMN "locked" SET DEFAULT false');
  });
});

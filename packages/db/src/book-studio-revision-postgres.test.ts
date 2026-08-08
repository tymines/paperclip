import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const databaseUrl = process.env.BOOK_STUDIO_REVISION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const schema = `book_revision_${process.pid}`;
const tableNames = [
  "books", "story_bible_characters", "story_bible_world_locations", "story_bible_style", "story_bible_outline",
  "bible_lore", "bible_factions", "bible_objects", "bible_systems", "bible_timeline_events", "bible_threads",
  "bible_themes", "bible_glossary", "bible_relationships", "bible_facts",
] as const;

suite("Book Studio centralized revisions on PostgreSQL", () => {
  const sql = postgres(databaseUrl!, { max: 4, prepare: false, onnotice: () => {} });

  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}`);
    for (const table of tableNames) {
      await sql.unsafe(`CREATE TABLE "${table}" (
        id text PRIMARY KEY,
        payload text NOT NULL DEFAULT '',
        locked boolean NOT NULL DEFAULT false,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL
      )`);
    }
    const migration = readFileSync(new URL("./migrations/0167_book_studio_revision_tokens.sql", import.meta.url), "utf8");
    await sql.unsafe(migration);
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sql.end();
  });

  it("installs one centralized revision trigger on all 15 mutable tables", async () => {
    const triggers = await sql<{ tableName: string; triggerName: string }[]>`
      SELECT event_object_table AS "tableName", trigger_name AS "triggerName"
      FROM information_schema.triggers
      WHERE trigger_schema = ${schema} AND trigger_name LIKE '%_advance_revision'
      ORDER BY event_object_table
    `;
    expect(triggers).toHaveLength(15);
    expect(new Set(triggers.map((row) => row.tableName))).toEqual(new Set(tableNames));
  });

  it("advances exactly once for every table and overrides caller revision assignments", async () => {
    for (const table of tableNames) {
      await sql.unsafe(`INSERT INTO "${table}" (id, updated_at) VALUES ('coverage', '2026-08-08 12:34:56.123456+00')`);
      const [row] = await sql.unsafe<{ revision: number; updatedAt: string }[]>(`
        UPDATE "${table}"
        SET payload = 'direct-writer', revision = revision + 99
        WHERE id = 'coverage'
        RETURNING revision, updated_at::text AS "updatedAt"
      `);
      expect(row.revision, table).toBe(2);
      expect(row.updatedAt, table).toContain(".123456");
    }
  });

  it("advances exactly once for representative Calliope, lock, media, extraction, autopilot, chapter, and review writers", async () => {
    const writers = [
      ["story_bible_characters", "calliope"],
      ["story_bible_outline", "lock"],
      ["story_bible_world_locations", "media"],
      ["bible_facts", "extraction"],
      ["books", "autopilot"],
      ["story_bible_style", "chapter-generation"],
      ["bible_lore", "review"],
    ] as const;
    for (const [table, writer] of writers) {
      const id = `writer-${writer}`;
      await sql.unsafe(`INSERT INTO "${table}" (id, updated_at) VALUES ('${id}', now())`);
      const [row] = await sql.unsafe<{ revision: number }[]>(`UPDATE "${table}" SET payload = '${writer}' WHERE id = '${id}' RETURNING revision`);
      expect(row.revision, writer).toBe(2);
    }
  });

  async function staleHumanAfterWriter(table: "story_bible_characters" | "story_bible_outline" | "story_bible_world_locations", id: string, writerSet: string) {
    await sql.unsafe(`INSERT INTO "${table}" (id, updated_at) VALUES ('${id}', now())`);
    const writer = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    const human = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    await writer.unsafe(`SET search_path TO ${schema}`);
    await human.unsafe(`SET search_path TO ${schema}`);
    let humanAttempt: any;
    await writer.begin(async (tx) => {
      await tx.unsafe(`UPDATE "${table}" SET ${writerSet} WHERE id = '${id}'`);
      humanAttempt = human.unsafe(`UPDATE "${table}" SET payload = 'stale-human' WHERE id = '${id}' AND revision = 1 RETURNING revision`).then((rows) => rows);
      await tx.unsafe("SELECT pg_sleep(0.05)");
    });
    const stale = await humanAttempt!;
    const [current] = await sql.unsafe<{ revision: number; payload: string; locked: boolean; metadata: Record<string, unknown> }[]>(`SELECT revision, payload, locked, metadata FROM "${table}" WHERE id = '${id}'`);
    await Promise.all([writer.end(), human.end()]);
    return { stale, current };
  }

  it("prevents stale human CRUD from overwriting Calliope, lock, or media work", async () => {
    const calliope = await staleHumanAfterWriter("story_bible_characters", "race-calliope", "payload = 'calliope'");
    expect(calliope.stale).toHaveLength(0);
    expect(calliope.current).toMatchObject({ revision: 2, payload: "calliope" });

    const lock = await staleHumanAfterWriter("story_bible_outline", "race-lock", "locked = true");
    expect(lock.stale).toHaveLength(0);
    expect(lock.current).toMatchObject({ revision: 2, locked: true });

    const media = await staleHumanAfterWriter("story_bible_world_locations", "race-media", `metadata = '{"imageUrl":"asset.png"}'::jsonb`);
    expect(media.stale).toHaveLength(0);
    expect(media.current.revision).toBe(2);
    expect(media.current.metadata).toEqual({ imageUrl: "asset.png" });
  });
});

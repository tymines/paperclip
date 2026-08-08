import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  companies,
  createDb,
  imageProviders,
  personaGenerations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { imageStudioRoutes } from "../routes/image-studio.js";

const externalDatabaseUrl = process.env.IMAGE_STUDIO_TEST_DATABASE_URL?.trim();
let cleanupDatabase = async () => {};
let connectionString: string;
if (externalDatabaseUrl) {
  connectionString = externalDatabaseUrl;
  await applyPendingMigrations(connectionString);
} else {
  const support = await getEmbeddedPostgresTestSupport();
  assert.equal(support.supported, true, support.reason ?? "embedded PostgreSQL unavailable");
  const tempDb = await startEmbeddedPostgresTestDatabase("paperclip-image-gallery-pagination-");
  connectionString = tempDb.connectionString;
  cleanupDatabase = tempDb.cleanup;
}
const db = createDb(connectionString);

try {
  const [company] = await db
    .insert(companies)
    .values({
      name: `Gallery pagination ${randomUUID()}`,
      issuePrefix: `GP${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  const [persona] = await db
    .insert(imageProviders)
    .values({
      companyId: company!.id,
      name: "Pagination Persona",
      type: "local_lora",
      providerHost: "replicate",
      status: "ready",
    })
    .returning();

  const rows = await db
    .insert(personaGenerations)
    .values(
      ["a", "b", "c", "d"].map((suffix) => ({
        personaId: persona!.id,
        source: "production",
        imagePath: `personas/pagination/${suffix}.webp`,
      })),
    )
    .returning();

  // Preserve PostgreSQL precision that JavaScript Date cannot represent. The
  // second page starts within the same millisecond as the first page boundary.
  const exactTimestamps = [
    "2026-08-08 12:00:00.123789+00",
    "2026-08-08 12:00:00.123456+00",
    "2026-08-08 12:00:00.123455+00",
    "2026-08-08 12:00:00.123454+00",
  ];
  for (let index = 0; index < rows.length; index += 1) {
    await db.execute(sql`
      update persona_generations
      set created_at = ${exactTimestamps[index]}::timestamptz
      where id = ${rows[index]!.id}::uuid
    `);
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", userId: "pagination-test", source: "local_implicit" };
    next();
  });
  app.use(imageStudioRoutes(db, undefined, { providers: [] }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 500;
    const message = error instanceof Error ? error.message : "Internal error";
    res.status(status).json({ error: message });
  });

  const first = await request(app)
    .get(`/image-studio/personas/${persona!.id}/generations`)
    .query({ limit: 2 })
    .expect(200);
  assert.deepEqual(
    first.body.generations.map((row: { id: string }) => row.id),
    rows.slice(0, 2).map((row) => row.id),
  );
  assert.equal(typeof first.body.nextCursor, "string");

  const second = await request(app)
    .get(`/image-studio/personas/${persona!.id}/generations`)
    .query({ limit: 2, cursor: first.body.nextCursor })
    .expect(200);
  assert.deepEqual(
    second.body.generations.map((row: { id: string }) => row.id),
    rows.slice(2).map((row) => row.id),
  );
  assert.equal(second.body.nextCursor, null);

  const allIds = [...first.body.generations, ...second.body.generations].map(
    (row: { id: string }) => row.id,
  );
  assert.equal(new Set(allIds).size, rows.length);
  assert.deepEqual(allIds, rows.map((row) => row.id));

  console.log(
    JSON.stringify({
      ok: true,
      pages: [first.body.generations.length, second.body.generations.length],
      sameMillisecondBoundaryPreserved: true,
      duplicates: false,
      omissions: false,
    }),
  );
} finally {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  await cleanupDatabase();
}

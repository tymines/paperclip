import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  companies,
  createDb,
  jarvisConversations,
  jarvisLearnedPreferences,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  fetchLearnedPreferences,
  fetchRecentTurns,
  formatConversationHistoryBlock,
  formatLearnedPreferencesBlock,
  upsertLearnedPreference,
} from "../services/jarvis-learning.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

async function seedCompany(db: ReturnType<typeof createDb>) {
  const [company] = await db
    .insert(companies)
    .values({
      name: `Learning Test ${randomUUID()}`,
      issuePrefix: `LT${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return company!;
}

describeEmbeddedPostgres("jarvis learning + memory", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-jarvis-learning-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(jarvisLearnedPreferences);
    await db.delete(jarvisConversations);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("fetchRecentTurns returns the last 5 turns in chronological order", async () => {
    const company = await seedCompany(db);
    const actor = "user-tyler";

    for (let i = 1; i <= 7; i += 1) {
      await db.insert(jarvisConversations).values({
        companyId: company.id,
        userActorId: actor,
        userTranscript: `user message ${i}`,
        agentReply: `agent reply ${i}`,
      });
      // Tiny pause so created_at differs row to row.
      await new Promise((r) => setTimeout(r, 5));
    }

    const turns = await fetchRecentTurns(db, company.id, actor);
    expect(turns).toHaveLength(5);
    // Oldest of the kept window first → message 3, 4, 5, 6, 7.
    expect(turns[0]!.userTranscript).toBe("user message 3");
    expect(turns[4]!.userTranscript).toBe("user message 7");
  });

  it(
    "fetchRecentTurns bounds the working window to the current session " +
      "(turns before the last Clear chat are excluded)",
    async () => {
      const company = await seedCompany(db);
      const actor = "user-tyler";

      // Three turns in the FIRST session.
      for (let i = 1; i <= 3; i += 1) {
        await db.insert(jarvisConversations).values({
          companyId: company.id,
          userActorId: actor,
          userTranscript: `pre-clear message ${i}`,
          agentReply: `pre-clear reply ${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // Tyler hits "Clear chat": stamp cleared_at on the visible rows. This is
      // exactly what the /conversations/clear route does.
      const clearMoment = new Date();
      await db
        .update(jarvisConversations)
        .set({ clearedAt: clearMoment })
        .where(eq(jarvisConversations.companyId, company.id));

      await new Promise((r) => setTimeout(r, 10));

      // Two turns in the NEW (post-clear) session.
      for (let i = 1; i <= 2; i += 1) {
        await db.insert(jarvisConversations).values({
          companyId: company.id,
          userActorId: actor,
          userTranscript: `post-clear message ${i}`,
          agentReply: `post-clear reply ${i}`,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      const turns = await fetchRecentTurns(db, company.id, actor);
      // Only the current session's turns are in the working window; the
      // pre-clear turns are still STORED but out of the active context.
      expect(turns).toHaveLength(2);
      expect(turns.map((t) => t.userTranscript)).toEqual([
        "post-clear message 1",
        "post-clear message 2",
      ]);
      // Pre-clear turns are not deleted — they remain in the table.
      const all = await db
        .select({ id: jarvisConversations.id })
        .from(jarvisConversations)
        .where(eq(jarvisConversations.companyId, company.id));
      expect(all).toHaveLength(5);
    },
  );

  it("formatConversationHistoryBlock renders turns into a CONVERSATION HISTORY block", async () => {
    const company = await seedCompany(db);
    const actor = "user-tyler";
    await db.insert(jarvisConversations).values({
      companyId: company.id,
      userActorId: actor,
      userTranscript: "how many things are blocked on me?",
      agentReply: "three — health check, bulk upload, social doc.",
    });
    const turns = await fetchRecentTurns(db, company.id, actor);
    const block = formatConversationHistoryBlock(turns);
    expect(block).toContain("CONVERSATION HISTORY");
    expect(block).toContain("blocked on me");
    expect(block).toContain("health check");
  });

  it("upsert + fetch round-trip orders preferences by confidence", async () => {
    const company = await seedCompany(db);
    const actor = "user-tyler";

    await upsertLearnedPreference(db, {
      companyId: company.id,
      userActorId: actor,
      key: "voice_provider",
      value: "elevenlabs_adam",
      confidence: 0.9,
    });
    await upsertLearnedPreference(db, {
      companyId: company.id,
      userActorId: actor,
      key: "length_budget",
      value: "tight_no_book",
      confidence: 1.0,
    });
    await upsertLearnedPreference(db, {
      companyId: company.id,
      userActorId: actor,
      key: "briefing_focus",
      value: "work_first_not_revenue",
      confidence: 1.0,
    });

    const prefs = await fetchLearnedPreferences(db, company.id, actor);
    expect(prefs).toHaveLength(3);
    // Highest-confidence rows come first; both 1.0 rows sit above the 0.9 row.
    expect(prefs[0]!.confidence).toBeGreaterThanOrEqual(prefs[1]!.confidence);
    expect(prefs[1]!.confidence).toBeGreaterThanOrEqual(prefs[2]!.confidence);
    expect(prefs[2]!.key).toBe("voice_provider");

    const block = formatLearnedPreferencesBlock(prefs);
    expect(block).toContain("LEARNED PREFERENCES");
    expect(block).toContain("voice_provider = elevenlabs_adam");
    expect(block).toContain("briefing_focus = work_first_not_revenue");
    expect(block).toContain("length_budget = tight_no_book");
  });

  it("upserting the same key bumps confidence toward 1.0 instead of duplicating", async () => {
    const company = await seedCompany(db);
    const actor = "user-tyler";

    await upsertLearnedPreference(db, {
      companyId: company.id,
      userActorId: actor,
      key: "length_budget",
      value: "tight_no_book",
      confidence: 0.3,
    });
    await upsertLearnedPreference(db, {
      companyId: company.id,
      userActorId: actor,
      key: "length_budget",
      value: "tight_no_book",
      confidence: 0.6,
    });

    const prefs = await fetchLearnedPreferences(db, company.id, actor);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.confidence).toBeGreaterThan(0.3);
    expect(prefs[0]!.confidence).toBeLessThanOrEqual(1.0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { books, createDb, jarvisDelegations, storyBibleChatMessages, type Db } from "@paperclipai/db";
import { claimBrainstormRetry, persistBrainstormCompletion, persistBrainstormFailure } from "../routes/book-studio.js";
import { reconcileBookChatTurns } from "../services/book-chat-recovery.js";

const adminUrl = process.env.BOOK_STUDIO_POSTGRES_TEST_URL;
const runPostgres = describe.skipIf(!adminUrl);
const companyId = "00000000-0000-4000-8000-000000000001";
const bookId = "10000000-0000-4000-8000-000000000001";
const turnId = "20000000-0000-4000-8000-000000000001";
const userMessageId = "30000000-0000-4000-8000-000000000001";
const originalAttemptId = "40000000-0000-4000-8000-000000000001";
const conversationId = "book-studio:company-1:book-1";

function withDatabase(url: string, databaseName: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function waitForAdvisoryWaiter(observer: Db) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const raw: any = await observer.execute(sql`
      select count(*)::int as count
      from pg_locks
      where locktype = 'advisory' and not granted
    `);
    const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the Book Studio transaction to block on the advisory lock");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

runPostgres("Book Studio chat serialization (real PostgreSQL 17)", { timeout: 30_000 }, () => {
  const databaseName = `pc_book_chat_${process.pid}_${Date.now()}`;
  let admin: Db;
  let racer: Db;
  let observer: Db;
  let db: Db;

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await admin.execute(sql.raw(`create database "${databaseName}"`));
    const testUrl = withDatabase(adminUrl!, databaseName);
    db = createDb(testUrl);
    racer = createDb(testUrl);
    observer = createDb(testUrl);
    await db.execute(sql.raw(`
      create table books (
        id uuid primary key,
        company_id uuid not null
      );
      create table jarvis_delegations (
        id uuid primary key,
        company_id uuid not null,
        conversation_id uuid,
        agent text not null,
        task text not null,
        status text not null default 'queued',
        result text,
        metadata jsonb,
        worker_status text,
        team_run_id uuid,
        requested_by_actor_id text,
        created_at timestamptz not null default now(),
        completed_at timestamptz
      )
    `));
    await db.execute(sql.raw(`
      create table story_bible_chat_messages (
        id uuid primary key default gen_random_uuid(),
        book_id uuid not null,
        turn_id uuid,
        role text not null,
        content text not null,
        status text not null default 'completed',
        via text,
        dispatch_attempt_id uuid unique,
        delegation_id uuid,
        conversation_id text,
        retry_count integer not null default 0,
        retryable boolean not null default true,
        "authorization" jsonb,
        action_result jsonb,
        error text,
        archived_at timestamptz,
        created_at timestamptz not null default now(),
        unique (book_id, turn_id, role)
      )
    `));
    await db.execute(sql`insert into books (id, company_id) values (${bookId}, ${companyId})`);
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table story_bible_chat_messages, jarvis_delegations"));
  });

  afterAll(async () => {
    await db?.$client.end().catch(() => {});
    await racer?.$client.end().catch(() => {});
    await observer?.$client.end().catch(() => {});
    if (admin) {
      await admin.execute(sql`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${databaseName} and pid <> pg_backend_pid()
      `).catch(() => {});
      await admin.execute(sql.raw(`drop database if exists "${databaseName}"`)).catch(() => {});
      await admin.$client.end().catch(() => {});
    }
  });

  async function insertTurn(overrides: Partial<typeof storyBibleChatMessages.$inferInsert> = {}) {
    await db.insert(storyBibleChatMessages).values({
      id: userMessageId,
      bookId,
      turnId,
      role: "user",
      content: "Keep the exact latest instruction.",
      status: "failed",
      dispatchAttemptId: originalAttemptId,
      delegationId: originalAttemptId,
      conversationId,
      retryable: true,
      error: "safe to retry",
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
      ...overrides,
    });
  }

  it("allows only one concurrent retry claim and leaves exactly one pending turn", async () => {
    await insertTurn();
    const attempts = [
      "40000000-0000-4000-8000-000000000002",
      "40000000-0000-4000-8000-000000000003",
    ];
    const outcomes = await Promise.allSettled(attempts.map((retryDispatchAttemptId) =>
      claimBrainstormRetry(db, { bookId, turnId, retryDispatchAttemptId, defaultConversationId: conversationId })));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const [row] = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.id, userMessageId));
    expect(row).toMatchObject({ status: "pending", retryCount: 1 });
    expect(attempts).toContain(row.dispatchAttemptId);
    const pending = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.status, "pending"));
    expect(pending).toHaveLength(1);
  });

  it("waits for a concurrent newer human message, then rejects the stale retry", async () => {
    await insertTurn();
    const held = deferred();
    const release = deferred();
    const writer = racer.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`book-chat:${bookId}`}))`);
      await tx.insert(storyBibleChatMessages).values({
        id: "30000000-0000-4000-8000-000000000002",
        bookId,
        turnId: "20000000-0000-4000-8000-000000000002",
        role: "user",
        content: "Newer instruction",
        status: "completed",
        conversationId,
        retryable: true,
        createdAt: new Date("2026-08-05T00:01:00.000Z"),
      });
      held.resolve();
      await release.promise;
    });
    await held.promise;

    const claim = claimBrainstormRetry(db, {
      bookId,
      turnId,
      retryDispatchAttemptId: "40000000-0000-4000-8000-000000000004",
      defaultConversationId: conversationId,
    });
    await waitForAdvisoryWaiter(observer);
    release.resolve();
    await writer;

    await expect(claim).rejects.toMatchObject({ status: 409 });
    const [original] = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.id, userMessageId));
    expect(original).toMatchObject({ status: "failed", retryCount: 0, dispatchAttemptId: originalAttemptId });
  });

  it("does not let a stale lane failure overwrite a newer pending retry attempt", async () => {
    await insertTurn({ status: "pending", error: null });
    const nextAttemptId = "40000000-0000-4000-8000-000000000005";
    const held = deferred();
    const release = deferred();
    const retryWriter = racer.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`book-chat:${bookId}`}))`);
      await tx.update(storyBibleChatMessages)
        .set({ dispatchAttemptId: nextAttemptId, delegationId: nextAttemptId })
        .where(eq(storyBibleChatMessages.id, userMessageId));
      held.resolve();
      await release.promise;
    });
    await held.promise;

    const failure = persistBrainstormFailure(db, {
      bookId,
      turnId,
      userMessageId,
      conversationId,
      dispatchAttemptId: originalAttemptId,
      error: "late old-lane failure",
      retryable: false,
      delegationId: originalAttemptId,
    });
    await waitForAdvisoryWaiter(observer);
    release.resolve();
    await retryWriter;

    await expect(failure).resolves.toBe(false);
    const [row] = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.id, userMessageId));
    expect(row).toMatchObject({ status: "pending", dispatchAttemptId: nextAttemptId, delegationId: nextAttemptId, error: null });
  });

  it("leaves a just-completed delegation for the owning POST instead of racing it", async () => {
    const createdAt = new Date("2026-08-08T00:00:00.000Z");
    await insertTurn({ status: "pending", error: null, retryable: true, createdAt });
    await db.insert(jarvisDelegations).values({
      id: originalAttemptId,
      companyId,
      agent: "calliope",
      task: "Answer the current Book Studio turn",
      status: "completed",
      result: "Calliope completed successfully.",
      completedAt: new Date("2026-08-08T00:00:20.000Z"),
    });

    await expect(reconcileBookChatTurns(db, {
      companyId,
      bookId,
      now: new Date("2026-08-08T00:01:00.000Z"),
    })).resolves.toEqual({ reconciled: 0 });

    await expect(persistBrainstormCompletion(db, {
      companyId,
      bookId,
      turnId,
      userMessageId,
      actor: { actorType: "user", actorId: "board-user" },
      authorization: null,
      reply: "Calliope completed successfully.",
      conversationId,
      dispatchAttemptId: originalAttemptId,
      delegationId: originalAttemptId,
    })).resolves.toMatchObject({ reply: "Calliope completed successfully." });

    const rows = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.turnId, turnId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.role === "user")).toMatchObject({ status: "completed", via: "calliope", error: null });
    expect(rows.find((row) => row.role === "assistant")).toMatchObject({ status: "completed", via: "calliope", content: "Calliope completed successfully." });
  });

  it("restores a completed delegation result after genuine process-loss grace", async () => {
    const createdAt = new Date("2026-08-08T00:00:00.000Z");
    await insertTurn({ status: "pending", error: null, retryable: true, createdAt });
    await db.insert(jarvisDelegations).values({
      id: originalAttemptId,
      companyId,
      agent: "calliope",
      task: "Answer the current Book Studio turn",
      status: "completed",
      result: "Recovered Calliope reply.",
      completedAt: new Date("2026-08-08T00:00:20.000Z"),
    });

    await expect(reconcileBookChatTurns(db, {
      companyId,
      bookId,
      now: new Date("2026-08-08T00:10:00.000Z"),
    })).resolves.toEqual({ reconciled: 1 });

    const rows = await db.select().from(storyBibleChatMessages).where(eq(storyBibleChatMessages.turnId, turnId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.role === "user")).toMatchObject({ status: "completed", via: "calliope", error: null });
    expect(rows.find((row) => row.role === "assistant")).toMatchObject({ status: "completed", via: "calliope", content: "Recovered Calliope reply." });
  });
});

import { describe, expect, it, vi } from "vitest";
import { books, jarvisDelegations, storyBibleChatMessages } from "@paperclipai/db";
import { reconcileBookChatTurns } from "../services/book-chat-recovery.js";

function recoveryDb(rows: any[], delegation: any, companyId = "company-1") {
  const calls: unknown[] = [];
  const inserts: unknown[] = [];
  const query = (table: unknown) => {
    const get = () => table === books ? [{ id: "book-1" }] : table === jarvisDelegations ? (delegation ? [delegation] : []) : rows;
    const thenable: any = {
      where: () => thenable,
      limit: async (limit: number) => get().slice(0, limit),
      then: (resolve: any, reject: any) => Promise.resolve(get()).then(resolve, reject),
    };
    return thenable;
  };
  const db: any = {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn(() => ({ from: (table: unknown) => query(table) })),
    update: vi.fn(() => ({
      set: (changes: any) => ({
        where: () => ({
          returning: async () => {
            calls.push(changes);
            return [{ id: "u-1" }];
          },
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: async (values: any) => { inserts.push(values); return [{ id: "a-1" }]; },
    })),
    transaction: async (fn: any) => fn(db),
  };
  return { db, calls, inserts, companyId };
}

describe("Book Studio process-loss reconciliation", () => {
  it("fails a terminal peer turn under the book lock and makes only failed/abandoned retryable", async () => {
    const row = { id: "u-1", bookId: "book-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db, calls } = recoveryDb([row], { id: "d-1", status: "failed", createdAt: new Date(0), completedAt: new Date(0) });
    await expect(reconcileBookChatTurns(db, { companyId: "company-1", bookId: "book-1", now: new Date(10 * 60_000) })).resolves.toEqual({ reconciled: 1 });
    expect(db.execute).toHaveBeenCalledWith(expect.anything());
    expect(calls[0]).toMatchObject({ status: "failed", retryable: true });
  });

  it("does not mutate an active-session row when company/book scope is absent", async () => {
    const row = { id: "u-1", bookId: "book-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db } = recoveryDb([row], { id: "d-1", status: "failed", createdAt: new Date(0), completedAt: new Date(0) });
    db.select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    await expect(reconcileBookChatTurns(db, { companyId: "other-company", bookId: "book-1" })).resolves.toEqual({ reconciled: 0 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("leaves a completed delegation pending during grace so the owning POST can persist it", async () => {
    const row = { id: "u-1", bookId: "book-1", turnId: "turn-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db, calls, inserts } = recoveryDb([row], { id: "d-1", status: "completed", result: "Calliope's answer", createdAt: new Date(20_000), completedAt: new Date(20_000) });
    await expect(reconcileBookChatTurns(db, { companyId: "company-1", bookId: "book-1", now: new Date(60_000) })).resolves.toEqual({ reconciled: 0 });
    expect(calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("keeps ownership with the POST when a long-running delegation only just completed", async () => {
    const row = { id: "u-1", bookId: "book-1", turnId: "turn-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db, calls, inserts } = recoveryDb([row], {
      id: "d-1", status: "completed", result: "Calliope's answer",
      createdAt: new Date(0), completedAt: new Date(5 * 60_000 + 5_000),
    });
    await expect(reconcileBookChatTurns(db, { companyId: "company-1", bookId: "book-1", now: new Date(5 * 60_000 + 10_000) })).resolves.toEqual({ reconciled: 0 });
    expect(calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("restores a completed reply after grace without replaying an authorized mutation", async () => {
    const authorization = { operation: "overview.set", destination: "overview", content: "New overview" };
    const row = { id: "u-1", bookId: "book-1", turnId: "turn-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", conversationId: "book-studio:company-1:book-1", authorization, createdAt: new Date(0) };
    const { db, calls, inserts } = recoveryDb([row], { id: "d-1", companyId: "company-1", status: "completed", result: "Calliope's recovered answer", createdAt: new Date(0), completedAt: new Date(20_000) });
    await expect(reconcileBookChatTurns(db, { companyId: "company-1", bookId: "book-1", now: new Date(10 * 60_000) })).resolves.toEqual({ reconciled: 1 });
    expect(calls[0]).toMatchObject({ status: "completed", via: "calliope", retryable: false, actionResult: { status: "failed", destination: "overview" } });
    expect(inserts[0]).toMatchObject({ role: "assistant", status: "completed", via: "calliope", content: expect.stringContaining("Calliope's recovered answer"), actionResult: { status: "failed" } });
    expect((inserts[0] as { content: string }).content).toContain("no book content was changed automatically");
  });
});

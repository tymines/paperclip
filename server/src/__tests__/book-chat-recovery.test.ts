import { describe, expect, it, vi } from "vitest";
import { books, jarvisDelegations, storyBibleChatMessages } from "@paperclipai/db";
import { reconcileBookChatTurns } from "../services/book-chat-recovery.js";

function recoveryDb(rows: any[], delegation: any, companyId = "company-1") {
  const calls: unknown[] = [];
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
    transaction: async (fn: any) => fn(db),
  };
  return { db, calls, companyId };
}

describe("Book Studio process-loss reconciliation", () => {
  it("fails a terminal peer turn under the book lock and makes only failed/abandoned retryable", async () => {
    const row = { id: "u-1", bookId: "book-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db, calls } = recoveryDb([row], { id: "d-1", status: "failed" });
    await expect(reconcileBookChatTurns(db, { companyId: "company-1", bookId: "book-1", now: new Date(10 * 60_000) })).resolves.toEqual({ reconciled: 1 });
    expect(db.execute).toHaveBeenCalledWith(expect.anything());
    expect(calls[0]).toMatchObject({ status: "failed", retryable: true });
  });

  it("does not mutate an active-session row when company/book scope is absent", async () => {
    const row = { id: "u-1", bookId: "book-1", role: "user", status: "pending", archivedAt: null, delegationId: "d-1", createdAt: new Date(0) };
    const { db } = recoveryDb([row], { id: "d-1", status: "failed" });
    db.select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    await expect(reconcileBookChatTurns(db, { companyId: "other-company", bookId: "book-1" })).resolves.toEqual({ reconciled: 0 });
    expect(db.update).not.toHaveBeenCalled();
  });
});

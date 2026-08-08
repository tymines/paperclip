import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { books, jarvisDelegations, storyBibleChatMessages } from "@paperclipai/db";

const RECOVERY_GRACE_MS = 5 * 60_000;

/** Reconcile interrupted Book Studio turns without launching another peer job. */
export async function reconcileBookChatTurns(db: Db, args: { companyId: string; bookId: string; now?: Date }) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`book-chat:${args.bookId}`}))`);
    // Chat rows carry only book_id; establish the company/book boundary in the
    // same transaction before reading or changing any active session rows.
    const [book] = await tx.select({ id: books.id }).from(books).where(and(
      eq(books.id, args.bookId), eq(books.companyId, args.companyId),
    )).limit(1);
    if (!book) return { reconciled: 0 };
    const pending = await tx.select().from(storyBibleChatMessages).where(and(
      eq(storyBibleChatMessages.bookId, args.bookId), isNull(storyBibleChatMessages.archivedAt),
      eq(storyBibleChatMessages.role, "user"), eq(storyBibleChatMessages.status, "pending"),
    ));
    let reconciled = 0;
    for (const turn of pending) {
      const turnOverdue = now.getTime() - turn.createdAt.getTime() >= RECOVERY_GRACE_MS;
      let error: string | null = null;
      let retryable = false;
      if (!turn.delegationId) {
        if (!turnOverdue) continue;
        error = "Dispatch identity was not recorded before the prior process stopped; outcome is indeterminate and cannot be retried automatically.";
      } else {
        const [delegation] = await tx.select().from(jarvisDelegations).where(and(
          eq(jarvisDelegations.id, turn.delegationId), eq(jarvisDelegations.companyId, args.companyId),
        )).limit(1);
        if (!delegation) {
          if (!turnOverdue) continue;
          error = "Reserved delegation was not found after recovery grace; outcome is indeterminate and cannot be retried automatically.";
        } else if (delegation.status === "completed" || delegation.status === "failed" || delegation.status === "abandoned") {
          // The normal POST remains the owner for a full grace window after
          // the peer job becomes terminal. That job can finish long after the
          // user row was created, so turn age alone cannot safely distinguish
          // a live owner from a stopped process.
          const terminalAt = delegation.completedAt ?? delegation.createdAt;
          const terminalOverdue = now.getTime() - terminalAt.getTime() >= RECOVERY_GRACE_MS;
          if (!terminalOverdue) continue;
          if (delegation.status === "failed" || delegation.status === "abandoned") {
            error = `Calliope delegation ${delegation.status}; retry is safe.`;
            retryable = true;
          } else {
            const result = (delegation.result ?? "").trim();
            if (!result) {
              error = "Calliope completed without a usable reply after recovery grace; no response or book change was stored.";
            } else {
              const authorization = turn.authorization;
              const recoveryNotice = "Recovered after a server interruption. Calliope's reply was restored, but no book content was changed automatically. Send a new explicit instruction if you still want that change.";
              const recoveredReply = authorization ? `${result}\n\n${recoveryNotice}` : result;
              const destination = typeof authorization?.destination === "string" ? authorization.destination : "book";
              const actionResult = authorization ? {
                operation: typeof authorization.operation === "string" ? authorization.operation : "recovered-not-applied",
                section: destination,
                destination,
                status: "failed",
                error: recoveryNotice,
              } : null;
              const completed = await tx.update(storyBibleChatMessages).set({
                status: "completed",
                via: "calliope",
                delegationId: delegation.id,
                error: null,
                retryable: false,
                actionResult,
              }).where(and(
                eq(storyBibleChatMessages.id, turn.id),
                eq(storyBibleChatMessages.bookId, args.bookId),
                eq(storyBibleChatMessages.role, "user"),
                eq(storyBibleChatMessages.status, "pending"),
                isNull(storyBibleChatMessages.archivedAt),
              )).returning({ id: storyBibleChatMessages.id });
              if (completed.length !== 1) continue;
              await tx.insert(storyBibleChatMessages).values({
                bookId: turn.bookId,
                turnId: turn.turnId,
                role: "assistant",
                content: recoveredReply,
                status: "completed",
                via: "calliope",
                delegationId: delegation.id,
                conversationId: turn.conversationId,
                actionResult,
              });
              reconciled += 1;
              continue;
            }
          }
        } else {
          if (!turnOverdue) continue;
          error = "Calliope delegation exceeded recovery grace; outcome is indeterminate and cannot be retried automatically.";
        }
      }
      const updated = await tx.update(storyBibleChatMessages).set({ status: "failed", via: "none", error, retryable })
        .where(and(eq(storyBibleChatMessages.id, turn.id), eq(storyBibleChatMessages.status, "pending"), isNull(storyBibleChatMessages.archivedAt)))
        .returning({ id: storyBibleChatMessages.id });
      reconciled += updated.length;
    }
    return { reconciled };
  });
}

import { describe, expect, it } from "vitest";
import {
  normalizeBrainstormTurns,
  type BrainstormChatRow,
} from "../services/brainstorm-chat.js";

const row = (overrides: Partial<BrainstormChatRow> & Pick<BrainstormChatRow, "id" | "role" | "content">): BrainstormChatRow => ({
  turnId: null,
  status: "completed",
  via: null,
  delegationId: null,
  error: null,
  createdAt: new Date("2026-08-03T12:00:00.000Z"),
  ...overrides,
});

describe("normalizeBrainstormTurns", () => {
  it("pairs persisted user and Calliope rows by turnId with provenance", () => {
    const turns = normalizeBrainstormTurns([
      row({ id: "u1", turnId: "turn-1", role: "user", content: "What if?" }),
      row({
        id: "a1",
        turnId: "turn-1",
        role: "assistant",
        content: "Try a false map.",
        via: "calliope",
        delegationId: "d1",
      }),
    ]);
    expect(turns).toEqual([expect.objectContaining({
      turnId: "turn-1",
      userMessage: "What if?",
      reply: "Try a false map.",
      userMessageId: "u1",
      messageId: "a1",
      status: "completed",
      via: "calliope",
      delegationId: "d1",
    })]);
  });

  it("pairs legacy rows sequentially with a stable legacy turn id", () => {
    const turns = normalizeBrainstormTurns([
      row({ id: "legacy-user", role: "user", content: "Old question" }),
      row({ id: "legacy-answer", role: "assistant", content: "Old answer" }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turnId: "legacy:legacy-user",
      userMessage: "Old question",
      reply: "Old answer",
    });
  });

  it("drops orphan assistant rows rather than inventing a user turn", () => {
    expect(normalizeBrainstormTurns([
      row({ id: "orphan", role: "assistant", content: "No matching user" }),
    ])).toEqual([]);
  });

  it("retains a failed user-only turn and its error", () => {
    const turns = normalizeBrainstormTurns([
      row({
        id: "failed-user",
        turnId: "turn-failed",
        role: "user",
        content: "Please answer",
        status: "failed",
        error: "Calliope unavailable",
      }),
    ]);
    expect(turns[0]).toMatchObject({
      turnId: "turn-failed",
      status: "failed",
      reply: "",
      error: "Calliope unavailable",
    });
  });
});

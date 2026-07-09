import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCouncilSession,
  addParticipant,
  castVote,
  checkConsensus,
} from "./council.js";

// ── Mock DB builder ────────────────────────────────────────
type MockDb = Record<string, any>;

function mockChain<T = unknown>(results: T) {
  const thenable = Promise.resolve(results);
  return Object.assign(thenable, {
    where: vi.fn(() => mockChain(results)),
    returning: vi.fn(() => Promise.resolve(results)),
    values: vi.fn(() => mockChain(results)),
    set: vi.fn(() => mockChain(results)),
    from: vi.fn(() => mockChain(results)),
    orderBy: vi.fn(() => mockChain(results)),
    limit: vi.fn(() => mockChain(results)),
  });
}

// ── Helpers ─────────────────────────────────────────────────
const ROOM_ID = randomUUID();
const SESSION_ID = randomUUID();
const AGENT_A = randomUUID();
const AGENT_B = randomUUID();

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    roomId: ROOM_ID,
    topic: "Should we deploy?",
    consensusProtocol: "majority",
    status: "deliberating",
    deadlineAt: null,
    resolvedAt: null,
    resolution: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    sessionId: SESSION_ID,
    agentId: AGENT_A,
    position: null,
    vote: null,
    submittedAt: null,
    ...overrides,
  };
}

describe("Council Rooms", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {};
  });

  // ── createCouncilSession ──────────────────────────────────
  describe("createCouncilSession", () => {
    it("inserts a new session and returns it", async () => {
      const session = makeSession();
      db.insert = vi.fn(() => mockChain([session]));

      const result = await createCouncilSession(db as any, ROOM_ID, "Should we deploy?");
      expect(result).toEqual(session);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  // ── addParticipant ────────────────────────────────────────
  describe("addParticipant", () => {
    it("adds a participant to a session", async () => {
      const participant = makeParticipant();
      db.insert = vi.fn(() => mockChain([participant]));

      const result = await addParticipant(db as any, SESSION_ID, AGENT_A);
      expect(result).toEqual(participant);
    });
  });

  // ── castVote ──────────────────────────────────────────────
  describe("castVote", () => {
    it("records a vote for a participant", async () => {
      const participant = makeParticipant({ vote: "approve", submittedAt: new Date() });
      db.update = vi.fn(() => mockChain([participant]));

      const result = await castVote(db as any, SESSION_ID, AGENT_A, "approve");
      expect(result).toEqual(participant);
    });
  });

  // ── council session lifecycle (integration test) ──────────
  describe("council session lifecycle", () => {
    it("resolves with approve when both vote approve (majority)", async () => {
      const session = makeSession();
      const pa = makeParticipant({ agentId: AGENT_A });
      const pb = makeParticipant({ agentId: AGENT_B });

      // 1. create session
      db.insert = vi.fn(() => mockChain([session]));
      await createCouncilSession(db as any, ROOM_ID, "Deploy?");

      // 2. add participants
      db.insert = vi.fn(() => mockChain([pa]));
      await addParticipant(db as any, SESSION_ID, AGENT_A);
      db.insert = vi.fn(() => mockChain([pb]));
      await addParticipant(db as any, SESSION_ID, AGENT_B);

      // 3. cast votes
      db.update = vi.fn(() => mockChain([pa]));
      await castVote(db as any, SESSION_ID, AGENT_A, "approve");
      db.update = vi.fn(() => mockChain([pb]));
      await castVote(db as any, SESSION_ID, AGENT_B, "approve");

      // 4. check consensus: session + participants with votes
      db.select = vi.fn()
        .mockReturnValueOnce(mockChain([session]))
        .mockReturnValueOnce(mockChain([
          { ...pa, vote: "approve" },
          { ...pb, vote: "approve" },
        ]));
      // update on resolve
      db.update = vi.fn(() => mockChain([session]));

      const result = await checkConsensus(db as any, SESSION_ID);
      expect(result.resolved).toBe(true);
      expect(result.resolution).toBe("approved");
    });

    it("returns resolved:false when not all votes are in", async () => {
      const session = makeSession();
      const pa = makeParticipant({ agentId: AGENT_A });
      const pb = makeParticipant({ agentId: AGENT_B });

      db.select = vi.fn()
        .mockReturnValueOnce(mockChain([session]))
        .mockReturnValueOnce(mockChain([
          { ...pa, vote: "approve" },
          pb, // no vote
        ]));

      const result = await checkConsensus(db as any, SESSION_ID);
      expect(result.resolved).toBe(false);
      expect(result.resolution).toBeNull();
    });
  });
});

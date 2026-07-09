import type { Db } from "@paperclipai/db";
import { councilSessions, councilParticipants } from "@paperclipai/db";
import { eq, and, count } from "drizzle-orm";

// All SHADOW — rooms_rail.enabled=false. Functions only, no routes.

export async function createCouncilSession(
  db: Db,
  roomId: string,
  topic: string,
  protocol: string = "majority",
) {
  const [session] = await db
    .insert(councilSessions)
    .values({ roomId, topic, consensusProtocol: protocol })
    .returning();
  return session;
}

export async function addParticipant(
  db: Db,
  sessionId: string,
  agentId: string,
) {
  const [participant] = await db
    .insert(councilParticipants)
    .values({ sessionId, agentId })
    .returning();
  return participant;
}

export async function castVote(
  db: Db,
  sessionId: string,
  agentId: string,
  vote: string,
) {
  const [participant] = await db
    .update(councilParticipants)
    .set({ vote, submittedAt: new Date() })
    .where(
      and(
        eq(councilParticipants.sessionId, sessionId),
        eq(councilParticipants.agentId, agentId),
      ),
    )
    .returning();
  return participant;
}

export async function checkConsensus(db: Db, sessionId: string) {
  const session = await db
    .select()
    .from(councilSessions)
    .where(eq(councilSessions.id, sessionId))
    .then((rows) => rows[0]);

  if (!session) return { resolved: false, resolution: null };

  const participants = await db
    .select()
    .from(councilParticipants)
    .where(eq(councilParticipants.sessionId, sessionId));

  const votes = participants.filter((p) => p.vote != null);
  // ponytail: only resolve when all participants have voted
  if (votes.length < participants.length) return { resolved: false, resolution: null };

  const approveCount = votes.filter((p) => p.vote === "approve").length;

  let resolved = false;
  let resolution: string | null = null;

  if (session.consensusProtocol === "unanimous") {
    if (approveCount === participants.length) {
      resolved = true;
      resolution = "approved";
    } else {
      resolved = true;
      resolution = "rejected";
    }
  } else {
    // majority
    if (approveCount > votes.length / 2) {
      resolved = true;
      resolution = "approved";
    } else {
      resolved = true;
      resolution = "rejected";
    }
  }

  if (resolved) {
    await db
      .update(councilSessions)
      .set({ status: "resolved", resolution, resolvedAt: new Date() })
      .where(eq(councilSessions.id, sessionId));
  }

  return { resolved, resolution };
}

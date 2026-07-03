import { and, asc, count, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, rooms, roomMembers, roomMessages } from "@paperclipai/db";

export function roomService(db: Db) {
  return {
    list: (companyId: string) =>
      db
        .select()
        .from(rooms)
        .where(eq(rooms.companyId, companyId))
        .orderBy(desc(rooms.updatedAt)),

    getById: (id: string) =>
      db
        .select()
        .from(rooms)
        .where(eq(rooms.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof rooms.$inferInsert, "companyId">) =>
      db
        .insert(rooms)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof rooms.$inferInsert>) =>
      db
        .update(rooms)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(rooms.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (id: string) =>
      db
        .delete(rooms)
        .where(eq(rooms.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    listMembers: (roomId: string) =>
      db
        .select()
        .from(roomMembers)
        .where(eq(roomMembers.roomId, roomId))
        .orderBy(asc(roomMembers.joinedAt)),

    addMember: (data: typeof roomMembers.$inferInsert) =>
      db
        .insert(roomMembers)
        .values(data)
        .returning()
        .then((rows) => rows[0]),

    removeMember: (memberId: string) =>
      db
        .delete(roomMembers)
        .where(eq(roomMembers.id, memberId))
        .returning()
        .then((rows) => rows[0] ?? null),

    getMember: (memberId: string) =>
      db
        .select()
        .from(roomMembers)
        .where(eq(roomMembers.id, memberId))
        .then((rows) => rows[0] ?? null),

    listMessages: (roomId: string, options?: { cursor?: string; limit?: number }) => {
      const limit = options?.limit ?? 50;
      const cursor = options?.cursor;

      const conditions = [eq(roomMessages.roomId, roomId)];
      if (cursor) {
        conditions.push(lt(roomMessages.createdAt, new Date(cursor)));
      }

      return db
        .select()
        .from(roomMessages)
        .where(and(...conditions))
        .orderBy(desc(roomMessages.createdAt))
        .limit(limit + 1)
        .then((rows) => {
          const hasMore = rows.length > limit;
          const messages = hasMore ? rows.slice(0, limit) : rows;
          const nextCursor = hasMore && messages.length > 0
            ? messages[messages.length - 1].createdAt.toISOString()
            : null;
          return { messages: messages.reverse(), hasMore, cursor: nextCursor };
        });
    },

    sendMessage: async (data: typeof roomMessages.$inferInsert) => {
      // Resolve sender name at write time for agent messages
      if (data.senderType === "agent" && data.senderId && !data.senderName) {
        const [agent] = await db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, data.senderId))
          .limit(1);
        if (agent) {
          data.senderName = agent.name;
        }
      }
      return db
        .insert(roomMessages)
        .values(data)
        .returning()
        .then((rows) => rows[0]);
    },

    countMessages: (roomId: string) =>
      db
        .select({ value: count() })
        .from(roomMessages)
        .where(eq(roomMessages.roomId, roomId))
        .then((rows) => rows[0]?.value ?? 0),
  };
}

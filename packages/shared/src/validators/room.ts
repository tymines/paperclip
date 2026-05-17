import { z } from "zod";
import { ROOM_STATUSES, ROOM_TYPES, ROOM_MEMBER_ROLES, ROOM_SENDER_TYPES, ROOM_MESSAGE_TYPES } from "../constants.js";

export const createRoomSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  type: z.enum(ROOM_TYPES).optional().default("collaboration"),
});

export type CreateRoom = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(ROOM_STATUSES).optional(),
  type: z.enum(ROOM_TYPES).optional(),
});

export type UpdateRoom = z.infer<typeof updateRoomSchema>;

export const addRoomMemberSchema = z.object({
  agentId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  role: z.enum(ROOM_MEMBER_ROLES).optional().default("member"),
}).refine(
  (data) => data.agentId || data.userId,
  { message: "Either agentId or userId must be provided" },
);

export type AddRoomMember = z.infer<typeof addRoomMemberSchema>;

export const sendRoomMessageSchema = z.object({
  content: z.string().min(1),
  senderType: z.enum(ROOM_SENDER_TYPES).optional().default("user"),
  messageType: z.enum(ROOM_MESSAGE_TYPES).optional().default("chat"),
  metadata: z.record(z.unknown()).optional().nullable(),
  parentMessageId: z.string().uuid().optional().nullable(),
});

export type SendRoomMessage = z.infer<typeof sendRoomMessageSchema>;

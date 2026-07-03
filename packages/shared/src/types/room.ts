import type { RoomStatus, RoomType, RoomMemberRole, RoomSenderType, RoomMessageType } from "../constants.js";

export interface Room {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: RoomStatus;
  type: RoomType;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomMember {
  id: string;
  roomId: string;
  agentId: string | null;
  userId: string | null;
  role: RoomMemberRole;
  joinedAt: Date;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderType: RoomSenderType;
  senderName: string | null;
  content: string;
  messageType: RoomMessageType;
  metadata: Record<string, unknown> | null;
  parentMessageId: string | null;
  createdAt: Date;
}

export interface RoomDetail extends Room {
  members: RoomMember[];
}

export interface RoomMessagePage {
  messages: RoomMessage[];
  hasMore: boolean;
  cursor: string | null;
}

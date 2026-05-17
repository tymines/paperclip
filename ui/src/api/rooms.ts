import type { Room, RoomDetail, RoomMember, RoomMessage, RoomMessagePage } from "@paperclipai/shared";
import { api } from "./client";

export const roomsApi = {
  list: (companyId: string) =>
    api.get<Room[]>(`/companies/${companyId}/rooms`),

  get: (companyId: string, roomId: string) =>
    api.get<RoomDetail>(`/companies/${companyId}/rooms/${roomId}`),

  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Room>(`/companies/${companyId}/rooms`, data),

  update: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.patch<Room>(`/companies/${companyId}/rooms/${roomId}`, data),

  remove: (companyId: string, roomId: string) =>
    api.delete<Room>(`/companies/${companyId}/rooms/${roomId}`),

  addMember: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<RoomMember>(`/companies/${companyId}/rooms/${roomId}/members`, data),

  removeMember: (companyId: string, roomId: string, memberId: string) =>
    api.delete<RoomMember>(`/companies/${companyId}/rooms/${roomId}/members/${memberId}`),

  listMessages: (companyId: string, roomId: string, cursor?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return api.get<RoomMessagePage>(
      `/companies/${companyId}/rooms/${roomId}/messages${qs ? `?${qs}` : ""}`,
    );
  },

  sendMessage: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<RoomMessage>(`/companies/${companyId}/rooms/${roomId}/messages`, data),
};

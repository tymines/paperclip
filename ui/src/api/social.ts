import type {
  SocialAccountPublic,
  SocialPostDetail,
  SocialPostListItem,
} from "@paperclipai/shared";
import { api } from "./client";

export const socialApi = {
  // ── Accounts ────────────────────────────────────────────────────────────
  listAccounts: (companyId: string) =>
    api.get<SocialAccountPublic[]>(`/companies/${companyId}/social/accounts`),

  getAccount: (companyId: string, accountId: string) =>
    api.get<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`),

  createAccount: (companyId: string, data: Record<string, unknown>) =>
    api.post<SocialAccountPublic>(`/companies/${companyId}/social/accounts`, data),

  updateAccount: (companyId: string, accountId: string, data: Record<string, unknown>) =>
    api.patch<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`, data),

  deleteAccount: (companyId: string, accountId: string) =>
    api.delete<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`),

  // ── Posts ────────────────────────────────────────────────────────────────
  listPosts: (companyId: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get<SocialPostListItem[]>(`/companies/${companyId}/social/posts${qs}`);
  },

  getPost: (companyId: string, postId: string) =>
    api.get<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`),

  createPost: (companyId: string, data: Record<string, unknown>) =>
    api.post<SocialPostDetail>(`/companies/${companyId}/social/posts`, data),

  updatePost: (companyId: string, postId: string, data: Record<string, unknown>) =>
    api.patch<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`, data),

  deletePost: (companyId: string, postId: string) =>
    api.delete<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`),
};

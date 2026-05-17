import { z } from "zod";
import { SOCIAL_PLATFORMS, SOCIAL_ACCOUNT_STATUSES, SOCIAL_POST_STATUSES, SOCIAL_POST_TYPES } from "../constants.js";

// ── Social Accounts ──────────────────────────────────────────────────────────
export const createSocialAccountSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  platformAccountId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(200),
  username: z.string().max(200).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  accessToken: z.string().optional().nullable(),
  refreshToken: z.string().optional().nullable(),
  tokenExpiresAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type CreateSocialAccount = z.infer<typeof createSocialAccountSchema>;

export const updateSocialAccountSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  username: z.string().max(200).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  accessToken: z.string().optional().nullable(),
  refreshToken: z.string().optional().nullable(),
  tokenExpiresAt: z.string().datetime().optional().nullable(),
  status: z.enum(SOCIAL_ACCOUNT_STATUSES).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type UpdateSocialAccount = z.infer<typeof updateSocialAccountSchema>;

// ── Social Posts ─────────────────────────────────────────────────────────────
export const createSocialPostSchema = z.object({
  title: z.string().max(500).optional().nullable(),
  content: z.string().min(1).max(10000),
  postType: z.enum(SOCIAL_POST_TYPES).optional().default("text"),
  scheduledAt: z.string().datetime().optional().nullable(),
  mediaUrls: z.array(z.string().url()).optional().default([]),
  tags: z.array(z.string().max(100)).optional().default([]),
  metadata: z.record(z.unknown()).optional().nullable(),
  /** Account IDs to publish to */
  accountIds: z.array(z.string().uuid()).min(1, "Select at least one account"),
});
export type CreateSocialPost = z.infer<typeof createSocialPostSchema>;

export const updateSocialPostSchema = z.object({
  title: z.string().max(500).optional().nullable(),
  content: z.string().min(1).max(10000).optional(),
  postType: z.enum(SOCIAL_POST_TYPES).optional(),
  status: z.enum(SOCIAL_POST_STATUSES).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  mediaUrls: z.array(z.string().url()).optional(),
  tags: z.array(z.string().max(100)).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type UpdateSocialPost = z.infer<typeof updateSocialPostSchema>;

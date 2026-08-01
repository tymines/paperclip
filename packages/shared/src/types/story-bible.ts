import type { LiveAgentProvenance } from "./delegation.js";

export interface StoryBibleCharacter {
  id: string;
  bookId: string;
  name: string;
  role: string;
  description: string;
  voiceCard: Record<string, unknown>;
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryBibleWorldLocation {
  id: string;
  bookId: string;
  name: string;
  description: string;
  rules: Record<string, unknown>;
  sensoryNotes: Record<string, unknown>;
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryBibleStyle {
  id: string;
  bookId: string;
  pov: string;
  tense: string;
  comps: string;
  sampleParagraph: string;
  bannedCliches: string[];
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryBibleOutline {
  id: string;
  bookId: string;
  chapterNumber: number;
  title: string;
  beats: Record<string, unknown>[];
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryBibleCharacterCreateInput {
  name: string;
  role?: string;
  description?: string;
  voiceCard?: Record<string, unknown>;
  source?: string;
}

export interface StoryBibleCharacterUpdateInput {
  name?: string;
  role?: string;
  description?: string;
  voiceCard?: Record<string, unknown>;
  locked?: boolean;
  source?: string;
}

export interface StoryBibleWorldLocationCreateInput {
  name: string;
  description?: string;
  rules?: Record<string, unknown>;
  sensoryNotes?: Record<string, unknown>;
  source?: string;
}

export interface StoryBibleWorldLocationUpdateInput {
  name?: string;
  description?: string;
  rules?: Record<string, unknown>;
  sensoryNotes?: Record<string, unknown>;
  locked?: boolean;
  source?: string;
}

export interface StoryBibleStyleCreateInput {
  pov?: string;
  tense?: string;
  comps?: string;
  sampleParagraph?: string;
  bannedCliches?: string[];
  source?: string;
}

export interface StoryBibleStyleUpdateInput {
  pov?: string;
  tense?: string;
  comps?: string;
  sampleParagraph?: string;
  bannedCliches?: string[];
  locked?: boolean;
  source?: string;
}

export interface StoryBibleOutlineCreateInput {
  chapterNumber?: number;
  title?: string;
  beats?: Record<string, unknown>[];
  source?: string;
}

export interface StoryBibleOutlineUpdateInput {
  chapterNumber?: number;
  title?: string;
  beats?: Record<string, unknown>[];
  locked?: boolean;
  source?: string;
}

// ── Chat Message ────────────────────────────────────────────────────────────

export interface StoryBibleChatMessage {
  id: string;
  bookId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SendChatMessageRequest {
  message: string;
}

export interface ChatMessageResponse {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * POST …/book-studio/books/:bookId/chat wire response (PR #30) — the live
 * Calliope lane's reply plus its provenance. This is the single source of
 * truth for the route body and the UI consumer (ChatDrawer).
 */
export interface SendChatMessageResponse {
  reply: string;
  messageId: string;
  userMessageId: string;
  delegationId?: string;
  provenance: LiveAgentProvenance;
}

/**
 * POST …/chat error body (HTTP 502) when the live Calliope lane degrades —
 * a visible failure with degraded provenance, never a raw-model substitute.
 */
export interface SendChatMessageDegradedResponse {
  error: string;
  messageId: string;
  provenance: LiveAgentProvenance;
}

export type DraftEntityType = "character" | "world-location" | "style" | "outline";

export interface ToDraftQuery {
  target: DraftEntityType;
}

export interface ToDraftResponse {
  entityType: DraftEntityType;
  draft: Record<string, unknown>;
}

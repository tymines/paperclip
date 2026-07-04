import { z } from "zod";

// ── Character ──────────────────────────────────────────────────────────────

export const createStoryBibleCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().default(""),
  description: z.string().optional().default(""),
  voiceCard: z.record(z.unknown()).optional().default({}),
  source: z.enum(["authored", "co_created", "imported"]).optional().default("authored"),
});

export const updateStoryBibleCharacterSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  description: z.string().optional(),
  voiceCard: z.record(z.unknown()).optional(),
  locked: z.boolean().optional(),
  source: z.enum(["authored", "co_created", "imported"]).optional(),
});

export type CreateStoryBibleCharacter = z.infer<typeof createStoryBibleCharacterSchema>;
export type UpdateStoryBibleCharacter = z.infer<typeof updateStoryBibleCharacterSchema>;

// ── World Location ──────────────────────────────────────────────────────────

export const createStoryBibleWorldLocationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  rules: z.record(z.unknown()).optional().default({}),
  sensoryNotes: z.record(z.unknown()).optional().default({}),
  source: z.enum(["authored", "co_created", "imported"]).optional().default("authored"),
});

export const updateStoryBibleWorldLocationSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: z.record(z.unknown()).optional(),
  sensoryNotes: z.record(z.unknown()).optional(),
  locked: z.boolean().optional(),
  source: z.enum(["authored", "co_created", "imported"]).optional(),
});

export type CreateStoryBibleWorldLocation = z.infer<typeof createStoryBibleWorldLocationSchema>;
export type UpdateStoryBibleWorldLocation = z.infer<typeof updateStoryBibleWorldLocationSchema>;

// ── Style ───────────────────────────────────────────────────────────────────

export const createStoryBibleStyleSchema = z.object({
  pov: z.string().optional().default(""),
  tense: z.string().optional().default(""),
  comps: z.string().optional().default(""),
  sampleParagraph: z.string().optional().default(""),
  bannedCliches: z.array(z.string()).optional().default([]),
  source: z.enum(["authored", "co_created", "imported"]).optional().default("authored"),
});

export const updateStoryBibleStyleSchema = z.object({
  pov: z.string().optional(),
  tense: z.string().optional(),
  comps: z.string().optional(),
  sampleParagraph: z.string().optional(),
  bannedCliches: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  source: z.enum(["authored", "co_created", "imported"]).optional(),
});

export type CreateStoryBibleStyle = z.infer<typeof createStoryBibleStyleSchema>;
export type UpdateStoryBibleStyle = z.infer<typeof updateStoryBibleStyleSchema>;

// ── Outline ─────────────────────────────────────────────────────────────────

export const createStoryBibleOutlineSchema = z.object({
  chapterNumber: z.number().int().nonnegative().optional().default(1),
  title: z.string().optional().default(""),
  beats: z.array(z.record(z.unknown())).optional().default([]),
  source: z.enum(["authored", "co_created", "imported"]).optional().default("authored"),
});

export const updateStoryBibleOutlineSchema = z.object({
  chapterNumber: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  beats: z.array(z.record(z.unknown())).optional(),
  locked: z.boolean().optional(),
  source: z.enum(["authored", "co_created", "imported"]).optional(),
});

export type CreateStoryBibleOutline = z.infer<typeof createStoryBibleOutlineSchema>;
export type UpdateStoryBibleOutline = z.infer<typeof updateStoryBibleOutlineSchema>;

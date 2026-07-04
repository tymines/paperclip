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

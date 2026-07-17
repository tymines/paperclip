export interface Book {
  id: string;
  companyId: string;
  slug: string;
  title: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Writing autonomy dial (persisted in books.metadata.autonomyMode) ────────
// manual   — nothing auto-generates.
// assisted — when a chapter is marked done, the NEXT chapter gets a draft
//            generated and parked for review; never auto-advances further.
// autopilot— chapter drafts chain automatically while each generation
//            succeeds; stops on error or book completion; pausable.
export type BookAutonomyMode = "manual" | "assisted" | "autopilot";

// ── Span-anchored annotations (book_annotations — migration 0151, GATED) ────

export type BookAnnotationKind = "note" | "review" | "suggestion";

export type BookReviewLens = "canon" | "voice" | "continuity" | "structure" | "prose";

export interface BookAnnotationDto {
  id: string;
  bookId: string;
  chapterId: string;
  chapterNumber: number;
  reviewRunId: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  contentHash: string;
  kind: BookAnnotationKind | string;
  body: string;
  author: string;
  resolved: boolean;
  /** Computed server-side: contentHash no longer matches the chapter content. */
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookReviewRunDto {
  id: string;
  bookId: string;
  lens: BookReviewLens | string;
  reviewer: string;
  model: string;
  scope: string;
  summary: string;
  createdAt: string;
}

/**
 * Envelope for annotation endpoints. `available: false` means migration 0151
 * has not been applied yet — the server fell back to books.metadata review
 * notes and the UI must say so instead of pretending annotations exist.
 */
export interface BookAnnotationsResponse {
  available: boolean;
  pendingMigration?: "0151";
  reason?: string;
  annotations: BookAnnotationDto[];
  reviewRuns: BookReviewRunDto[];
}

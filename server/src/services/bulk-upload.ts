/**
 * Bulk-upload service — CRUD for bulk_upload_drafts + bulk_uploads.
 *
 * Tyler's "drop a bunch of content and let the scheduler figure it out"
 * surface lives on this service. The route layer handles multipart parsing
 * + storage; this layer is just data access.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bulkUploadDrafts, bulkUploads } from "@paperclipai/db";

export type BulkUploadDraftRow = typeof bulkUploadDrafts.$inferSelect;
export type BulkUploadRow = typeof bulkUploads.$inferSelect;

export interface CreateDraftInput {
  companyId: string;
  name?: string | null;
  createdBy?: string | null;
}

export interface CreateBulkUploadInput {
  companyId: string;
  draftId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  detectedType: "image" | "video";
  thumbnailKey?: string | null;
  createdBy?: string | null;
}

export interface UpdateBulkUploadInput {
  caption?: string | null;
  hashtags?: string[];
  platforms?: string[];
  aiSuggestedCaption?: string | null;
  scheduledPostId?: string | null;
  orderIndex?: number;
}

export function bulkUploadService(db: Db) {
  return {
    listDrafts: (companyId: string) =>
      db
        .select()
        .from(bulkUploadDrafts)
        .where(eq(bulkUploadDrafts.companyId, companyId))
        .orderBy(desc(bulkUploadDrafts.updatedAt)),

    getDraft: (id: string) =>
      db
        .select()
        .from(bulkUploadDrafts)
        .where(eq(bulkUploadDrafts.id, id))
        .then((rows) => rows[0] ?? null),

    createDraft: (input: CreateDraftInput) =>
      db
        .insert(bulkUploadDrafts)
        .values({
          companyId: input.companyId,
          name: input.name ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning()
        .then((rows) => rows[0]),

    updateDraft: (
      id: string,
      patch: Partial<typeof bulkUploadDrafts.$inferInsert>,
    ) =>
      db
        .update(bulkUploadDrafts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(bulkUploadDrafts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    markDraftCommitted: (id: string) =>
      db
        .update(bulkUploadDrafts)
        .set({ status: "committed", committedAt: new Date(), updatedAt: new Date() })
        .where(eq(bulkUploadDrafts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    deleteDraft: (id: string) =>
      db
        .delete(bulkUploadDrafts)
        .where(eq(bulkUploadDrafts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    listUploads: (draftId: string) =>
      db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.draftId, draftId))
        .orderBy(asc(bulkUploads.orderIndex)),

    listUploadsForCompany: (companyId: string) =>
      db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.companyId, companyId)),

    getUpload: (id: string) =>
      db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.id, id))
        .then((rows) => rows[0] ?? null),

    createUpload: async (input: CreateBulkUploadInput) => {
      const existing = await db
        .select({ orderIndex: bulkUploads.orderIndex })
        .from(bulkUploads)
        .where(eq(bulkUploads.draftId, input.draftId))
        .orderBy(desc(bulkUploads.orderIndex))
        .limit(1);
      const nextIndex = existing[0] ? existing[0].orderIndex + 1 : 0;

      const [row] = await db
        .insert(bulkUploads)
        .values({
          companyId: input.companyId,
          draftId: input.draftId,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey,
          thumbnailKey: input.thumbnailKey ?? null,
          detectedType: input.detectedType,
          orderIndex: nextIndex,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return row;
    },

    updateUpload: (id: string, patch: UpdateBulkUploadInput) =>
      db
        .update(bulkUploads)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(bulkUploads.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    deleteUploads: (ids: string[]) =>
      db
        .delete(bulkUploads)
        .where(inArray(bulkUploads.id, ids))
        .returning(),

    reorderUploads: async (draftId: string, orderedIds: string[]) => {
      // Apply new ordering in a single transaction. Each id maps to its
      // position in the array.
      await db.transaction(async (tx) => {
        for (let i = 0; i < orderedIds.length; i += 1) {
          await tx
            .update(bulkUploads)
            .set({ orderIndex: i, updatedAt: new Date() })
            .where(
              and(
                eq(bulkUploads.id, orderedIds[i]),
                eq(bulkUploads.draftId, draftId),
              ),
            );
        }
      });
      return db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.draftId, draftId))
        .orderBy(asc(bulkUploads.orderIndex));
    },
  };
}

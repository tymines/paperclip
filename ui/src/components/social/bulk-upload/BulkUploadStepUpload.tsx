/**
 * Step 1 — Upload. Drag-and-drop multi-file (images / videos), file-list
 * panel with thumbnails, bulk select/delete, drag-to-reorder for image-only
 * sets.
 *
 * ZIP archive extraction is a follow-up — the iOS file picker hands you
 * the photos directly, so the v0 experience is fine without it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckSquare,
  FileImage,
  FileVideo,
  GripVertical,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { cn } from "../../../lib/utils";
import { bulkUploadApi, type BulkUploadRow } from "../../../api/bulkUpload";
import {
  useBulkUploadState,
  type BulkUploadFile,
} from "./state";
import { BulkUploadGenerateWithDesign } from "./BulkUploadGenerateWithDesign";

interface Props {
  onNext?: () => void;
}

const ACCEPTED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".mp4", ".mov"];
const ACCEPT_ATTR = ACCEPTED_EXT.join(",") + ",image/*,video/*";

function toBulkUploadFile(row: BulkUploadRow): BulkUploadFile {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    thumbnailKey: row.thumbnailKey,
    detectedType: row.detectedType,
    orderIndex: row.orderIndex,
    caption: row.caption,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    platforms: Array.isArray(row.platforms)
      ? (row.platforms as BulkUploadFile["platforms"])
      : [],
    aiSuggestedCaption: row.aiSuggestedCaption,
    selected: false,
    uploadProgress: null,
    uploadError: null,
  };
}

export function BulkUploadStepUpload({ onNext }: Props) {
  const { companyId, draftId, uploads, selectedIds, imageOnly, dispatch } =
    useBulkUploadState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  // Map of bulk_uploads.id → local object URL (instant thumbnail, no server
  // round-trip). Falls back to the /content endpoint if missing.
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      // Revoke any object URLs we created so they don't leak.
      for (const url of objectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current.clear();
    };
  }, []);

  const ensureDraftId = useCallback(async () => {
    if (draftId) return draftId;
    const created = await bulkUploadApi.createDraft(companyId);
    dispatch({ type: "set-draft-id", draftId: created.id });
    return created.id;
  }, [companyId, draftId, dispatch]);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 0) return { uploads: [], errors: [] };
      const did = await ensureDraftId();
      const result = await bulkUploadApi.uploadFiles(companyId, did, files);
      // Tie each created upload row to its local object URL so we get a
      // free, instant thumbnail without bouncing through the server.
      result.uploads.forEach((row, idx) => {
        const localFile = files[idx];
        if (localFile) {
          const url = URL.createObjectURL(localFile);
          objectUrlsRef.current.set(row.id, url);
        }
      });
      return result;
    },
    onSuccess: (result) => {
      const next = result.uploads.map(toBulkUploadFile);
      dispatch({ type: "add-uploads", uploads: next });
      if (result.errors.length > 0) {
        setBatchError(
          `Skipped ${result.errors.length} file(s): ${result.errors
            .map((e) => `${e.filename} (${e.reason})`)
            .slice(0, 3)
            .join(", ")}${result.errors.length > 3 ? "…" : ""}`,
        );
      } else {
        setBatchError(null);
      }
    },
    onError: (err: Error) => {
      setBatchError(err.message || "Upload failed");
    },
  });

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < fileList.length; i += 1) {
        const f = fileList.item(i);
        if (f) files.push(f);
      }
      uploadMutation.mutate(files);
    },
    [uploadMutation],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!draftId || ids.length === 0) return;
      await bulkUploadApi.deleteUploads(companyId, draftId, ids);
    },
    onSuccess: (_data, ids) => {
      // Free any local object URLs for the rows we just removed.
      for (const id of ids) {
        const url = objectUrlsRef.current.get(id);
        if (url) URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(id);
      }
      dispatch({ type: "remove-uploads", ids });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!draftId) return;
      await bulkUploadApi.reorderUploads(companyId, draftId, orderedIds);
    },
  });

  const handleReorder = useCallback(
    (newOrder: string[]) => {
      dispatch({ type: "reorder-uploads", ids: newOrder });
      reorderMutation.mutate(newOrder);
    },
    [dispatch, reorderMutation],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = uploads.findIndex((u) => u.id === active.id);
    const newIndex = uploads.findIndex((u) => u.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(uploads, oldIndex, newIndex);
    handleReorder(next.map((u) => u.id));
  };

  const thumbUrl = useCallback(
    (row: BulkUploadFile) => {
      const local = objectUrlsRef.current.get(row.id);
      if (local) return local;
      // Server fallback for restored drafts. Image only — videos get an icon.
      if (row.detectedType === "image") {
        return `/api/companies/${companyId}/social/bulk-upload/uploads/${row.id}/content`;
      }
      return null;
    },
    [companyId],
  );

  const total = uploads.length;
  const allSelected = total > 0 && selectedIds.length === total;
  const someSelected = selectedIds.length > 0 && selectedIds.length < total;

  // Step-1 mode toggle: existing-upload (default) vs generate-with-design.
  // The toggle state is local — once the user generates an artifact, the
  // resulting design_run row is its own record; flipping back to upload
  // does not erase it.
  const [mode, setMode] = useState<"upload" | "design">("upload");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`flex-1 rounded px-2 py-1 ${mode === "upload" ? "bg-background font-medium" : "text-muted-foreground"}`}
        >
          Upload existing
        </button>
        <button
          type="button"
          onClick={() => setMode("design")}
          className={`flex-1 rounded px-2 py-1 ${mode === "design" ? "bg-background font-medium" : "text-muted-foreground"}`}
        >
          Generate with Design
        </button>
      </div>

      {mode === "design" ? <BulkUploadGenerateWithDesign /> : null}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed bg-card/60 p-8 text-center transition-colors",
          isDragging
            ? "border-foreground bg-accent/30"
            : "border-border hover:border-foreground/50 hover:bg-accent/20",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ""; // reset so re-selecting the same file re-fires onChange
          }}
        />
        <UploadCloud className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            <span className="sm:hidden">Tap to select photos &amp; videos</span>
            <span className="hidden sm:inline">
              Drop files here or click to browse
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Images (.jpg / .png / .webp / .heic) and videos (.mp4 / .mov). Up to 50 per batch.
          </p>
        </div>
        {uploadMutation.isPending ? (
          <p className="text-xs text-muted-foreground">Uploading…</p>
        ) : null}
      </div>

      {batchError ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {batchError}
        </div>
      ) : null}

      {total > 0 ? (
        <div className="flex flex-col gap-3">
          <FileListToolbar
            allSelected={allSelected}
            someSelected={someSelected}
            selectedCount={selectedIds.length}
            total={total}
            onToggleAll={(selected) => dispatch({ type: "select-all", selected })}
            onSelectByType={(t) => dispatch({ type: "select-by-type", detectedType: t })}
            onDeleteSelected={() => deleteMutation.mutate(selectedIds)}
            deleting={deleteMutation.isPending}
          />

          {imageOnly ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={uploads.map((u) => u.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card/40">
                  {uploads.map((row, idx) => (
                    <SortableUploadRow
                      key={row.id}
                      row={row}
                      index={idx}
                      thumbUrl={thumbUrl(row)}
                      onRemove={() => deleteMutation.mutate([row.id])}
                      onToggleSelected={(selected) =>
                        dispatch({ type: "toggle-selected", id: row.id, selected })
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card/40">
              {uploads.map((row, idx) => (
                <UploadRow
                  key={row.id}
                  row={row}
                  index={idx}
                  thumbUrl={thumbUrl(row)}
                  onRemove={() => deleteMutation.mutate([row.id])}
                  onToggleSelected={(selected) =>
                    dispatch({ type: "toggle-selected", id: row.id, selected })
                  }
                  reorderable={false}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? "Drop or pick files to begin."
            : `${total} file${total === 1 ? "" : "s"} ready`}
        </p>
        <Button type="button" onClick={onNext} disabled={!onNext}>
          Next: Review &amp; caption
        </Button>
      </div>
    </div>
  );
}

interface FileListToolbarProps {
  allSelected: boolean;
  someSelected: boolean;
  selectedCount: number;
  total: number;
  onToggleAll: (selected: boolean) => void;
  onSelectByType: (t: "image" | "video") => void;
  onDeleteSelected: () => void;
  deleting: boolean;
}

function FileListToolbar({
  allSelected,
  someSelected,
  selectedCount,
  total,
  onToggleAll,
  onSelectByType,
  onDeleteSelected,
  deleting,
}: FileListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => onToggleAll(!allSelected)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        aria-pressed={allSelected}
      >
        {allSelected ? (
          <CheckSquare className="h-3.5 w-3.5" />
        ) : someSelected ? (
          <Square className="h-3.5 w-3.5 fill-foreground/40" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
        {allSelected ? "Deselect all" : `Select all (${total})`}
      </button>
      <button
        type="button"
        onClick={() => onSelectByType("image")}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <FileImage className="h-3.5 w-3.5" />
        Select images
      </button>
      <button
        type="button"
        onClick={() => onSelectByType("video")}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <FileVideo className="h-3.5 w-3.5" />
        Select videos
      </button>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive hover:bg-destructive/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete selected ({selectedCount})
        </button>
      ) : null}
    </div>
  );
}

interface UploadRowProps {
  row: BulkUploadFile;
  index: number;
  thumbUrl: string | null;
  onRemove: () => void;
  onToggleSelected: (selected: boolean) => void;
  reorderable: boolean;
  dragHandle?: React.HTMLAttributes<HTMLButtonElement>;
}

function UploadRow({
  row,
  index,
  thumbUrl,
  onRemove,
  onToggleSelected,
  reorderable,
  dragHandle,
}: UploadRowProps) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={() => onToggleSelected(!row.selected)}
        className="text-muted-foreground hover:text-foreground"
        aria-pressed={row.selected}
        aria-label={row.selected ? "Deselect" : "Select"}
      >
        {row.selected ? (
          <CheckSquare className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      {reorderable ? (
        <button
          type="button"
          {...dragHandle}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-4 text-center text-[10px] text-muted-foreground">{index + 1}</span>
      )}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
        {row.detectedType === "image" && thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : row.detectedType === "video" ? (
          <FileVideo className="h-5 w-5 text-muted-foreground" />
        ) : (
          <FileImage className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.filename}</p>
        <p className="text-xs text-muted-foreground">
          {row.detectedType} · {formatBytes(row.sizeBytes)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Remove"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function SortableUploadRow(props: Omit<UploadRowProps, "reorderable" | "dragHandle">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.row.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <UploadRow
        {...props}
        reorderable
        dragHandle={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

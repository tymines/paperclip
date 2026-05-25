/**
 * Step 2 — Review. Per-file caption + hashtag + platform targets, with
 * bulk-apply ("apply this caption to all selected"), AI-suggest, and the
 * usual select-all / select-by-type controls.
 *
 * AI-suggest: this branch has no model-adapter endpoint, so we show the
 * spec's fallback copy ("AI suggestions need an active agent — set one
 * up in Fleet"). When that endpoint lands the button just needs to POST
 * to it and write the response onto the row.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckSquare,
  FileImage,
  FileVideo,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "../../../lib/utils";
import { bulkUploadApi } from "../../../api/bulkUpload";
import { PLATFORM_META } from "../platform-meta";
import {
  BULK_UPLOAD_PLATFORMS,
  useBulkUploadState,
  type BulkUploadFile,
  type BulkUploadPlatform,
} from "./state";

interface Props {
  onBack: () => void;
  onNext?: () => void;
}

export function BulkUploadStepReview({ onBack, onNext }: Props) {
  const {
    companyId,
    draftId,
    uploads,
    accounts,
    selectedIds,
    dispatch,
  } = useBulkUploadState();

  // Filter platform chips to those the company has actually connected.
  // (Auto-schedule needs platforms with a connected account to actually
  // publish — there's no point letting the user target a platform they
  // can't post to.)
  const availablePlatforms = useMemo<BulkUploadPlatform[]>(() => {
    const connected = new Set<string>(accounts.map((a) => a.platform));
    return BULK_UPLOAD_PLATFORMS.filter((p) => connected.has(p));
  }, [accounts]);

  const [bulkCaption, setBulkCaption] = useState("");
  const [bulkHashtags, setBulkHashtags] = useState("");
  const [bulkPlatforms, setBulkPlatforms] = useState<BulkUploadPlatform[]>([]);

  const patchMutation = useMutation({
    mutationFn: async (input: {
      fileId: string;
      patch: Parameters<typeof bulkUploadApi.updateUpload>[3];
    }) => {
      if (!draftId) return;
      await bulkUploadApi.updateUpload(companyId, draftId, input.fileId, input.patch);
    },
  });

  const writePatch = useCallback(
    (
      id: string,
      patch: Pick<Partial<BulkUploadFile>, "caption" | "hashtags" | "platforms">,
    ) => {
      dispatch({ type: "update-upload", id, patch });
      const serverPatch: Parameters<typeof bulkUploadApi.updateUpload>[3] = {};
      if (patch.caption !== undefined) serverPatch.caption = patch.caption;
      if (patch.hashtags !== undefined) serverPatch.hashtags = patch.hashtags;
      if (patch.platforms !== undefined) serverPatch.platforms = patch.platforms;
      patchMutation.mutate({ fileId: id, patch: serverPatch });
    },
    [dispatch, patchMutation],
  );

  const applyBulk = useCallback(
    (
      patch: Pick<Partial<BulkUploadFile>, "caption" | "hashtags" | "platforms">,
    ) => {
      if (selectedIds.length === 0) return;
      dispatch({ type: "bulk-apply", ids: selectedIds, patch });
      for (const id of selectedIds) {
        const serverPatch: Parameters<typeof bulkUploadApi.updateUpload>[3] = {};
        if (patch.caption !== undefined) serverPatch.caption = patch.caption;
        if (patch.hashtags !== undefined) serverPatch.hashtags = patch.hashtags;
        if (patch.platforms !== undefined) serverPatch.platforms = patch.platforms;
        patchMutation.mutate({ fileId: id, patch: serverPatch });
      }
    },
    [dispatch, patchMutation, selectedIds],
  );

  const total = uploads.length;
  const allSelected = total > 0 && selectedIds.length === total;
  const missingPlatform = uploads.filter((u) => u.platforms.length === 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk-apply panel */}
      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Bulk apply to {selectedIds.length} selected
          </p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => dispatch({ type: "select-all", selected: !allSelected })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allSelected ? "Deselect all" : `Select all (${total})`}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "select-by-type", detectedType: "image" })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <FileImage className="h-3.5 w-3.5" />
              Images
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "select-by-type", detectedType: "video" })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <FileVideo className="h-3.5 w-3.5" />
              Videos
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <textarea
              value={bulkCaption}
              onChange={(e) => setBulkCaption(e.target.value)}
              placeholder="Caption applied to all selected…"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedIds.length === 0 || bulkCaption.length === 0}
              onClick={() => {
                applyBulk({ caption: bulkCaption });
                setBulkCaption("");
              }}
            >
              Apply caption
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              type="text"
              value={bulkHashtags}
              onChange={(e) => setBulkHashtags(e.target.value)}
              placeholder="#hashtags space-separated"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedIds.length === 0 || bulkHashtags.trim().length === 0}
              onClick={() => {
                applyBulk({ hashtags: parseHashtags(bulkHashtags) });
                setBulkHashtags("");
              }}
            >
              Apply hashtags
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <PlatformChips
              available={availablePlatforms}
              selected={bulkPlatforms}
              onToggle={(p) => {
                setBulkPlatforms((prev) =>
                  prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
                );
              }}
              small
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedIds.length === 0 || bulkPlatforms.length === 0}
              onClick={() => {
                applyBulk({ platforms: bulkPlatforms });
                setBulkPlatforms([]);
              }}
            >
              Apply platforms
            </Button>
          </div>
        </div>
      </div>

      {/* Validation banner */}
      {missingPlatform.length > 0 ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {missingPlatform.length} file{missingPlatform.length === 1 ? "" : "s"} still need at least one platform target before you can schedule.
        </div>
      ) : null}

      {/* Per-file rows */}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card/40">
        {uploads.map((row) => (
          <ReviewRow
            key={row.id}
            row={row}
            availablePlatforms={availablePlatforms}
            companyId={companyId}
            onToggleSelected={(selected) =>
              dispatch({ type: "toggle-selected", id: row.id, selected })
            }
            onCommit={(patch) => writePatch(row.id, patch)}
          />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onNext} disabled={!onNext}>
          Next: Schedule
        </Button>
      </div>
    </div>
  );
}

interface ReviewRowProps {
  row: BulkUploadFile;
  availablePlatforms: BulkUploadPlatform[];
  companyId: string;
  onToggleSelected: (selected: boolean) => void;
  onCommit: (
    patch: Pick<Partial<BulkUploadFile>, "caption" | "hashtags" | "platforms">,
  ) => void;
}

function ReviewRow({
  row,
  availablePlatforms,
  companyId,
  onToggleSelected,
  onCommit,
}: ReviewRowProps) {
  const [caption, setCaption] = useState(row.caption ?? "");
  const [hashtags, setHashtags] = useState(row.hashtags.join(" "));
  const [showAiHint, setShowAiHint] = useState(false);

  // Keep local edit fields in sync if the row gets bulk-applied to.
  useEffect(() => {
    setCaption(row.caption ?? "");
  }, [row.caption]);
  useEffect(() => {
    setHashtags(row.hashtags.join(" "));
  }, [row.hashtags]);

  const thumb =
    row.detectedType === "image"
      ? `/api/companies/${companyId}/social/bulk-upload/uploads/${row.id}/content`
      : null;

  return (
    <li className="flex flex-col gap-3 p-3 md:flex-row md:items-start">
      <button
        type="button"
        onClick={() => onToggleSelected(!row.selected)}
        className="self-start text-muted-foreground hover:text-foreground md:pt-1"
        aria-pressed={row.selected}
        aria-label={row.selected ? "Deselect" : "Select"}
      >
        {row.selected ? (
          <CheckSquare className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
        {row.detectedType === "image" && thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : row.detectedType === "video" ? (
          <FileVideo className="h-6 w-6 text-muted-foreground" />
        ) : (
          <FileImage className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="truncate text-sm font-medium">{row.filename}</p>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if ((row.caption ?? "") !== caption) {
              onCommit({ caption: caption.length > 0 ? caption : null });
            }
          }}
          placeholder="Caption…"
          rows={2}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          onBlur={() => {
            const next = parseHashtags(hashtags);
            const prev = row.hashtags;
            if (
              next.length !== prev.length ||
              next.some((t, i) => t !== prev[i])
            ) {
              onCommit({ hashtags: next });
            }
          }}
          placeholder="#hashtags space-separated"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <PlatformChips
            available={availablePlatforms}
            selected={row.platforms}
            onToggle={(p) => {
              const next = row.platforms.includes(p)
                ? row.platforms.filter((x) => x !== p)
                : [...row.platforms, p];
              onCommit({ platforms: next });
            }}
          />
          <button
            type="button"
            onClick={() => setShowAiHint(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            <Wand2 className="h-3.5 w-3.5" />
            AI suggest
          </button>
        </div>
        {showAiHint ? (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              AI suggestions need an active agent — set one up in Fleet, then come back here.
            </span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface PlatformChipsProps {
  available: BulkUploadPlatform[];
  selected: BulkUploadPlatform[];
  onToggle: (p: BulkUploadPlatform) => void;
  small?: boolean;
}

function PlatformChips({ available, selected, onToggle, small }: PlatformChipsProps) {
  if (available.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Connect an account to enable platform targeting.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((p) => {
        const meta = PLATFORM_META[p];
        const Icon = meta.icon;
        const isOn = selected.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onToggle(p)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
              small ? "text-[10px]" : "text-xs",
              isOn
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
            aria-pressed={isOn}
          >
            <Icon className="h-3 w-3" />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function parseHashtags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter((t) => t.length > 0)
    .slice(0, 30);
}

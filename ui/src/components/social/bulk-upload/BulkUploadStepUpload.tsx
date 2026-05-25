/**
 * Step 1 — Upload. Drag-and-drop multi-file (images / videos / zip),
 * file-list panel with thumbnails, bulk select/delete, drag-to-reorder
 * for image-only sets.
 *
 * Scaffold for the foundation commit. Step 2 of the build wires the
 * actual upload route + zip extraction.
 */
import { UploadCloud } from "lucide-react";
import { useBulkUploadState } from "./state";
import { Button } from "@/components/ui/button";

interface Props {
  onNext?: () => void;
}

export function BulkUploadStepUpload({ onNext }: Props) {
  const { uploads } = useBulkUploadState();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-card/60 p-10 text-center">
        <UploadCloud className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Drop content here</p>
          <p className="text-xs text-muted-foreground">
            Images (.jpg / .png / .webp / .heic), videos (.mp4 / .mov), and .zip archives.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload UI wires up in the next commit.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <Button type="button" onClick={onNext} disabled={!onNext}>
          Next: Review &amp; caption ({uploads.length})
        </Button>
      </div>
    </div>
  );
}

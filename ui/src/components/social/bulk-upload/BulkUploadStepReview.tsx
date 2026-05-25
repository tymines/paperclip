/**
 * Step 2 — Review. Per-file caption + hashtag + platform targets.
 * Bulk apply, AI suggest. Scaffold for the foundation commit.
 */
import { useBulkUploadState } from "./state";
import { Button } from "@/components/ui/button";

interface Props {
  onBack: () => void;
  onNext?: () => void;
}

export function BulkUploadStepReview({ onBack, onNext }: Props) {
  const { uploads } = useBulkUploadState();
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Review &amp; caption editor renders here ({uploads.length} files).
      </div>
      <div className="flex items-center justify-between">
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

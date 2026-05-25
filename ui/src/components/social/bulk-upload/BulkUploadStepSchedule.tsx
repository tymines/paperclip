/**
 * Step 3 — Schedule strategy + auto-schedule preview + commit.
 * Scaffold for the foundation commit.
 */
import { useBulkUploadState } from "./state";
import { Button } from "@/components/ui/button";

interface Props {
  onBack: () => void;
}

export function BulkUploadStepSchedule({ onBack }: Props) {
  const { uploads } = useBulkUploadState();
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Schedule strategy picker + preview render here ({uploads.length} files).
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" disabled>
          Commit schedule
        </Button>
      </div>
    </div>
  );
}

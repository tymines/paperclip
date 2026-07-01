import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Loader2, AlertCircle } from "lucide-react";
import { type ReelStatus, REEL_STATUS_LABELS } from "@/api/reels";

export function ReelStatusBadge({ status }: { status: ReelStatus }) {
  if (status === "complete") {
    return (
      <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        {REEL_STATUS_LABELS[status]}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <AlertCircle className="mr-1 h-3 w-3" />
        {REEL_STATUS_LABELS[status]}
      </Badge>
    );
  }
  if (status === "queued") {
    return (
      <Badge variant="secondary">
        <Clock className="mr-1 h-3 w-3" />
        {REEL_STATUS_LABELS[status]}
      </Badge>
    );
  }
  // any in-flight state
  return (
    <Badge variant="default" className="bg-indigo-500 hover:bg-indigo-600">
      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      {REEL_STATUS_LABELS[status]}
    </Badge>
  );
}

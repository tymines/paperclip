import { ArrowLeft } from "lucide-react";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";

interface DetailBackButtonProps {
  /** Where to go if browser history is empty (Tyler-shared link scenario). */
  fallbackTo?: string;
  className?: string;
  /** Visible label shown alongside the arrow. Default is hidden (icon-only). */
  label?: string;
}

/**
 * Back chevron used on detail pages (issue / agent / project / room).
 * Prefers navigate(-1) when there's real SPA history; falls back to the
 * configured route if the user landed here from a direct share / refresh.
 *
 * Tyler hit the case where /TYL/issues → /TYL/issues/TYL-99 had no in-app
 * way back on mobile (browser back is unreliable inside SPAs on iOS
 * Safari). This component is the canonical pattern across every detail
 * view.
 */
export function DetailBackButton({ fallbackTo, className, label }: DetailBackButtonProps) {
  const navigate = useNavigate();
  const hasLabel = !!label;
  return (
    <Button
      variant="ghost"
      className={cn("shrink-0 gap-1.5", hasLabel ? "px-2" : "", className)}
      size={hasLabel ? "sm" : "icon-sm"}
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) navigate(-1);
        else navigate(fallbackTo ?? "/");
      }}
      aria-label={label ?? "Back"}
      title={label ?? "Back"}
    >
      <ArrowLeft className="h-4 w-4" />
      {hasLabel ? <span className="text-xs font-medium">{label}</span> : null}
    </Button>
  );
}

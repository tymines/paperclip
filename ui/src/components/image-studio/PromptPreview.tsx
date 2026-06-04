/**
 * PromptPreview — live monospace view of the compiled prompt (ZenCreator hides
 * this; we show it). Toggling "Edit" exposes the compiled prompt as an editable
 * textarea — the power-user escape hatch before firing.
 */
import { Pencil, RotateCcw, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export function PromptPreview({
  prompt,
  editable,
  editedValue,
  onEditToggle,
  onEditedChange,
}: {
  /** The assembled prompt (read-only view). */
  prompt: string;
  /** Whether the editor is currently active. */
  editable: boolean;
  /** Current edited text (only meaningful when editable). */
  editedValue: string;
  onEditToggle: (editing: boolean) => void;
  onEditedChange: (value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Eye className="h-3 w-3" />
          Final prompt {editable && <span className="text-indigo-500">· editing</span>}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={() => onEditToggle(false)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-testid="prompt-reset-edit"
          >
            <RotateCcw className="h-3 w-3" />
            Use structured
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onEditedChange(prompt);
              onEditToggle(true);
            }}
            className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700"
            data-testid="prompt-edit"
          >
            <Pencil className="h-3 w-3" />
            Edit prompt
          </button>
        )}
      </div>
      {editable ? (
        <Textarea
          value={editedValue}
          onChange={(e) => onEditedChange(e.target.value)}
          rows={6}
          className="rounded-none border-0 bg-transparent font-mono text-[11px] leading-relaxed focus-visible:ring-0"
          data-testid="prompt-editor"
        />
      ) : (
        <p
          className={cn(
            "max-h-40 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed",
            "text-foreground/90",
          )}
          data-testid="prompt-preview"
        >
          {prompt}
        </p>
      )}
    </div>
  );
}

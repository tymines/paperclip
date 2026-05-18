import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import { Bot, CircleDot, Hexagon, Repeat, Target } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { cn } from "../lib/utils";

interface CreateComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateOption {
  key: "issue" | "goal" | "project" | "agent" | "routine";
  label: string;
  hint: string;
  icon: typeof CircleDot;
  shortcut?: string;
}

const OPTIONS: CreateOption[] = [
  { key: "issue", label: "Issue", hint: "Track a unit of work for an agent or user.", icon: CircleDot, shortcut: "I" },
  { key: "goal", label: "Goal", hint: "Hierarchical company → team → agent goal.", icon: Target, shortcut: "G" },
  { key: "project", label: "Project", hint: "Group of issues with a shared workspace.", icon: Hexagon, shortcut: "P" },
  { key: "agent", label: "Agent", hint: "Hire a new agent for this company.", icon: Bot, shortcut: "A" },
  { key: "routine", label: "Routine", hint: "Recurring scheduled work.", icon: Repeat, shortcut: "R" },
];

/**
 * UI v1 Create composer (decision 7's "⌘K extended into the unified Create
 * surface" + the mockup's "+ Create" composer). Acts as a type picker that
 * dispatches to the existing per-type dialogs — keeps the v1 cut small while
 * giving users the single-entry-point promised in the redesign.
 */
export function CreateComposer({ open, onOpenChange }: CreateComposerProps) {
  const [selected, setSelected] = useState<CreateOption["key"]>("issue");
  const { openNewIssue, openNewGoal, openNewProject, openNewAgent } = useDialogActions();
  const { selectedCompany } = useCompany();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setSelected("issue");
  }, [open]);

  function dispatch(key: CreateOption["key"]) {
    onOpenChange(false);
    switch (key) {
      case "issue":
        openNewIssue();
        return;
      case "goal":
        openNewGoal();
        return;
      case "project":
        openNewProject();
        return;
      case "agent":
        openNewAgent();
        return;
      case "routine":
        if (selectedCompany?.issuePrefix) {
          navigate(`/${selectedCompany.issuePrefix}/routines`);
        } else {
          navigate("/routines");
        }
        return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Create</DialogTitle>
          <DialogDescription>
            Pick the thing you want to create. Press the shortcut letter to dispatch.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = selected === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelected(option.key)}
                onDoubleClick={() => dispatch(option.key)}
                className={cn(
                  "flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
          {(() => {
            const option = OPTIONS.find((o) => o.key === selected)!;
            const Icon = option.icon;
            return (
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">New {option.label.toLowerCase()}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.hint}</p>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="flex flex-col-reverse items-stretch gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">⌘↵</kbd>{" "}
            open form
          </span>
          <div className="flex items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px] flex-1 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground sm:min-h-0 sm:flex-initial sm:py-1.5 sm:text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => dispatch(selected)}
              className="min-h-[44px] flex-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-0 sm:flex-initial sm:py-1.5 sm:text-xs"
            >
              Continue
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

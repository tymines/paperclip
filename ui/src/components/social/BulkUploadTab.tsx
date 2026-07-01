/**
 * BulkUploadTab — drop a pile of content, get back a posting schedule.
 *
 * Three-step wizard:
 *   1. Upload    — drag-and-drop multi-file (images/videos/zip), reorder,
 *                  bulk-delete. Files persist to bulk_uploads via the
 *                  POST /companies/:id/social/bulk-uploads route.
 *   2. Review    — per-file caption + hashtags + platform targets, with
 *                  "Apply to all selected" bulk operations. AI suggest
 *                  hits the agent layer (falls back to manual entry).
 *   3. Schedule  — pick a strategy (even / best-times / custom queue), see
 *                  the auto-scheduled preview, drag-adjust, commit.
 *
 * Tyler's ask, verbatim: "Need a function where I can just upload a bunch
 * of content and you schedule it based off the best timing/data and
 * analytics."
 */
import { useState } from "react";
import { CheckCircle2, Image as ImageIcon, ListChecks, UploadCloud } from "lucide-react";
import type { SocialAccountPublic } from "@paperclipai/shared";
import { cn } from "../../lib/utils";
import { BulkUploadStepUpload } from "./bulk-upload/BulkUploadStepUpload";
import { BulkUploadStepReview } from "./bulk-upload/BulkUploadStepReview";
import { BulkUploadStepSchedule } from "./bulk-upload/BulkUploadStepSchedule";
import {
  BulkUploadProvider,
  useBulkUploadState,
} from "./bulk-upload/state";

interface BulkUploadTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

const STEPS = [
  { key: "upload", label: "Upload", icon: UploadCloud },
  { key: "review", label: "Review", icon: ListChecks },
  { key: "schedule", label: "Schedule", icon: CheckCircle2 },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function BulkUploadTab({ companyId, accounts }: BulkUploadTabProps) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/60 p-10 text-center">
        <ImageIcon className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Connect an account first</p>
          <p className="text-xs text-muted-foreground">
            Bulk upload needs at least one connected social account so it knows where to schedule the posts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BulkUploadProvider companyId={companyId} accounts={accounts}>
      <BulkUploadWizard />
    </BulkUploadProvider>
  );
}

function BulkUploadWizard() {
  const { uploads, step: storedStep } = useBulkUploadState();
  const [step, setStep] = useState<StepKey>(storedStep);

  const canAdvanceFromUpload = uploads.length > 0;
  const canAdvanceFromReview = uploads.every(
    (u) => (u.platforms ?? []).length > 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <Stepper
        step={step}
        onStep={setStep}
        canReachReview={canAdvanceFromUpload}
        canReachSchedule={canAdvanceFromUpload && canAdvanceFromReview}
      />
      {step === "upload" ? (
        <BulkUploadStepUpload
          onNext={canAdvanceFromUpload ? () => setStep("review") : undefined}
        />
      ) : null}
      {step === "review" ? (
        <BulkUploadStepReview
          onBack={() => setStep("upload")}
          onNext={canAdvanceFromReview ? () => setStep("schedule") : undefined}
        />
      ) : null}
      {step === "schedule" ? (
        <BulkUploadStepSchedule onBack={() => setStep("review")} />
      ) : null}
    </div>
  );
}

interface StepperProps {
  step: StepKey;
  onStep: (s: StepKey) => void;
  canReachReview: boolean;
  canReachSchedule: boolean;
}

function Stepper({ step, onStep, canReachReview, canReachSchedule }: StepperProps) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((s, idx) => {
        const Icon = s.icon;
        const reachable =
          s.key === "upload" ||
          (s.key === "review" && canReachReview) ||
          (s.key === "schedule" && canReachSchedule);
        const active = step === s.key;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onStep(s.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : reachable
                    ? "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                    : "text-muted-foreground/50 cursor-not-allowed",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground",
                )}
              >
                {idx + 1}
              </span>
              <Icon className="h-4 w-4" />
              <span className="font-medium">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 ? (
              <span className="text-muted-foreground/40">›</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

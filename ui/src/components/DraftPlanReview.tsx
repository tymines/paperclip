import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle, Loader2, FileText } from "lucide-react";
import { api } from "../api/client";

const DS = {
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  critical: "#FF5B5B",
} as const;

interface DraftPlanReviewProps {
  companyId: string;
  planTitle: string;
  planText: string;
  steps: { label: string; duration?: string }[];
  onPlanApproved: (projectizeResult: { goalId: string; projectId: string; issueIds: string[] }) => void;
  onPlanRejected: (note: string) => void;
  onCancel: () => void;
}

export function DraftPlanReview({
  companyId,
  planTitle,
  planText,
  steps,
  onPlanApproved,
  onPlanRejected,
  onCancel,
}: DraftPlanReviewProps) {
  const [changeNote, setChangeNote] = useState("");
  const [showChangeInput, setShowChangeInput] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: async () => {
      // Step 1: approve the plan via plan/approve (dispatches to Ares)
      const dispatch = await api.post<{ ok: boolean; delegationId: string; status: string }>(
        "/companies/" + companyId + "/jarvis/plan/approve",
        {
          title: planTitle || "Plan",
          steps: steps.map((s, i) => ({ n: i + 1, label: s.label, duration: s.duration })),
          planText: planText.slice(0, 20000),
          agentsInvolved: Math.min(steps.length, 5),
          estimatedCompletion: String(steps.length * 2) + "h",
        },
      );
      // Step 2: projectize (create Goal + Project + Issues)
      const projectized = await api.post<{ goalId: string; projectId: string; issueIds: string[] }>(
        "/companies/" + companyId + "/jarvis/projectize",
        {
          title: planTitle || "Plan",
          brief: planText.slice(0, 20000),
          steps: steps.map((s) => ({ label: s.label, duration: s.duration })),
        },
      );
      return { dispatch, projectized };
    },
    onSuccess: (data) => {
      setSuccessMsg("Plan dispatched and projectized!");
      onPlanApproved(data.projectized);
    },
    onError: (err: Error) => {
      setSuccessMsg("Error: " + err.message);
    },
  });

  return (
    <div
      className="rounded-[16px] p-5"
      style={{
        background: "linear-gradient(180deg, " + DS.surface2 + " 0%, " + DS.surface + " 100%)",
        border: "1px solid " + DS.border,
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: DS.primary }} />
        <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
          Draft Plan Review
        </span>
      </div>

      {/* Plan steps */}
      <div className="mb-4 space-y-2">
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[10px] px-4 py-2.5 text-[13px]"
            style={{ background: DS.surface3, border: "1px solid " + DS.border2 }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ background: DS.primary + "1F", color: DS.primary }}
            >
              {i + 1}
            </span>
            <span className="flex-1" style={{ color: DS.text }}>
              {step.label}
            </span>
            {step.duration && (
              <span className="text-[11px]" style={{ color: DS.textFaint }}>
                {step.duration}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          className="flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium transition-opacity disabled:opacity-40"
          style={{ background: DS.success, color: "#000000" }}
        >
          {approve.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          <span>Approve & Execute</span>
        </button>

        {!showChangeInput ? (
          <button
            onClick={() => setShowChangeInput(true)}
            className="flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium transition-opacity"
            style={{ background: DS.critical + "1F", color: DS.critical, border: "1px solid " + DS.critical + "3D" }}
          >
            <XCircle className="h-4 w-4" />
            <span>Request Changes</span>
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <input
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Describe what needs to change..."
              className="flex-1 rounded-[10px] px-3 py-2 text-[12px] outline-none"
              style={{ background: DS.surface3, border: "1px solid " + DS.border2, color: DS.text }}
            />
            <button
              onClick={() => { onPlanRejected(changeNote); setShowChangeInput(false); setChangeNote(""); }}
              disabled={!changeNote.trim()}
              className="rounded-[10px] px-3 py-2 text-[12px] font-medium"
              style={{ background: DS.critical, color: "#FFFFFF" }}
            >
              Send
            </button>
            <button
              onClick={() => setShowChangeInput(false)}
              className="text-[12px]"
              style={{ color: DS.textMuted }}
            >
              Cancel
            </button>
          </div>
        )}

        <button
          onClick={onCancel}
          className="text-[12px] font-medium"
          style={{ color: DS.textFaint }}
        >
          Discard
        </button>
      </div>

      {successMsg && (
        <div className="mt-3 rounded-[10px] px-4 py-2 text-[12px]" style={{ background: DS.success + "1F", color: DS.success }}>
          {successMsg}
        </div>
      )}
    </div>
  );
}

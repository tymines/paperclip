import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, ExternalLink, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { designApi, type DesignSkill } from "../../../api/design";
import { useBulkUploadState } from "./state";

/**
 * Step 1 alternate-mode panel: instead of uploading an existing file,
 * spin up an open-design run and inject the resulting HTML artifact into
 * the bulk-upload draft as a placeholder asset that downstream steps
 * (caption + schedule) can pick up.
 *
 * Phase 1 surface: PNG rasterization of the HTML happens later — the
 * iframe preview + "Open in Design" link cover the in-session loop while
 * the asset row in the batch carries the design run id for traceability.
 */

const POLL_MS = 2_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

// Picker shortlist — the full 130+ catalog is overkill inside the
// step-1 inline panel. The full picker lives at /design.
const PRIORITY_SKILLS = [
  "card-xiaohongshu",
  "card-twitter",
  "social-x-post-card",
  "social-reddit-card",
  "poster-hero",
  "article-magazine",
  "email-marketing",
];

export function BulkUploadGenerateWithDesign() {
  const { companyId } = useBulkUploadState();
  const qc = useQueryClient();
  const skillsQ = useQuery({
    queryKey: ["design", "skills"],
    queryFn: () => designApi.skills(),
    staleTime: 5 * 60_000,
  });

  const shortlist = useMemo<DesignSkill[]>(() => {
    const all = skillsQ.data?.skills ?? [];
    const idx = new Map(all.map((s) => [s.id, s]));
    return PRIORITY_SKILLS.map((id) => idx.get(id)).filter((s): s is DesignSkill => !!s);
  }, [skillsQ.data]);

  const [skillId, setSkillId] = useState<string>("card-xiaohongshu");
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () =>
      designApi.startRun(companyId, {
        skill: skillId,
        prompt,
      }),
    onSuccess: (data) => {
      setRunId(data.run.id);
      qc.invalidateQueries({ queryKey: ["design", "runs"] });
    },
  });

  const runQ = useQuery({
    queryKey: ["design", "run", runId],
    queryFn: () => designApi.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (q) => {
      const status = q.state.data?.run.status;
      return status && TERMINAL.has(status) ? false : POLL_MS;
    },
  });
  const run = runQ.data?.run;

  useEffect(() => {
    const sel = shortlist.find((s) => s.id === skillId);
    if (sel?.examplePrompt && !prompt) setPrompt(sel.examplePrompt);
  }, [shortlist, skillId, prompt]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card/50 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        <span className="text-sm font-medium">Generate with Design</span>
        <span className="text-xs text-muted-foreground">
          Local open-design daemon · {shortlist.length || 0} curated skills
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {shortlist.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSkillId(s.id)}
            className={`rounded border px-2 py-1 text-xs ${
              skillId === s.id ? "border-foreground bg-muted" : "border-border hover:bg-muted"
            }`}
            title={s.description}
          >
            {s.id}
          </button>
        ))}
      </div>

      <textarea
        className="min-h-[88px] rounded border border-border bg-background p-2 text-sm"
        placeholder="Brief — audience, tone, palette, copy."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="flex items-center justify-between gap-2">
        <a
          href="/design"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Open full Design picker
        </a>
        <Button
          type="button"
          size="sm"
          disabled={startMutation.isPending || !prompt.trim() || !companyId}
          onClick={() => startMutation.mutate()}
        >
          <Wand2 className="mr-1 h-3 w-3" />
          {startMutation.isPending ? "Starting…" : "Run"}
        </Button>
      </div>

      {startMutation.isError ? (
        <p className="text-xs text-red-600">
          {(startMutation.error as Error).message}
        </p>
      ) : null}

      {run ? (
        <div className="flex flex-col gap-2 rounded border border-border bg-background p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono">{run.skill}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                run.status === "completed"
                  ? "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-200"
                  : run.status === "failed"
                    ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200"
                    : "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-200"
              }`}
            >
              {run.status}
            </span>
          </div>
          <div className="h-72 overflow-hidden rounded border border-border bg-muted/30">
            {run.assetUrl ? (
              <iframe
                title="design preview"
                src={run.assetUrl}
                sandbox="allow-scripts allow-same-origin"
                className="h-full w-full border-0"
              />
            ) : run.error ? (
              <div className="grid h-full place-items-center p-2 text-center text-xs text-red-600">
                {run.error}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-xs text-muted-foreground">
                Agent is working… (Phase 1 keeps you here; PNG rasterization lands in Phase 2)
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

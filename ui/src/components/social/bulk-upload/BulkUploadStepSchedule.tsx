/**
 * Step 3 — Schedule strategy + preview + commit.
 *
 * Three strategies (Even spread / Best times / Custom queue), preview
 * pane that lists the proposed schedule grouped by day, and "Commit
 * schedule" → writes to social_posts via the auto-schedule algorithm.
 *
 * v0 limitation: preview is a list, not a drag-to-adjust calendar. The
 * commit endpoint accepts whatever strategy the user previewed, so once
 * a drag-to-adjust UI lands it can simply send a custom-queue with the
 * adjusted slots.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Layers,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "../../../lib/utils";
import {
  bulkUploadApi,
  type CommitResponse,
  type CustomQueueConfig,
  type PreviewItem,
  type ScheduleStrategy,
} from "../../../api/bulkUpload";
import { PLATFORM_META } from "../platform-meta";
import {
  BULK_UPLOAD_PLATFORMS,
  useBulkUploadState,
  type BulkUploadPlatform,
} from "./state";

interface Props {
  onBack: () => void;
}

type StrategyKind = "even" | "best-times" | "custom-queue";

const STRATEGY_CARDS: Array<{
  kind: StrategyKind;
  label: string;
  hint: string;
  icon: typeof Layers;
}> = [
  {
    kind: "even",
    label: "Even spread",
    hint: "Distribute evenly across a date range.",
    icon: Layers,
  },
  {
    kind: "best-times",
    label: "Best times",
    hint: "Slot each post into the optimal upcoming time per platform.",
    icon: Sparkles,
  },
  {
    kind: "custom-queue",
    label: "Custom queue",
    hint: "Define a recurring weekly schedule per platform.",
    icon: CalendarDays,
  },
];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function BulkUploadStepSchedule({ onBack }: Props) {
  const { companyId, draftId, uploads } = useBulkUploadState();
  const [kind, setKind] = useState<StrategyKind>("best-times");
  const [startDate, setStartDate] = useState(todayPlus(1));
  const [dayCount, setDayCount] = useState(7);
  const [postsPerDay, setPostsPerDay] = useState(3);
  const [customQueue, setCustomQueue] = useState<
    CustomQueueConfig["perPlatform"]
  >({});
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);

  const strategy = useMemo<ScheduleStrategy>(() => {
    if (kind === "even") {
      return {
        kind: "even",
        startDate,
        dayCount,
        postsPerDayPerPlatform: postsPerDay,
      };
    }
    if (kind === "best-times") {
      return { kind: "best-times", startDate };
    }
    return { kind: "custom-queue", startDate, perPlatform: customQueue };
  }, [kind, startDate, dayCount, postsPerDay, customQueue]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("Upload step never created a draft");
      return bulkUploadApi.preview(companyId, draftId, strategy);
    },
  });

  // Auto-preview whenever the strategy or its config changes.
  useEffect(() => {
    if (!draftId) return;
    previewMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, kind, startDate, dayCount, postsPerDay, customQueue]);

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("No draft to commit");
      return bulkUploadApi.commit(companyId, draftId, strategy);
    },
    onSuccess: (result) => setCommitResult(result),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) return;
      await bulkUploadApi.updateDraft(companyId, draftId, {
        step: "schedule",
        strategy: strategy.kind,
        strategyConfig: strategy,
      });
    },
  });

  // Build the per-platform set used for custom-queue editor.
  const platformsInUse = useMemo<BulkUploadPlatform[]>(() => {
    const set = new Set<BulkUploadPlatform>();
    for (const u of uploads) {
      for (const p of u.platforms) set.add(p);
    }
    return BULK_UPLOAD_PLATFORMS.filter((p) => set.has(p));
  }, [uploads]);

  if (commitResult) {
    return <CommitSuccess result={commitResult} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Strategy picker */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STRATEGY_CARDS.map((card) => {
          const Icon = card.icon;
          const active = kind === card.kind;
          return (
            <button
              key={card.kind}
              type="button"
              onClick={() => setKind(card.kind)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                active
                  ? "border-foreground bg-accent/30"
                  : "border-border bg-card/40 hover:border-foreground/50",
              )}
              aria-pressed={active}
            >
              <Icon className="h-5 w-5" />
              <p className="text-sm font-medium">{card.label}</p>
              <p className="text-xs text-muted-foreground">{card.hint}</p>
            </button>
          );
        })}
      </div>

      {/* Per-strategy config */}
      <div className="rounded-md border border-border bg-card/40 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              min={todayPlus(0)}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          {kind === "even" ? (
            <>
              <Field label="Days">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={dayCount}
                  onChange={(e) => setDayCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Per platform / day">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={postsPerDay}
                  onChange={(e) => setPostsPerDay(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </Field>
            </>
          ) : null}
        </div>
        {kind === "custom-queue" ? (
          <CustomQueueEditor
            platforms={platformsInUse}
            value={customQueue}
            onChange={setCustomQueue}
          />
        ) : null}
      </div>

      {/* Preview */}
      <PreviewPane
        loading={previewMutation.isPending}
        items={previewMutation.data?.items ?? []}
        unscheduled={previewMutation.data?.unscheduled ?? []}
        error={previewMutation.error?.message ?? null}
      />

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saveDraftMutation.isPending}
            onClick={() => saveDraftMutation.mutate()}
          >
            {saveDraftMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            Save as draft
          </Button>
          <Button
            type="button"
            disabled={
              commitMutation.isPending ||
              (previewMutation.data?.items.length ?? 0) === 0
            }
            onClick={() => commitMutation.mutate()}
          >
            {commitMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            Commit schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface CustomQueueEditorProps {
  platforms: BulkUploadPlatform[];
  value: CustomQueueConfig["perPlatform"];
  onChange: (v: CustomQueueConfig["perPlatform"]) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function CustomQueueEditor({ platforms, value, onChange }: CustomQueueEditorProps) {
  if (platforms.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Set platform targets on your files first, then come back to define their weekly slots.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      {platforms.map((p) => {
        const meta = PLATFORM_META[p];
        const Icon = meta.icon;
        const slots = value[p] ?? [];
        return (
          <div key={p} className="rounded-md border border-border bg-background/40 p-2">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...value };
                  next[p] = [...slots, { weekday: 2, hour: 10, minute: 0 }];
                  onChange(next);
                }}
              >
                Add slot
              </Button>
            </div>
            {slots.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No slots yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {slots.map((s, idx) => (
                  <li
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-[11px]"
                  >
                    <select
                      value={s.weekday}
                      onChange={(e) => {
                        const next = { ...value };
                        const arr = [...(next[p] ?? [])];
                        arr[idx] = { ...arr[idx], weekday: Number(e.target.value) as 0 };
                        next[p] = arr;
                        onChange(next);
                      }}
                      className="bg-transparent text-xs"
                    >
                      {WEEKDAY_LABELS.map((lbl, i) => (
                        <option key={lbl} value={i}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={`${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(":");
                        const next = { ...value };
                        const arr = [...(next[p] ?? [])];
                        arr[idx] = {
                          ...arr[idx],
                          hour: Number(hh) || 0,
                          minute: Number(mm) || 0,
                        };
                        next[p] = arr;
                        onChange(next);
                      }}
                      className="bg-transparent text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...value };
                        next[p] = (next[p] ?? []).filter((_, i) => i !== idx);
                        onChange(next);
                      }}
                      className="ml-0.5 text-muted-foreground hover:text-destructive"
                      aria-label="Remove slot"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PreviewPaneProps {
  loading: boolean;
  items: PreviewItem[];
  unscheduled: Array<{ uploadId: string; platform: string; reason: string }>;
  error: string | null;
}

function PreviewPane({ loading, items, unscheduled, error }: PreviewPaneProps) {
  // Group by date.
  const groups = useMemo(() => {
    const m = new Map<string, PreviewItem[]>();
    for (const item of items) {
      const date = item.scheduledAt.slice(0, 10);
      const list = m.get(date) ?? [];
      list.push(item);
      m.set(date, list);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({
        date,
        items: list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
      }));
  }, [items]);

  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Preview ({items.length} {items.length === 1 ? "post" : "posts"})
        </span>
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Computing…
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
      {groups.length === 0 && !loading && !error ? (
        <p className="text-xs text-muted-foreground">
          Nothing to schedule. Make sure each file has at least one platform target.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.date}>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {formatDate(g.date)}
            </p>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {g.items.map((item) => {
                const meta = PLATFORM_META[item.platform as BulkUploadPlatform];
                const Icon = meta?.icon ?? Clock;
                return (
                  <li
                    key={`${item.uploadId}-${item.platform}`}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{meta?.label ?? item.platform}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{formatTime(item.scheduledAt)}</span>
                    <span className="ml-auto truncate text-[10px] text-muted-foreground/70">
                      {item.uploadId.slice(0, 8)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {unscheduled.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {unscheduled.length} could not be scheduled:
          <ul className="mt-1 list-inside list-disc">
            {unscheduled.slice(0, 5).map((u, i) => (
              <li key={i}>
                {u.platform} — {u.reason}
              </li>
            ))}
            {unscheduled.length > 5 ? <li>…and {unscheduled.length - 5} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CommitSuccess({ result }: { result: CommitResponse }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-emerald-300/70 bg-emerald-50/90 p-4 text-sm text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5" />
        <p className="font-semibold">
          Scheduled {result.committed.length} post{result.committed.length === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-emerald-500/20 rounded-md border border-emerald-500/30 bg-background/40">
        {result.committed.slice(0, 20).map((row) => {
          const meta = PLATFORM_META[row.platform as BulkUploadPlatform];
          const Icon = meta?.icon ?? Clock;
          return (
            <li
              key={row.postId}
              className="flex items-center gap-2 px-2 py-1.5 text-xs"
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{meta?.label ?? row.platform}</span>
              <span className="text-muted-foreground">·</span>
              <span>{formatDate(row.scheduledAt.slice(0, 10))}</span>
              <span>{formatTime(row.scheduledAt)}</span>
            </li>
          );
        })}
      </ul>
      {result.errors.length > 0 ? (
        <div className="text-xs">
          {result.errors.length} could not be scheduled:
          <ul className="mt-1 list-inside list-disc">
            {result.errors.map((e, i) => (
              <li key={i}>
                {e.platform} — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] opacity-80">
        These are now visible in the Calendar and Queue tabs. The existing
        publisher will fire each one at its scheduled time.
      </p>
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  try {
    const d = new Date(`${yyyymmdd}T00:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return yyyymmdd;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

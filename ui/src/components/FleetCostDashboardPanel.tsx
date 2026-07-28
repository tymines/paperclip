import type { FleetCostDashboardPayload } from "@paperclipai/shared";
import { AlertTriangle, Gauge, TimerReset } from "lucide-react";
import { cn, formatTokens } from "../lib/utils";

function usd(value: number | null | undefined): string {
  if (value == null) return "unknown";
  return `$${value.toFixed(4)}`;
}

function ms(value: number | null | undefined): string {
  if (value == null) return "unavailable";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function rate(value: number | null | undefined): string {
  if (value == null) return "unavailable";
  return `${value.toFixed(2)} tok/s`;
}

function billingLabel(row: { billingMode: string; costStatus: string; actualCostUsd: number | null }) {
  if (row.costStatus === "included" || row.billingMode === "subscription_included") {
    return `Included · actual unavailable`;
  }
  if (row.actualCostUsd == null) return "Unknown actual";
  return "Metered";
}

function costLabel(row: { actualCostUsd: number | null; estimatedCostUsd?: number | null }) {
  if (row.actualCostUsd != null) return `actual ${usd(row.actualCostUsd)}`;
  if (row.estimatedCostUsd != null) return `estimated ${usd(row.estimatedCostUsd)}`;
  return "unknown";
}

function sourceStatusClass(status: string): string {
  if (status === "ok") return "bg-emerald-500/15 text-emerald-200";
  if (status === "unavailable") return "bg-red-500/15 text-red-200";
  return "bg-amber-500/15 text-amber-200";
}

export function FleetCostDashboardPanel({ payload }: { payload: FleetCostDashboardPayload }) {
  const totalCost = payload.modelRows.reduce((sum, row) => sum + (row.actualCostUsd ?? row.estimatedCostUsd ?? 0), 0);
  const totalOutput = payload.modelRows.reduce((sum, row) => sum + row.outputTokens, 0);
  const topTask = payload.taskRows[0] ?? null;
  const topModel = payload.modelRows[0] ?? null;

  return (
    <section className="rounded-lg border border-border bg-card text-card-foreground" data-testid="fleet-cost-dashboard">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground">Hermes fleet cost</div>
          <h2 className="text-lg font-semibold">Cost and speed by task, agent, and model</h2>
          <div className="mt-1 text-sm text-muted-foreground">
            Grain {payload.grain} · observed {payload.freshness.observedAt ? new Date(payload.freshness.observedAt).toLocaleString() : "not yet"}
          </div>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="fleet-sources">
            {payload.sources.map((source) => (
              <span
                key={`${source.boxId}:${source.collectorId}`}
                title={source.detail ?? source.errors.join("; ") ?? undefined}
                className={cn("rounded px-2 py-1 text-xs font-medium", sourceStatusClass(source.status))}
              >
                {source.boxId} · {source.status}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          <Metric label="Estimated or included cost" value={usd(totalCost)} />
          <Metric label="Output tokens" value={formatTokens(totalOutput)} />
          <Metric label="Unattributed" value={String(payload.unattributedSessions.length)} />
        </div>
      </div>

      {payload.freshness.errors.length > 0 ? (
        <div className="flex gap-2 border-b border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{payload.freshness.errors.join("; ")}</div>
        </div>
      ) : null}

      <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="overflow-x-auto">
          <div className="mb-3 rounded-md border border-border p-3">
            <div className="text-sm font-medium">{payload.grain} trend</div>
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              {payload.trends.map((row) => (
                <div key={row.bucket} className="rounded border border-border px-2 py-1">
                  <div className="font-mono text-card-foreground">{row.bucket}</div>
                  <div>{usd(row.costUsd)} · {formatTokens(row.outputTokens)} out · {row.completedTasks} done</div>
                </div>
              ))}
            </div>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Cost</th>
                <th className="py-2 pr-3">Wall / Speed</th>
                <th className="py-2 pr-3">Turns</th>
                <th className="py-2 pr-3">Compactions / Stalls</th>
              </tr>
            </thead>
            <tbody>
              {payload.taskRows.slice(0, 6).map((row) => (
                <tr key={row.issueId ?? row.sessionIds.join(":")} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{row.issueIdentifier ?? "Unattributed"}</div>
                    <div className="max-w-[260px] truncate text-xs text-muted-foreground">{row.issueTitle ?? row.sessionIds[0]}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{row.agentName ?? "unknown"}</div>
                    <div className="text-xs text-muted-foreground">{row.boxes.join(", ")}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{usd(row.costUsd)}</div>
                    <div className="text-xs text-muted-foreground">per done {usd(row.costPerCompletedTaskUsd)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{ms(row.wallClockMs)} wall</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground"><TimerReset className="h-3.5 w-3.5" /> {ms(row.avgLatencyMs)} latency</div>
                    <div className="text-xs text-muted-foreground">{ms(row.avgTtftMs)} TTFT</div>
                    <div className="text-xs text-muted-foreground">{rate(row.throughputOutputTokensPerSecond)}</div>
                  </td>
                  <td className="py-2 pr-3">{row.turns}</td>
                  <td className="py-2 pr-3">
                    <div>{row.compactions}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.stalls == null ? "Stalls unavailable" : `${row.stalls} stalls`}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload.taskRows.length > 6 ? (
            <div className="mt-2 text-xs text-muted-foreground">+{payload.taskRows.length - 6} more tasks not shown</div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Gauge className="h-4 w-4" /> Model decision surface</div>
            {payload.modelRows.slice(0, 5).map((row) => (
              <div key={`${row.provider}:${row.model}:${row.billingMode}`} className="border-t border-border py-2 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.model}</div>
                    <div className="text-xs text-muted-foreground">{row.provider} · {row.pricingVersion ?? "pricing unknown"}</div>
                    <div className="text-xs text-muted-foreground">{row.boxes.join(", ")}</div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded px-2 py-1 text-xs font-medium",
                      row.costStatus === "included" ? "bg-emerald-500/15 text-emerald-200" : "bg-sky-500/15 text-sky-200",
                    )}
                  >
                    {billingLabel(row)}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>{costLabel(row)}</span>
                  <span>{row.usageApiCalls} usage calls (state.db)</span>
                  <span>{row.completedTasks} Completed tasks</span>
                  <span>{usd(row.costPerCompletedTaskUsd)} Cost / completed</span>
                  <span>{ms(row.avgTaskWallClockMs)} Task wall</span>
                  <span>{row.turns === null ? "turns unavailable" : `${row.turns} turns`}</span>
                  {row.speedAvailability === "available" || row.speedAvailability === "partial" ? (
                    <>
                      <span>
                        {row.speedSampleApiCalls} observed speed samples
                        {row.speedAvailability === "partial"
                          ? ` (partial coverage; ${row.speedAmbiguousOmittedApiCalls} ambiguous omitted)`
                          : ""}
                      </span>
                      <span>{rate(row.throughputOutputTokensPerSecond)}</span>
                      <span>{ms(row.avgLatencyMs)} latency</span>
                      <span>{ms(row.avgTtftMs)} TTFT</span>
                    </>
                  ) : (
                    <span className="col-span-2">
                      {row.speedAvailability === "ambiguous"
                        ? `speed ambiguous (split billing identity; ${row.speedAmbiguousOmittedApiCalls} observed call${row.speedAmbiguousOmittedApiCalls === 1 ? "" : "s"} not attributed)`
                        : "speed unavailable (no attributed observed calls)"}
                    </span>
                  )}
                  <span>{row.compactions} compactions</span>
                  <span>{row.stallsAvailability === "unavailable" ? "Stalls unavailable" : `${row.stalls ?? 0} stalls`}</span>
                </div>
              </div>
            ))}
            {payload.modelRows.length > 5 ? (
              <div className="text-xs text-muted-foreground">+{payload.modelRows.length - 5} more models not shown</div>
            ) : null}
            {!topModel ? <div className="text-sm text-muted-foreground">No model usage collected yet.</div> : null}
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="text-sm font-medium">Unattributed sessions</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {payload.unattributedSessions.length > 0
                ? payload.unattributedSessions.slice(0, 3).map((row) => `${row.boxId}:${row.sessionId}`).join(", ")
                : "None"}
            </div>
          </div>
          {topTask ? (
            <div className="text-xs text-muted-foreground">
              Stalls are {payload.availability.stalls ?? "unavailable"} for this source.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

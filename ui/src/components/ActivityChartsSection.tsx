/**
 * ActivityChartsSection — Spend chart + Spend-by-agent rollup for /activity.
 *
 * Pulled into its own module so React.lazy() in Activity.tsx can ship it
 * in a second chunk that doesn't block first paint. Before this split,
 * the page took ~12s to render on a throttled mobile connection because
 * the SVG-rendering code in ActivityCharts.tsx (~9 KB + transitive
 * lucide-react icons) was in the initial bundle next to 200 activity rows.
 *
 * Keep this file dependency-light: every import here is also paid by the
 * lazy chunk.
 */
import { Link } from "@/lib/router";
import { ChartCard, SpendActivityChart } from "./ActivityCharts";
import type { CostByAgent, DashboardSummary } from "@paperclipai/shared";
import { agentUrl, formatCostUsdCompact, formatTokens } from "../lib/utils";

export interface ActivityChartsSectionProps {
  dashboard: DashboardSummary | undefined;
  topCostAgents: CostByAgent[];
}

export default function ActivityChartsSection({
  dashboard,
  topCostAgents,
}: ActivityChartsSectionProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-pp-activity-spend-overview>
      <ChartCard title="Spend" subtitle="Last 14 days">
        <SpendActivityChart activity={dashboard?.runActivity ?? []} />
      </ChartCard>
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Spend by agent</h3>
          <span className="text-[10px] text-muted-foreground/60">Last 30 days</span>
        </div>
        {topCostAgents.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No per-agent spend yet — once cost_events flow this fills in.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60 text-xs">
            {topCostAgents.map((row) => {
              const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
              const agentRef = row.agentId
                ? agentUrl({ id: row.agentId, name: row.agentName ?? null, urlKey: null })
                : null;
              return (
                <li
                  key={row.agentId ?? "unknown"}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="min-w-0 truncate">
                    {agentRef ? (
                      <Link to={agentRef} className="text-foreground/80 hover:underline">
                        {row.agentName ?? row.agentId?.slice(0, 8) ?? "Unknown agent"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Unattributed</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
                    {tokens > 0 ? (
                      <span className="text-muted-foreground">{formatTokens(tokens)}t</span>
                    ) : null}
                    <span className="text-foreground/80">
                      {formatCostUsdCompact((row.costCents ?? 0) / 100)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

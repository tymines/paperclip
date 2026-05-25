/**
 * Cost Watcher — single-page merge of three cost-relevant data streams that
 * each live behind their own surface today:
 *
 *   • Bridge usage / cost_usd recorded by the openclaw-gateway adapter and
 *     persisted to cost_events (the v2-pass-all branch's bridge-fix work).
 *   • Provider-API credit balances + spend reports (DeepSeek, Moonshot,
 *     OpenAI, Anthropic, Gemini) from services/provider-credits.
 *   • Per-agent rollups joining cost_events → agents for attribution.
 *
 * This page is read-only and additive — the existing /costs page is the
 * provider-credits-only deep dive and stays untouched. Cost Watcher is the
 * "what's burning where, and how much runway do I have" answer.
 *
 * The server endpoint /api/companies/:id/cost-watcher aggregates the whole
 * payload in one round-trip with a 30s in-memory cache; this page does
 * nothing more than render it.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Flame,
  ShieldAlert,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type {
  CostWatcherAgentRow,
  CostWatcherAlert,
  CostWatcherPayload,
  CostWatcherTimelineSeries,
} from "@paperclipai/shared";
import { useNavigate } from "@/lib/router";
import { costWatcherApi } from "../api/costWatcher";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { cn, formatTokens } from "../lib/utils";

const SNOOZE_KEY_PREFIX = "cost-watcher:snooze:";
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

// ─── helpers ────────────────────────────────────────────────────────────────

function formatUsd(value: number, opts: { showCents?: boolean } = {}): string {
  const showCents = opts.showCents ?? Math.abs(value) < 100;
  const fractionDigits = showCents ? 2 : 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatRunway(days: number | null): { primary: string; secondary: string } {
  if (days == null) return { primary: "Indefinite", secondary: "No spend yet — runway uncapped." };
  if (!Number.isFinite(days)) return { primary: "—", secondary: "No credits exposed by providers." };
  if (days >= 365) return { primary: `${(days / 365).toFixed(1)}y`, secondary: "Years of runway at current burn." };
  if (days >= 30) return { primary: `${(days / 30).toFixed(1)}mo`, secondary: "Months of runway at current burn." };
  return { primary: `${days.toFixed(1)}d`, secondary: "Days of runway at current burn." };
}

function readSnoozed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const out = new Set<string>();
  const now = Date.now();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(SNOOZE_KEY_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt)) continue;
    if (expiresAt > now) out.add(key.slice(SNOOZE_KEY_PREFIX.length));
    else window.localStorage.removeItem(key);
  }
  return out;
}

function persistSnooze(alertId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SNOOZE_KEY_PREFIX + alertId, String(Date.now() + SNOOZE_DURATION_MS));
}

// ─── top tiles ──────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-500"
      : tone === "warning"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card/60 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border", toneClass)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

// ─── per-provider strip ─────────────────────────────────────────────────────

function ProviderStrip({ payload }: { payload: CostWatcherPayload }) {
  const burnPerDay = payload.totals.burnRatePerDayUsd;
  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Providers</h2>
        <p className="text-xs text-muted-foreground">
          Pulse-glow = balance covers under 7 days at current burn.
        </p>
      </header>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 -mx-4 px-4 scrollbar-hide">
        {payload.providers.map((card) => {
          const formatter = new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: card.currency || "USD",
            maximumFractionDigits: 2,
          });
          const dailyBurn = card.spendThisWeek > 0 ? card.spendThisWeek / 7 : 0;
          const runwayDays =
            card.balance != null && dailyBurn > 0 ? card.balance / dailyBurn : null;
          const pulse = runwayDays != null && runwayDays < 7;
          return (
            <article
              key={card.provider}
              className={cn(
                "relative w-[220px] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-card p-3",
                pulse && "ring-1 ring-amber-400/50 shadow-[0_0_0_4px_rgba(251,191,36,0.08)] animate-[pulse_3s_ease-in-out_infinite]",
              )}
              data-pp-provider-card={card.provider}
              data-pp-pulse={pulse ? "true" : undefined}
            >
              <div
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: card.brandColor }}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[13px] font-semibold">{card.name}</h3>
                    {card.isStub ? (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                        Stub
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {card.balance != null
                      ? `${formatter.format(card.balance)} balance`
                      : "Balance not exposed"}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">7d</div>
                  <div className="tabular-nums">{formatter.format(card.spendThisWeek)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">MTD</div>
                  <div className="tabular-nums">{formatter.format(card.spendThisMonth)}</div>
                </div>
              </div>
              {pulse ? (
                <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-300">
                  ~{runwayDays!.toFixed(1)}d at {formatter.format(dailyBurn)}/day
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
      {burnPerDay > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Company-wide burn: {formatUsd(burnPerDay)}/day (last 7d average).
        </p>
      ) : null}
    </section>
  );
}

// ─── timeline chart ─────────────────────────────────────────────────────────

type StackMode = "byProvider" | "byAgent";

interface TimelineDatum {
  day: string;
  [seriesKey: string]: string | number;
}

function buildChartData(days: string[], series: CostWatcherTimelineSeries[]): TimelineDatum[] {
  return days.map((day, idx) => {
    const row: TimelineDatum = { day };
    for (const s of series) {
      row[s.key] = s.values[idx] ?? 0;
    }
    return row;
  });
}

function SpendTimeline({ payload }: { payload: CostWatcherPayload }) {
  const [mode, setMode] = useState<StackMode>("byProvider");
  const series = mode === "byProvider" ? payload.timeline.byProvider : payload.timeline.byAgent;
  const data = useMemo(() => buildChartData(payload.timeline.days, series), [payload.timeline.days, series]);

  const empty = series.every((s) => s.values.every((v) => v === 0));

  return (
    <section className="rounded-lg border border-border bg-card/60 p-4 backdrop-blur-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">30-day spend</h2>
          <p className="text-[11px] text-muted-foreground">
            Daily USD spend stacked by{" "}
            {mode === "byProvider" ? "provider" : "agent"} over the last 30 days.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
          {(
            [
              { key: "byProvider", label: "By provider" },
              { key: "byAgent", label: "By agent" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMode(option.key)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                mode === option.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-pp-chart-mode={option.key}
              data-pp-chart-mode-active={mode === option.key ? "true" : undefined}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>
      <div className="h-64 w-full overflow-x-auto" data-pp-timeline-empty={empty ? "true" : undefined}>
        <div className="h-full min-w-[600px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`cw-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.7} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
              <XAxis
                dataKey="day"
                tickFormatter={(d: string) => d.slice(5)}
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                strokeOpacity={0.3}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v.toFixed(v < 10 ? 2 : 0)}`}
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                strokeOpacity={0.3}
                width={48}
              />
              <Tooltip
                contentStyle={{ background: "rgba(15,23,42,0.92)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 8, color: "white", fontSize: 11 }}
                labelStyle={{ color: "rgba(226,232,240,0.7)", marginBottom: 4 }}
                formatter={(value: number) => formatUsd(value, { showCents: true })}
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stackId="1"
                  stroke={s.color}
                  fill={`url(#cw-grad-${s.key})`}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      {empty ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          No spend recorded in the last 30 days.
        </p>
      ) : null}
    </section>
  );
}

// ─── leaderboard ────────────────────────────────────────────────────────────

type LeaderboardSort = "spend" | "runs" | "tokens" | "avg";

const SORTERS: Record<LeaderboardSort, (a: CostWatcherAgentRow, b: CostWatcherAgentRow) => number> = {
  spend: (a, b) => b.spendUsd - a.spendUsd,
  runs: (a, b) => b.runs - a.runs,
  tokens: (a, b) =>
    b.inputTokens + b.cachedInputTokens + b.outputTokens -
    (a.inputTokens + a.cachedInputTokens + a.outputTokens),
  avg: (a, b) => b.avgSpendPerRunUsd - a.avgSpendPerRunUsd,
};

function statusToneClass(status: string): string {
  switch (status) {
    case "running":
    case "active":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case "paused":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-300";
    case "terminated":
    case "error":
      return "bg-red-500/15 text-red-600 dark:text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function AgentLeaderboard({ rows, companyPrefix }: { rows: CostWatcherAgentRow[]; companyPrefix: string | null }) {
  const [sort, setSort] = useState<LeaderboardSort>("spend");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const navigate = useNavigate();

  const sorted = useMemo(() => {
    const arr = rows.slice().sort(SORTERS[sort]);
    return direction === "asc" ? arr.reverse() : arr;
  }, [rows, sort, direction]);

  function toggle(next: LeaderboardSort) {
    if (sort === next) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setDirection("desc");
    }
  }

  const indicator = (key: LeaderboardSort) =>
    sort === key ? (direction === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />) : null;

  return (
    <section className="rounded-lg border border-border bg-card/60 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Per-agent spend (last 30d)</h2>
          <p className="text-[11px] text-muted-foreground">Click an agent to open its detail page.</p>
        </div>
      </header>
      {sorted.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No agents have produced cost events in the last 30 days.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-pp-leaderboard="true">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Agent</th>
                <th className="px-2 py-2">Adapter</th>
                <SortHeader label="Runs" sortKey="runs" current={sort} indicator={indicator("runs")} onClick={toggle} />
                <SortHeader label="Tokens" sortKey="tokens" current={sort} indicator={indicator("tokens")} onClick={toggle} />
                <SortHeader label="Spend" sortKey="spend" current={sort} indicator={indicator("spend")} onClick={toggle} />
                <SortHeader label="$/run" sortKey="avg" current={sort} indicator={indicator("avg")} onClick={toggle} />
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const totalTokens = row.inputTokens + row.cachedInputTokens + row.outputTokens;
                return (
                  <tr
                    key={row.agentId}
                    className="cursor-pointer border-t border-border/60 transition-colors hover:bg-accent/40"
                    onClick={() => {
                      if (companyPrefix) navigate(`/${companyPrefix}/agents/${row.agentId}`);
                    }}
                    data-pp-leaderboard-row={row.agentId}
                  >
                    <td className="px-4 py-2 font-medium">{row.agentName}</td>
                    <td className="px-2 py-2 text-muted-foreground">{row.adapterType}</td>
                    <td className="px-2 py-2 tabular-nums">{row.runs}</td>
                    <td className="px-2 py-2 tabular-nums" title={`in ${formatTokens(row.inputTokens)} · cached ${formatTokens(row.cachedInputTokens)} · out ${formatTokens(row.outputTokens)}`}>
                      {formatTokens(totalTokens)}
                    </td>
                    <td className="px-2 py-2 font-semibold tabular-nums">{formatUsd(row.spendUsd, { showCents: true })}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatUsd(row.avgSpendPerRunUsd, { showCents: true })}</td>
                    <td className="px-2 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", statusToneClass(row.agentStatus))}>
                        {row.agentStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  indicator,
  onClick,
}: {
  label: string;
  sortKey: LeaderboardSort;
  current: LeaderboardSort;
  indicator: React.ReactNode;
  onClick: (key: LeaderboardSort) => void;
}) {
  return (
    <th className="px-2 py-2">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors",
          current === sortKey ? "text-foreground" : "hover:text-foreground",
        )}
        data-pp-sort={sortKey}
        data-pp-sort-active={current === sortKey ? "true" : undefined}
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

// ─── alerts panel ───────────────────────────────────────────────────────────

function AlertsPanel({
  alerts,
  snoozed,
  onSnooze,
}: {
  alerts: CostWatcherAlert[];
  snoozed: Set<string>;
  onSnooze: (id: string) => void;
}) {
  const visible = alerts.filter((a) => !snoozed.has(a.id));
  return (
    <aside
      className="rounded-lg border border-border bg-card/60 backdrop-blur-sm"
      aria-label="Cost alerts"
      data-pp-alerts="true"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Alerts</h2>
          {visible.length > 0 ? (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
              {visible.length}
            </span>
          ) : null}
        </div>
      </header>
      <div className="space-y-2 p-3">
        {visible.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            All clear — no provider is running out and no agent crossed today's ceiling.
          </p>
        ) : (
          visible.map((alert) => {
            const tone =
              alert.severity === "error"
                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200";
            return (
              <article
                key={alert.id}
                className={cn("flex items-start gap-2 rounded-md border p-2 text-xs", tone)}
                data-pp-alert={alert.id}
                data-pp-alert-severity={alert.severity}
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{alert.title}</div>
                  <p className="mt-0.5 leading-4 opacity-90">{alert.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSnooze(alert.id)}
                  className="shrink-0 rounded-md border border-current/30 px-1.5 py-0.5 text-[10px] font-medium opacity-70 transition-opacity hover:opacity-100"
                  aria-label={`Snooze alert ${alert.title} for 24 hours`}
                  data-pp-alert-snooze={alert.id}
                >
                  <X className="inline h-3 w-3" /> 24h
                </button>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ─── page ───────────────────────────────────────────────────────────────────

export function CostWatcher() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [snoozed, setSnoozed] = useState<Set<string>>(() => readSnoozed());
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Cost Watcher" }]);
  }, [setBreadcrumbs]);

  const query = useQuery({
    queryKey: ["cost-watcher", selectedCompanyId],
    queryFn: () => costWatcherApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  function snooze(id: string) {
    persistSnooze(id);
    setSnoozed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={DollarSign} message="Select a company to view Cost Watcher." />;
  }

  if (query.isLoading) {
    return <PageSkeleton variant="costs" />;
  }

  if (query.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load Cost Watcher: {(query.error as Error).message}
      </div>
    );
  }

  const payload = query.data;
  if (!payload) {
    return <EmptyState icon={DollarSign} message="No cost data available yet." />;
  }

  const runway = formatRunway(payload.totals.daysOfRunway);
  const projectedTone =
    payload.totals.projectedMonthlyUsd > payload.totals.monthToDateUsd * 4
      ? "warning"
      : "default";
  const runwayTone =
    payload.totals.daysOfRunway != null && payload.totals.daysOfRunway < 7
      ? "danger"
      : payload.totals.daysOfRunway != null && payload.totals.daysOfRunway < 30
        ? "warning"
        : "default";
  const visibleAlerts = payload.alerts.filter((a) => !snoozed.has(a.id));

  return (
    <div className="space-y-6 pb-16 lg:pb-0" data-pp-page="cost-watcher">
      {/* Heading */}
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Cost Watcher</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Bridge runs, provider balances, and per-agent attribution in one view.{" "}
            <span className="hidden lg:inline">
              Updates every 30 seconds. Snooze any alert for 24h with the ⨯ button.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          Generated {new Date(payload.generatedAt).toLocaleTimeString()}
        </div>
      </header>

      {/* Top tiles */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Spend this month"
          value={formatUsd(payload.totals.monthToDateUsd, { showCents: true })}
          subtitle={`From bridge runs + provider-reported spend, USD-only`}
          icon={DollarSign}
        />
        <MetricTile
          label="Burn rate"
          value={`${formatUsd(payload.totals.burnRatePerDayUsd, { showCents: true })}/day`}
          subtitle={`Projects to ${formatUsd(payload.totals.projectedMonthlyUsd, { showCents: false })}/mo at this pace`}
          icon={Flame}
          tone={projectedTone}
        />
        <MetricTile
          label="Credits remaining"
          value={
            payload.totals.creditsRemainingProviderCount > 0
              ? formatUsd(payload.totals.creditsRemainingUsd, { showCents: false })
              : "N/A"
          }
          subtitle={
            payload.totals.creditsRemainingProviderCount > 0
              ? `Summed across ${payload.totals.creditsRemainingProviderCount} provider${payload.totals.creditsRemainingProviderCount === 1 ? "" : "s"} reporting USD balances`
              : "No provider exposes a USD balance"
          }
          icon={Wallet}
        />
        <MetricTile
          label="Days of runway"
          value={runway.primary}
          subtitle={runway.secondary}
          icon={Activity}
          tone={runwayTone}
        />
      </div>

      {/* Provider strip */}
      <ProviderStrip payload={payload} />

      {/* Main two-col: chart+leaderboard left, alerts right */}
      <div className="grid gap-4 lg:grid-cols-[1fr,18rem]">
        <div className="space-y-4">
          <SpendTimeline payload={payload} />
          <AgentLeaderboard rows={payload.agents} companyPrefix={selectedCompany?.issuePrefix ?? null} />
        </div>
        <div className="hidden lg:block">
          <AlertsPanel alerts={payload.alerts} snoozed={snoozed} onSnooze={snooze} />
        </div>
      </div>

      {/* Mobile bottom sheet — a slide-up tray below `lg`. Sized to fit on
          a phone without covering the leaderboard. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setAlertsOpen((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          aria-expanded={alertsOpen}
          data-pp-mobile-alerts-toggle="true"
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            Alerts
            {visibleAlerts.length > 0 ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                {visibleAlerts.length}
              </span>
            ) : (
              <Sparkles className="h-3 w-3 text-emerald-500" />
            )}
          </span>
          {alertsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        {alertsOpen ? (
          <div className="max-h-[40vh] overflow-y-auto border-t border-border p-3">
            <AlertsPanel alerts={payload.alerts} snoozed={snoozed} onSnooze={snooze} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

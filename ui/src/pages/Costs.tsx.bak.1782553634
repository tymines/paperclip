import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BudgetPolicySummary,
  CostByAgent,
  CostByAgentModel,
  CostByBiller,
  CostByProviderModel,
  CostWatcherPayload,
  CostWindowSpendRow,
  FinanceEvent,
  QuotaWindow,
} from "@paperclipai/shared";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  ChevronDown,
  ChevronRight,
  Coins,
  DollarSign,
  Download,
  Info,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";
import { budgetsApi } from "../api/budgets";
import { costsApi } from "../api/costs";
import { costWatcherApi } from "../api/costWatcher";
import { BillerSpendCard } from "../components/BillerSpendCard";
import { BudgetIncidentCard } from "../components/BudgetIncidentCard";
import { BudgetPolicyCard } from "../components/BudgetPolicyCard";
import { EmptyState } from "../components/EmptyState";
import { FinanceBillerCard } from "../components/FinanceBillerCard";
import { FinanceKindCard } from "../components/FinanceKindCard";
import { FinanceTimelineCard } from "../components/FinanceTimelineCard";
import { Identity } from "../components/Identity";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { ProviderQuotaCard } from "../components/ProviderQuotaCard";
import { ProviderCreditsSection } from "../components/ProviderCreditsSection";
import { MlflowObservabilityCard } from "../components/MlflowObservabilityCard";
import { mlflowApi } from "../api/mlflow";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useIssueNoun } from "../hooks/useIssueNoun";
import { useDateRange, PRESET_KEYS, PRESET_LABELS } from "../hooks/useDateRange";
import { queryKeys } from "../lib/queryKeys";
import { billingTypeDisplayName, cn, formatCents, formatTokens, providerDisplayName } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NO_COMPANY = "__none__";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to the Costs surface so the redesign is self-contained and */
/* does not mutate global theme variables used by other pages. Matches the    */
/* Home / War Room / Fleet builds.                                            */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

// IBM Plex Mono for all numerals (design system spec). Injected once.
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
function useMonoFont() {
  useEffect(() => {
    const id = "ds-plex-mono";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

// Decorative slice/agent hues (styling only — not data).
const SLICE_HUES = [
  DS.primary,
  DS.automation,
  DS.success,
  DS.analytics,
  DS.warning,
  "#7C5CFF",
  "#22B8CF",
  DS.critical,
];

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

function usd(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: DS.textFaint }}>
      {children}
    </span>
  );
}

/* Tiny inline sparkline (area) from a numeric series. */
function Sparkline({ values, color, width = 120, height = 34 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.0000001);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - (v / max) * (height - 4) - 2] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spk-${color.replace("#", "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* Daily spend bar chart. days/values aligned by index. */
function DailyBars({ days, values }: { days: string[]; values: number[] }) {
  const max = Math.max(...values, 0.0000001);
  const hasData = values.some((v) => v > 0);
  const H = 150;
  const labelIdx = days.length > 1 ? [0, Math.floor(days.length / 2), days.length - 1] : [0];
  const fmtDay = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: H }}>
        {values.map((v, i) => {
          const h = hasData ? Math.max((v / max) * (H - 8), v > 0 ? 2 : 0) : 0;
          return (
            <div key={i} className="group relative flex-1" style={{ height: H, display: "flex", alignItems: "flex-end" }}>
              <div
                className="w-full rounded-t-[2px]"
                style={{
                  height: h,
                  background: `linear-gradient(180deg, ${DS.primary} 0%, ${DS.primary}99 100%)`,
                  minHeight: v > 0 ? 2 : 0,
                }}
                title={`${fmtDay(days[i] ?? "")}: ${usd(v)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between" style={{ color: DS.textFaint }}>
        {labelIdx.map((idx) => (
          <span key={idx} className="text-[10px]" style={{ fontFamily: MONO }}>
            {fmtDay(days[idx] ?? "")}
          </span>
        ))}
      </div>
    </div>
  );
}

/* SVG donut from agent slices. */
function AgentDonut({ slices, total }: { slices: { name: string; value: number; color: string }[]; total: number }) {
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={DS.surface3} strokeWidth={stroke} />
          {slices.map((s, i) => {
            const frac = s.value / sum;
            const dash = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
            Total spend
          </span>
          <span className="text-[22px] font-semibold tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
            {formatCents(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon, 0, 0, 0, 0);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59, 999);
  return { from: mon.toISOString(), to: sun.toISOString() };
}

function ProviderTabLabel({ provider, rows }: { provider: string; rows: CostByProviderModel[] }) {
  const totalTokens = rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costCents, 0);
  return (
    <span className="flex items-center gap-1.5">
      <span>{providerDisplayName(provider)}</span>
      <span className="font-mono text-xs text-muted-foreground">{formatTokens(totalTokens)}</span>
      <span className="text-xs text-muted-foreground">{formatCents(totalCost)}</span>
    </span>
  );
}

function BillerTabLabel({ biller, rows }: { biller: string; rows: CostByBiller[] }) {
  const totalTokens = rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costCents, 0);
  return (
    <span className="flex items-center gap-1.5">
      <span>{providerDisplayName(biller)}</span>
      <span className="font-mono text-xs text-muted-foreground">{formatTokens(totalTokens)}</span>
      <span className="text-xs text-muted-foreground">{formatCents(totalCost)}</span>
    </span>
  );
}

function MetricTile({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

function FinanceSummaryCard({
  debitCents,
  creditCents,
  netCents,
  estimatedDebitCents,
  eventCount,
}: {
  debitCents: number;
  creditCents: number;
  netCents: number;
  estimatedDebitCents: number;
  eventCount: number;
}) {
  return (
    <Card>
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-base">Finance ledger</CardTitle>
        <CardDescription>
          Account-level charges that do not map to a single inference request.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 pb-5 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Debits"
          value={formatCents(debitCents)}
          subtitle={`${eventCount} total event${eventCount === 1 ? "" : "s"} in range`}
          icon={ArrowUpRight}
        />
        <MetricTile
          label="Credits"
          value={formatCents(creditCents)}
          subtitle="Refunds, offsets, and credit returns"
          icon={ArrowDownLeft}
        />
        <MetricTile
          label="Net"
          value={formatCents(netCents)}
          subtitle="Debit minus credit for the selected period"
          icon={ReceiptText}
        />
        <MetricTile
          label="Estimated"
          value={formatCents(estimatedDebitCents)}
          subtitle="Estimated debits that are not yet invoice-authoritative"
          icon={Coins}
        />
      </CardContent>
    </Card>
  );
}

export function Costs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const issueNoun = useIssueNoun();

  const [mainTab, setMainTab] = useState<"overview" | "budgets" | "providers" | "billers" | "finance">("overview");
  const [activeProvider, setActiveProvider] = useState("all");
  const [activeBiller, setActiveBiller] = useState("all");

  const {
    preset,
    setPreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    from,
    to,
    customReady,
  } = useDateRange();

  useEffect(() => {
    setBreadcrumbs([{ label: "Costs" }]);
  }, [setBreadcrumbs]);

  const [today, setToday] = useState(() => new Date().toDateString());
  const todayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const schedule = () => {
      const now = new Date();
      const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
      todayTimerRef.current = setTimeout(() => {
        setToday(new Date().toDateString());
        schedule();
      }, ms);
    };
    schedule();
    return () => {
      if (todayTimerRef.current != null) clearTimeout(todayTimerRef.current);
    };
  }, []);

  const weekRange = useMemo(() => currentWeekRange(), [today]);
  const companyId = selectedCompanyId ?? NO_COMPANY;

  const { data: budgetData, isLoading: budgetLoading, error: budgetError } = useQuery({
    queryKey: queryKeys.budgets.overview(companyId),
    queryFn: () => budgetsApi.overview(companyId),
    enabled: !!selectedCompanyId && customReady,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const invalidateBudgetViews = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
  };

  const policyMutation = useMutation({
    mutationFn: (input: {
      scopeType: BudgetPolicySummary["scopeType"];
      scopeId: string;
      amount: number;
      windowKind: BudgetPolicySummary["windowKind"];
    }) =>
      budgetsApi.upsertPolicy(companyId, {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        amount: input.amount,
        windowKind: input.windowKind,
      }),
    onSuccess: invalidateBudgetViews,
  });

  const incidentMutation = useMutation({
    mutationFn: (input: { incidentId: string; action: "keep_paused" | "raise_budget_and_resume"; amount?: number }) =>
      budgetsApi.resolveIncident(companyId, input.incidentId, input),
    onSuccess: invalidateBudgetViews,
  });

  const { data: spendData, isLoading: spendLoading, error: spendError } = useQuery({
    queryKey: queryKeys.costs(companyId, from || undefined, to || undefined),
    queryFn: async () => {
      const [summary, byAgent, byProject, byAgentModel] = await Promise.all([
        costsApi.summary(companyId, from || undefined, to || undefined),
        costsApi.byAgent(companyId, from || undefined, to || undefined),
        costsApi.byProject(companyId, from || undefined, to || undefined),
        costsApi.byAgentModel(companyId, from || undefined, to || undefined),
      ]);
      return { summary, byAgent, byProject, byAgentModel };
    },
    enabled: !!selectedCompanyId && customReady,
  });

  // Authoritative MLflow per-call spend (same source the LLM-observability card
  // and /mlflow/costs use). Drives the Inference-spend headline so the page
  // agrees on ONE source of truth. Shares the cache key with the card.
  const { data: mlflowCostsData } = useQuery({
    queryKey: ["mlflow", "costs"],
    queryFn: () => mlflowApi.costs(30),
    staleTime: 30_000,
  });

  const { data: financeData, isLoading: financeLoading, error: financeError } = useQuery({
    queryKey: [
      queryKeys.financeSummary(companyId, from || undefined, to || undefined),
      queryKeys.financeByBiller(companyId, from || undefined, to || undefined),
      queryKeys.financeByKind(companyId, from || undefined, to || undefined),
      queryKeys.financeEvents(companyId, from || undefined, to || undefined, 18),
    ],
    queryFn: async () => {
      const [summary, byBiller, byKind, events] = await Promise.all([
        costsApi.financeSummary(companyId, from || undefined, to || undefined),
        costsApi.financeByBiller(companyId, from || undefined, to || undefined),
        costsApi.financeByKind(companyId, from || undefined, to || undefined),
        costsApi.financeEvents(companyId, from || undefined, to || undefined, 18),
      ]);
      return { summary, byBiller, byKind, events };
    },
    enabled: !!selectedCompanyId && customReady,
  });

  // Cost Watcher payload — folds the auto-pause/alerts + daily timeline +
  // burn-rate surface into the consolidated Costs page. Read-only aggregate.
  const { data: watcherData } = useQuery({
    queryKey: ["cost-watcher", companyId],
    queryFn: () => costWatcherApi.get(companyId),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedAgents(new Set());
  }, [companyId, from, to]);

  function toggleAgent(agentId: string) {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  const agentModelRows = useMemo(() => {
    const map = new Map<string, CostByAgentModel[]>();
    for (const row of spendData?.byAgentModel ?? []) {
      const rows = map.get(row.agentId) ?? [];
      rows.push(row);
      map.set(row.agentId, rows);
    }
    for (const [agentId, rows] of map) {
      map.set(agentId, rows.slice().sort((a, b) => b.costCents - a.costCents));
    }
    return map;
  }, [spendData?.byAgentModel]);

  const { data: providerData } = useQuery({
    queryKey: queryKeys.usageByProvider(companyId, from || undefined, to || undefined),
    queryFn: () => costsApi.byProvider(companyId, from || undefined, to || undefined),
    enabled: !!selectedCompanyId && customReady && (mainTab === "providers" || mainTab === "billers"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: billerData } = useQuery({
    queryKey: queryKeys.usageByBiller(companyId, from || undefined, to || undefined),
    queryFn: () => costsApi.byBiller(companyId, from || undefined, to || undefined),
    enabled: !!selectedCompanyId && customReady && mainTab === "billers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: weekData } = useQuery({
    queryKey: queryKeys.usageByProvider(companyId, weekRange.from, weekRange.to),
    queryFn: () => costsApi.byProvider(companyId, weekRange.from, weekRange.to),
    enabled: !!selectedCompanyId && (mainTab === "providers" || mainTab === "billers"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: weekBillerData } = useQuery({
    queryKey: queryKeys.usageByBiller(companyId, weekRange.from, weekRange.to),
    queryFn: () => costsApi.byBiller(companyId, weekRange.from, weekRange.to),
    enabled: !!selectedCompanyId && mainTab === "billers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: windowData } = useQuery({
    queryKey: queryKeys.usageWindowSpend(companyId),
    queryFn: () => costsApi.windowSpend(companyId),
    enabled: !!selectedCompanyId && mainTab === "providers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: quotaData, isLoading: quotaLoading } = useQuery({
    queryKey: queryKeys.usageQuotaWindows(companyId),
    queryFn: () => costsApi.quotaWindows(companyId),
    enabled: !!selectedCompanyId && mainTab === "providers",
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  const byProvider = useMemo(() => {
    const map = new Map<string, CostByProviderModel[]>();
    for (const row of providerData ?? []) {
      const rows = map.get(row.provider) ?? [];
      rows.push(row);
      map.set(row.provider, rows);
    }
    return map;
  }, [providerData]);

  const byBiller = useMemo(() => {
    const map = new Map<string, CostByBiller[]>();
    for (const row of billerData ?? []) {
      const rows = map.get(row.biller) ?? [];
      rows.push(row);
      map.set(row.biller, rows);
    }
    return map;
  }, [billerData]);

  const weekSpendByProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of weekData ?? []) {
      map.set(row.provider, (map.get(row.provider) ?? 0) + row.costCents);
    }
    return map;
  }, [weekData]);

  const weekSpendByBiller = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of weekBillerData ?? []) {
      map.set(row.biller, (map.get(row.biller) ?? 0) + row.costCents);
    }
    return map;
  }, [weekBillerData]);

  const windowSpendByProvider = useMemo(() => {
    const map = new Map<string, CostWindowSpendRow[]>();
    for (const row of windowData ?? []) {
      const rows = map.get(row.provider) ?? [];
      rows.push(row);
      map.set(row.provider, rows);
    }
    return map;
  }, [windowData]);

  const quotaWindowsByProvider = useMemo(() => {
    const map = new Map<string, QuotaWindow[]>();
    for (const result of quotaData ?? []) {
      if (result.ok && result.windows.length > 0) {
        map.set(result.provider, result.windows);
      }
    }
    return map;
  }, [quotaData]);

  const quotaErrorsByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of quotaData ?? []) {
      if (!result.ok && result.error) map.set(result.provider, result.error);
    }
    return map;
  }, [quotaData]);

  const quotaSourcesByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of quotaData ?? []) {
      if (typeof result.source === "string" && result.source.length > 0) {
        map.set(result.provider, result.source);
      }
    }
    return map;
  }, [quotaData]);

  const deficitNotchByProvider = useMemo(() => {
    const map = new Map<string, boolean>();
    if (preset !== "mtd") return map;
    const budget = spendData?.summary.budgetCents ?? 0;
    if (budget <= 0) return map;
    const totalSpend = spendData?.summary.spendCents ?? 0;
    const now = new Date();
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (const [providerKey, rows] of byProvider) {
      const providerCostCents = rows.reduce((sum, row) => sum + row.costCents, 0);
      const providerShare = totalSpend > 0 ? providerCostCents / totalSpend : 0;
      const providerBudget = budget * providerShare;
      if (providerBudget <= 0) {
        map.set(providerKey, false);
        continue;
      }
      const burnRate = providerCostCents / Math.max(daysElapsed, 1);
      map.set(providerKey, providerCostCents + burnRate * (daysInMonth - daysElapsed) > providerBudget);
    }
    return map;
  }, [preset, spendData, byProvider]);

  const providers = useMemo(() => Array.from(byProvider.keys()), [byProvider]);
  const billers = useMemo(() => Array.from(byBiller.keys()), [byBiller]);

  const effectiveProvider =
    activeProvider === "all" || providers.includes(activeProvider) ? activeProvider : "all";
  useEffect(() => {
    if (effectiveProvider !== activeProvider) setActiveProvider("all");
  }, [effectiveProvider, activeProvider]);

  const effectiveBiller =
    activeBiller === "all" || billers.includes(activeBiller) ? activeBiller : "all";
  useEffect(() => {
    if (effectiveBiller !== activeBiller) setActiveBiller("all");
  }, [effectiveBiller, activeBiller]);

  const providerTabItems = useMemo(() => {
    const providerKeys = Array.from(byProvider.keys());
    const allTokens = providerKeys.reduce(
      (sum, provider) => sum + (byProvider.get(provider)?.reduce((acc, row) => acc + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0) ?? 0),
      0,
    );
    const allCents = providerKeys.reduce(
      (sum, provider) => sum + (byProvider.get(provider)?.reduce((acc, row) => acc + row.costCents, 0) ?? 0),
      0,
    );
    return [
      {
        value: "all",
        label: (
          <span className="flex items-center gap-1.5">
            <span>All providers</span>
            {providerKeys.length > 0 ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{formatTokens(allTokens)}</span>
                <span className="text-xs text-muted-foreground">{formatCents(allCents)}</span>
              </>
            ) : null}
          </span>
        ),
      },
      ...providerKeys.map((provider) => ({
        value: provider,
        label: <ProviderTabLabel provider={provider} rows={byProvider.get(provider) ?? []} />,
      })),
    ];
  }, [byProvider]);

  const billerTabItems = useMemo(() => {
    const billerKeys = Array.from(byBiller.keys());
    const allTokens = billerKeys.reduce(
      (sum, biller) => sum + (byBiller.get(biller)?.reduce((acc, row) => acc + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0) ?? 0),
      0,
    );
    const allCents = billerKeys.reduce(
      (sum, biller) => sum + (byBiller.get(biller)?.reduce((acc, row) => acc + row.costCents, 0) ?? 0),
      0,
    );
    return [
      {
        value: "all",
        label: (
          <span className="flex items-center gap-1.5">
            <span>All billers</span>
            {billerKeys.length > 0 ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{formatTokens(allTokens)}</span>
                <span className="text-xs text-muted-foreground">{formatCents(allCents)}</span>
              </>
            ) : null}
          </span>
        ),
      },
      ...billerKeys.map((biller) => ({
        value: biller,
        label: <BillerTabLabel biller={biller} rows={byBiller.get(biller) ?? []} />,
      })),
    ];
  }, [byBiller]);

  const inferenceTokenTotal =
    (spendData?.byAgent ?? []).reduce(
      (sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens,
      0,
    );

  // True if the data loaded successfully but contains zero cost events
  // across every dimension. We use this to surface a diagnostic banner
  // instead of leaving the page as a wall of misleading "$0.00 / 0 tokens"
  // tiles when the runtime simply isn't reporting usage. (Common cause:
  // OpenClaw gateway bridge not forwarding `usage` / `cost_usd` from the
  // CLI back to Paperclip's cost-event recorder.)
  const hasNoCostEvents =
    !spendLoading &&
    !spendError &&
    spendData != null &&
    spendData.summary.spendCents === 0 &&
    inferenceTokenTotal === 0 &&
    (spendData.byAgent?.length ?? 0) === 0;

  useMonoFont();

  // Daily spend series for the spend-over-time chart + sparklines, derived
  // from the Cost Watcher timeline (sum across agent series per day).
  const dailyTotals = useMemo(() => {
    const w = watcherData as CostWatcherPayload | undefined;
    const days = w?.timeline.days ?? [];
    const totals = days.map((_, i) =>
      (w?.timeline.byAgent ?? []).reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
    );
    return { days, totals };
  }, [watcherData]);

  // Spend-by-agent donut slices, derived from real by-agent spend.
  const agentSlices = useMemo(() => {
    const rows = [...((spendData?.byAgent ?? []) as CostByAgent[])].sort((a, b) => b.costCents - a.costCents);
    return rows.slice(0, 7).map((r, i) => ({
      name: r.agentName ?? r.agentId,
      value: r.costCents,
      color: SLICE_HUES[i % SLICE_HUES.length],
    }));
  }, [spendData?.byAgent]);

  // Inference ledger rows — finest real granularity is agent × model.
  const inferenceLedger = useMemo(() => {
    return [...((spendData?.byAgentModel ?? []) as CostByAgentModel[])]
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 7);
  }, [spendData?.byAgentModel]);

  // Budget alerts — merge real Cost Watcher alerts + active budget incidents.
  const watcherAlerts = (watcherData as CostWatcherPayload | undefined)?.alerts ?? [];
  const watcherTotals = (watcherData as CostWatcherPayload | undefined)?.totals;

  function exportInferenceCsv() {
    const rows = (spendData?.byAgentModel ?? []) as CostByAgentModel[];
    const header = ["agent", "provider", "model", "billing_type", "input_tokens", "cached_input_tokens", "output_tokens", "cost_usd"];
    const lines = rows.map((r) =>
      [
        r.agentName ?? r.agentId,
        r.provider,
        r.model,
        r.billingType,
        r.inputTokens,
        r.cachedInputTokens,
        r.outputTokens,
        (r.costCents / 100).toFixed(4),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inference-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const topFinanceEvents = (financeData?.events ?? []) as FinanceEvent[];
  const budgetPolicies = budgetData?.policies ?? [];
  const activeBudgetIncidents = budgetData?.activeIncidents ?? [];
  const budgetPoliciesByScope = useMemo(() => ({
    company: budgetPolicies.filter((policy) => policy.scopeType === "company"),
    agent: budgetPolicies.filter((policy) => policy.scopeType === "agent"),
    project: budgetPolicies.filter((policy) => policy.scopeType === "project"),
  }), [budgetPolicies]);

  if (!selectedCompanyId) {
    return <EmptyState icon={DollarSign} message="Select a company to view costs." />;
  }

  const showCustomPrompt = preset === "custom" && !customReady;
  const showOverviewLoading = (spendLoading || financeLoading) && customReady;
  const overviewError = spendError ?? financeError;

  const budgetCents = spendData?.summary.budgetCents ?? 0;
  const hasBudgetCap = budgetCents > 0;
  const spendCents = spendData?.summary.spendCents ?? 0;
  // Repoint the Inference-spend headline from the cost_events bridge ESTIMATE
  // to the authoritative MLflow total (real per-call billed cost across every
  // metered model, including Gemini + Qwen which bypass the litellm proxy and
  // are logged directly). Fall back to the cost_events figure only if MLflow
  // is unreachable, so the headline degrades gracefully instead of showing $0.
  const mlflowReachable =
    mlflowCostsData?.reachable === true && mlflowCostsData?.experimentPresent === true;
  const inferenceSpendCents = mlflowReachable
    ? Math.round((mlflowCostsData?.totalCostUsd ?? 0) * 100)
    : spendCents;
  const inferenceSpendTokens = mlflowReachable
    ? (mlflowCostsData?.totalTokens ?? 0)
    : inferenceTokenTotal;
  // Budget utilization recomputed against the same MLflow figure so the
  // Budget card agrees with the Inference-spend headline (one source of truth).
  const inferenceUtilPct = hasBudgetCap
    ? Math.min(100, (inferenceSpendCents / budgetCents) * 100)
    : 0;

  return (
    <div className="space-y-6" style={{ color: DS.text }}>
      <MlflowObservabilityCard variant="costs" />
      <div className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <h1 className="text-3xl font-semibold tracking-tight" style={{ color: DS.text }}>Costs</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: DS.textMuted }}>
                  Track and control spend across your AI agent fleet.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex flex-wrap items-center gap-1 rounded-[12px] p-1"
                style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
              >
                {PRESET_KEYS.map((key) => {
                  const active = preset === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setPreset(key)}
                      className="rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors"
                      style={{
                        background: active ? DS.primary : "transparent",
                        color: active ? "#fff" : DS.textMuted,
                      }}
                    >
                      {PRESET_LABELS[key]}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={exportInferenceCsv}
                className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors"
                style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.textMuted }}
                title="Export the inference ledger as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
            </div>
          </div>

          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] p-3" style={{ border: `1px solid ${DS.border}`, background: DS.surface }}>
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-9 rounded-md px-3 text-sm"
                style={{ border: `1px solid ${DS.border2}`, background: DS.surface2, color: DS.text }}
              />
              <span className="text-sm" style={{ color: DS.textMuted }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-9 rounded-md px-3 text-sm"
                style={{ border: `1px solid ${DS.border2}`, background: DS.surface2, color: DS.text }}
              />
            </div>
          ) : null}

          {hasNoCostEvents ? (
            <div className="rounded-md border border-amber-300/70 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="font-medium">No usage events recorded for this period.</p>
              <p className="mt-1 leading-5">
                The numbers below are real zeros, not stale data — but if you've been running agents, the runtime
                may not be forwarding token usage. The OpenClaw gateway bridge (the
                <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 text-[12px] dark:bg-amber-400/15">openclaw</code>
                npm package running on your machine) needs to populate
                <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 text-[12px] dark:bg-amber-400/15">agentMeta.usage</code>
                and
                <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 text-[12px] dark:bg-amber-400/15">cost_usd</code>
                in run-completed messages for cost tracking to work. Local <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 text-[12px] dark:bg-amber-400/15">claude_local</code> /
                <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 text-[12px] dark:bg-amber-400/15">codex_local</code> adapters do this automatically.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Inference spend — with daily sparkline */}
            <div style={surfaceCard} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <SectionLabel>Inference spend</SectionLabel>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: `${DS.primary}1F` }}>
                  <DollarSign className="h-3.5 w-3.5" style={{ color: DS.primary }} />
                </span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                  {formatCents(inferenceSpendCents)}
                </span>
                <div className="opacity-90">
                  <Sparkline values={dailyTotals.totals.length >= 2 ? dailyTotals.totals : [0, 0]} color={DS.primary} />
                </div>
              </div>
              <span className="text-[12px]" style={{ color: DS.textMuted }}>
                {formatTokens(inferenceSpendTokens)} tokens{mlflowReachable ? " \u00b7 MLflow" : ""}
              </span>
            </div>

            {/* Budget — honest: no fake cap when company budget is unset */}
            <div style={surfaceCard} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <SectionLabel>Budget</SectionLabel>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: `${DS.warning}1F` }}>
                  <Coins className="h-3.5 w-3.5" style={{ color: DS.warning }} />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                  {formatCents(inferenceSpendCents)}
                </span>
                {hasBudgetCap ? (
                  <span className="text-[13px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
                    of {formatCents(budgetCents)} / mo
                  </span>
                ) : null}
              </div>
              {hasBudgetCap ? (
                <>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: DS.surface3 }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${inferenceUtilPct}%`,
                        background:
                          inferenceUtilPct > 90
                            ? DS.critical
                            : inferenceUtilPct > 70
                              ? DS.warning
                              : DS.success,
                      }}
                    />
                  </div>
                  <span className="text-[12px]" style={{ color: DS.textMuted }}>
                    {formatCents(Math.max(0, budgetCents - inferenceSpendCents))} remaining
                  </span>
                </>
              ) : (
                <span className="text-[12px]" style={{ color: DS.textMuted }}>
                  No monthly cap configured
                </span>
              )}
            </div>

            {/* Finance net */}
            <div style={surfaceCard} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <SectionLabel>Finance net</SectionLabel>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: `${DS.success}1F` }}>
                  <ReceiptText className="h-3.5 w-3.5" style={{ color: DS.success }} />
                </span>
              </div>
              <span className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                {formatCents(financeData?.summary.netCents ?? 0)}
              </span>
              <span className="text-[12px]" style={{ color: DS.textMuted }}>
                Net after credits &amp; adjustments
              </span>
            </div>

            {/* Finance events */}
            <div style={surfaceCard} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <SectionLabel>Finance events</SectionLabel>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: `${DS.automation}1F` }}>
                  <ArrowUpRight className="h-3.5 w-3.5" style={{ color: DS.automation }} />
                </span>
              </div>
              <span className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                {String(financeData?.summary.eventCount ?? 0)}
              </span>
              <span className="text-[12px]" style={{ color: DS.textMuted }}>
                {(financeData?.summary.eventCount ?? 0) === 0
                  ? "No events this period"
                  : `${formatCents(financeData?.summary.estimatedDebitCents ?? 0)} estimated in range`}
              </span>
            </div>
          </div>
      </div>

      <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as typeof mainTab)}>
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
          <TabsList variant="line" className="justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="budgets">Budgets</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="billers">Billers</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4 space-y-5">
          {showCustomPrompt ? (
            <p className="text-sm" style={{ color: DS.textMuted }}>Select a start and end date to load data.</p>
          ) : showOverviewLoading ? (
            <PageSkeleton variant="costs" />
          ) : overviewError ? (
            <p className="text-sm" style={{ color: DS.critical }}>{(overviewError as Error).message}</p>
          ) : (
            <>
              {/* Row 1: spend-over-time · spend-by-agent · budget status + alerts */}
              <div className="grid gap-5 lg:grid-cols-[1.45fr_0.95fr_1.05fr]">
                {/* Spend over time */}
                <div style={surfaceCard} className="flex flex-col p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" style={{ color: DS.primary }} />
                      <SectionLabel>Spend over time</SectionLabel>
                    </div>
                    <span className="text-[11px]" style={{ color: DS.textFaint }}>
                      Last {dailyTotals.days.length || 30} days · daily inference
                    </span>
                  </div>
                  {dailyTotals.days.length === 0 ? (
                    <div className="flex h-[150px] items-center justify-center text-[13px]" style={{ color: DS.textFaint }}>
                      No daily spend recorded yet.
                    </div>
                  ) : (
                    <DailyBars days={dailyTotals.days} values={dailyTotals.totals} />
                  )}
                </div>

                {/* Spend by agent */}
                <div style={surfaceCard} className="flex flex-col p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionLabel>Spend by agent</SectionLabel>
                  </div>
                  {agentSlices.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: DS.textFaint }}>
                      No agent spend yet.
                    </div>
                  ) : (
                    <>
                      <AgentDonut slices={agentSlices} total={spendCents} />
                      <div className="mt-4 space-y-1.5">
                        {agentSlices.slice(0, 4).map((s) => {
                          const pct = spendCents > 0 ? (s.value / spendCents) * 100 : 0;
                          return (
                            <div key={s.name} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                                <span className="truncate" style={{ color: DS.textMuted }}>{s.name}</span>
                              </span>
                              <span className="flex items-center gap-2 tabular-nums" style={{ fontFamily: MONO }}>
                                <span style={{ color: DS.text }}>{formatCents(s.value)}</span>
                                <span style={{ color: DS.textFaint }}>{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setMainTab("billers")}
                        className="mt-3 self-start text-[12px] font-medium hover:underline"
                        style={{ color: DS.primary }}
                      >
                        View all agents →
                      </button>
                    </>
                  )}
                </div>

                {/* Right column: budget status + budget alerts */}
                <div className="flex flex-col gap-5">
                  {/* Budget status / burn rate */}
                  <div style={surfaceCard} className="flex flex-col gap-3 p-5">
                    <div className="flex items-center justify-between">
                      <SectionLabel>Budget status</SectionLabel>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={
                          hasBudgetCap
                            ? { background: `${DS.success}1F`, color: DS.success }
                            : { background: `${DS.textFaint}22`, color: DS.textMuted }
                        }
                      >
                        {hasBudgetCap ? "Capped" : "Open · no cap"}
                      </span>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <div className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                          {watcherTotals ? usd(watcherTotals.monthToDateUsd) : formatCents(spendCents)}
                        </div>
                        <div className="mt-1 text-[12px]" style={{ color: DS.textMuted }}>
                          this month
                          {watcherTotals && watcherTotals.burnRatePerDayUsd > 0
                            ? ` · ${usd(watcherTotals.burnRatePerDayUsd)}/day burn`
                            : ""}
                        </div>
                      </div>
                      <div className="opacity-90">
                        <Sparkline values={dailyTotals.totals.length >= 2 ? dailyTotals.totals : [0, 0]} color={DS.success} />
                      </div>
                    </div>
                    <div className="text-[12px]" style={{ color: DS.textFaint }}>
                      {hasBudgetCap
                        ? `${spendData?.summary.utilizationPercent ?? 0}% of monthly cap used`
                        : watcherTotals && watcherTotals.projectedMonthlyUsd > 0
                          ? `Projected ${usd(watcherTotals.projectedMonthlyUsd)}/mo · set a cap to track utilization`
                          : "Set a monthly cap to track utilization and arm alerts"}
                    </div>
                  </div>

                  {/* Budget alerts (Cost Watcher folded in) */}
                  <div style={surfaceCard} className="flex flex-1 flex-col p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BellRing className="h-4 w-4" style={{ color: DS.warning }} />
                        <SectionLabel>Budget alerts</SectionLabel>
                      </div>
                      <button
                        onClick={() => setMainTab("budgets")}
                        className="text-[12px] font-medium hover:underline"
                        style={{ color: DS.primary }}
                      >
                        View all
                      </button>
                    </div>
                    {activeBudgetIncidents.length === 0 && watcherAlerts.length === 0 ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-4 text-center">
                        <span className="text-[13px] font-medium" style={{ color: DS.textMuted }}>
                          No active alerts
                        </span>
                        <span className="text-[12px]" style={{ color: DS.textFaint }}>
                          Spend is within limits. Set a monthly cap to enable threshold &amp; auto-pause alerts.
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {activeBudgetIncidents.slice(0, 2).map((incident) => (
                          <div key={incident.id} className="flex items-start gap-2.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: DS.critical }} />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium" style={{ color: DS.text }}>
                                Budget incident — {incident.scopeType} paused
                              </div>
                              <div className="truncate text-[12px]" style={{ color: DS.textMuted }}>
                                {incident.scopeName ?? incident.scopeId} exceeded its budget and was auto-paused.
                              </div>
                            </div>
                          </div>
                        ))}
                        {watcherAlerts.slice(0, 4).map((alert) => (
                          <div key={alert.id} className="flex items-start gap-2.5">
                            <AlertTriangle
                              className="mt-0.5 h-3.5 w-3.5 shrink-0"
                              style={{ color: alert.severity === "error" ? DS.critical : DS.warning }}
                            />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium" style={{ color: DS.text }}>
                                {alert.title}
                              </div>
                              <div className="truncate text-[12px]" style={{ color: DS.textMuted }}>
                                {alert.body}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: inference ledger + finance ledger tables */}
              <div className="grid gap-5 lg:grid-cols-2">
                {/* Inference ledger */}
                <div style={surfaceCard} className="flex flex-col p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionLabel>Inference ledger (request-scoped)</SectionLabel>
                    <span className="text-[11px] tabular-nums" style={{ color: DS.textFaint, fontFamily: MONO }}>
                      {formatCents(spendCents)}
                    </span>
                  </div>
                  {inferenceLedger.length === 0 ? (
                    <p className="py-6 text-center text-[13px]" style={{ color: DS.textFaint }}>No inference spend in this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
                            <th className="pb-2 pr-3 font-medium">Agent</th>
                            <th className="pb-2 pr-3 font-medium">Provider</th>
                            <th className="pb-2 pr-3 font-medium">Model</th>
                            <th className="pb-2 pr-3 text-right font-medium">Tokens</th>
                            <th className="pb-2 text-right font-medium">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inferenceLedger.map((r, i) => (
                            <tr key={`${r.agentId}:${r.provider}:${r.model}:${i}`} style={{ borderTop: `1px solid ${DS.border}` }}>
                              <td className="py-2 pr-3 text-[13px]" style={{ color: DS.text }}>
                                <span className="block max-w-[110px] truncate">{r.agentName ?? r.agentId}</span>
                              </td>
                              <td className="py-2 pr-3 text-[12px]" style={{ color: DS.textFaint }}>
                                <span className="block max-w-[90px] truncate">{providerDisplayName(r.provider)}</span>
                              </td>
                              <td className="py-2 pr-3 text-[12px]" style={{ color: DS.textMuted, fontFamily: MONO }}>
                                <span className="block max-w-[130px] truncate">{r.model}</span>
                              </td>
                              <td className="py-2 pr-3 text-right text-[12px] tabular-nums" style={{ color: DS.textMuted, fontFamily: MONO }}>
                                {formatTokens(r.inputTokens + r.cachedInputTokens + r.outputTokens)}
                              </td>
                              <td className="py-2 text-right text-[13px] tabular-nums" style={{ color: DS.text, fontFamily: MONO }}>
                                {formatCents(r.costCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <button
                    onClick={() => setMainTab("providers")}
                    className="mt-3 self-start text-[12px] font-medium hover:underline"
                    style={{ color: DS.primary }}
                  >
                    View full inference ledger →
                  </button>
                </div>

                {/* Finance ledger */}
                <div style={surfaceCard} className="flex flex-col p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionLabel>Finance ledger (account-level)</SectionLabel>
                    <span className="text-[11px] tabular-nums" style={{ color: DS.textFaint, fontFamily: MONO }}>
                      {formatCents(financeData?.summary.netCents ?? 0)}
                    </span>
                  </div>
                  {topFinanceEvents.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
                      <span className="text-[13px]" style={{ color: DS.textMuted }}>No finance events this period.</span>
                      <span className="text-[12px]" style={{ color: DS.textFaint }}>
                        Account-level charges appear here once biller invoices or credits land.
                      </span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
                            <th className="pb-2 pr-3 font-medium">Date</th>
                            <th className="pb-2 pr-3 font-medium">Biller</th>
                            <th className="pb-2 pr-3 font-medium">Description</th>
                            <th className="pb-2 pr-3 text-right font-medium">Charge</th>
                            <th className="pb-2 text-right font-medium">Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topFinanceEvents.slice(0, 7).map((e) => {
                            const isCredit = e.direction === "credit";
                            const amt = e.amountCents;
                            return (
                              <tr key={e.id} style={{ borderTop: `1px solid ${DS.border}` }}>
                                <td className="py-2 pr-3 text-[12px] tabular-nums" style={{ color: DS.textMuted, fontFamily: MONO }}>
                                  {new Date(e.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </td>
                                <td className="py-2 pr-3 text-[13px]" style={{ color: DS.text }}>
                                  <span className="block max-w-[110px] truncate">{providerDisplayName(e.biller)}</span>
                                </td>
                                <td className="py-2 pr-3 text-[12px]" style={{ color: DS.textFaint }}>
                                  <span className="block max-w-[120px] truncate">{e.description ?? e.eventKind}</span>
                                </td>
                                <td className="py-2 pr-3 text-right text-[12px] tabular-nums" style={{ color: DS.textMuted, fontFamily: MONO }}>
                                  {isCredit ? "—" : formatCents(amt)}
                                </td>
                                <td
                                  className="py-2 text-right text-[13px] tabular-nums"
                                  style={{ color: isCredit ? DS.success : DS.text, fontFamily: MONO }}
                                >
                                  {isCredit ? `-${formatCents(amt)}` : formatCents(amt)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <button
                    onClick={() => setMainTab("finance")}
                    className="mt-3 self-start text-[12px] font-medium hover:underline"
                    style={{ color: DS.primary }}
                  >
                    View full finance ledger →
                  </button>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="budgets" className="mt-4 space-y-4">
          {budgetLoading ? (
            <PageSkeleton variant="costs" />
          ) : budgetError ? (
            <p className="text-sm text-destructive">{(budgetError as Error).message}</p>
          ) : (
            <>
              <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle className="text-base">Budget control plane</CardTitle>
                  <CardDescription>
                    Hard-stop spend limits for agents and projects. Provider subscription quota stays separate and appears under Providers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 px-5 pb-5 pt-0 md:grid-cols-4">
                  <MetricTile
                    label="Active incidents"
                    value={String(activeBudgetIncidents.length)}
                    subtitle="Open soft or hard threshold crossings"
                    icon={ReceiptText}
                  />
                  <MetricTile
                    label="Pending approvals"
                    value={String(budgetData?.pendingApprovalCount ?? 0)}
                    subtitle="Budget override approvals awaiting board action"
                    icon={ArrowUpRight}
                  />
                  <MetricTile
                    label="Paused agents"
                    value={String(budgetData?.pausedAgentCount ?? 0)}
                    subtitle="Agent heartbeats blocked by budget"
                    icon={Coins}
                  />
                  <MetricTile
                    label="Paused projects"
                    value={String(budgetData?.pausedProjectCount ?? 0)}
                    subtitle="Project execution blocked by budget"
                    icon={DollarSign}
                  />
                </CardContent>
              </Card>

              {activeBudgetIncidents.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold">Active incidents</h2>
                    <p className="text-sm text-muted-foreground">
                      Resolve hard stops here by raising the budget or explicitly keeping the scope paused.
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {activeBudgetIncidents.map((incident) => (
                      <BudgetIncidentCard
                        key={incident.id}
                        incident={incident}
                        isMutating={incidentMutation.isPending}
                        onKeepPaused={() => incidentMutation.mutate({ incidentId: incident.id, action: "keep_paused" })}
                        onRaiseAndResume={(amount) =>
                          incidentMutation.mutate({
                            incidentId: incident.id,
                            action: "raise_budget_and_resume",
                            amount,
                          })}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-5">
                {(["company", "agent", "project"] as const).map((scopeType) => {
                  const rows = budgetPoliciesByScope[scopeType];
                  if (rows.length === 0) return null;
                  return (
                    <section key={scopeType} className="space-y-3">
                      <div>
                        <h2 className="text-lg font-semibold capitalize">{scopeType} budgets</h2>
                        <p className="text-sm text-muted-foreground">
                          {scopeType === "company"
                            ? "Company-wide monthly policy."
                            : scopeType === "agent"
                              ? "Recurring monthly spend policies for individual agents."
                              : "Lifetime spend policies for execution-bound projects."}
                        </p>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        {rows.map((summary) => (
                          <BudgetPolicyCard
                            key={summary.policyId}
                            summary={summary}
                            isSaving={policyMutation.isPending}
                            onSave={(amount) =>
                              policyMutation.mutate({
                                scopeType: summary.scopeType,
                                scopeId: summary.scopeId,
                                amount,
                                windowKind: summary.windowKind,
                              })}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}

                {budgetPolicies.length === 0 ? (
                  <Card>
                    <CardContent className="px-5 py-8 text-sm text-muted-foreground">
                      No budget policies yet. Set agent and project budgets from their detail pages, or use the existing company monthly budget control.
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-4 space-y-4">
          {/* Provider-credits dashboard — current balance + 30-day spend per
              provider (DeepSeek/Moonshot/OpenAI/Anthropic/Gemini + fallback).
              Reads from /api/companies/:id/provider-credits. Server-side
              adapters are stubs until Tyler ships per-provider API keys. */}
          <ProviderCreditsSection companyId={selectedCompanyId} />

          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : (
            <>
              <Tabs value={effectiveProvider} onValueChange={setActiveProvider}>
                <PageTabBar items={providerTabItems} value={effectiveProvider} />

                <TabsContent value="all" className="mt-4">
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cost events in this period.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {providers.map((provider) => (
                        <ProviderQuotaCard
                          key={provider}
                          provider={provider}
                          rows={byProvider.get(provider) ?? []}
                          budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                          totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                          weekSpendCents={weekSpendByProvider.get(provider) ?? 0}
                          windowRows={windowSpendByProvider.get(provider) ?? []}
                          showDeficitNotch={deficitNotchByProvider.get(provider) ?? false}
                          quotaWindows={quotaWindowsByProvider.get(provider) ?? []}
                          quotaError={quotaErrorsByProvider.get(provider) ?? null}
                          quotaSource={quotaSourcesByProvider.get(provider) ?? null}
                          quotaLoading={quotaLoading}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>

                {providers.map((provider) => (
                  <TabsContent key={provider} value={provider} className="mt-4">
                    <ProviderQuotaCard
                      provider={provider}
                      rows={byProvider.get(provider) ?? []}
                      budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                      totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                      weekSpendCents={weekSpendByProvider.get(provider) ?? 0}
                      windowRows={windowSpendByProvider.get(provider) ?? []}
                      showDeficitNotch={deficitNotchByProvider.get(provider) ?? false}
                      quotaWindows={quotaWindowsByProvider.get(provider) ?? []}
                      quotaError={quotaErrorsByProvider.get(provider) ?? null}
                      quotaSource={quotaSourcesByProvider.get(provider) ?? null}
                      quotaLoading={quotaLoading}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </TabsContent>

        <TabsContent value="billers" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : (
            <>
              <Tabs value={effectiveBiller} onValueChange={setActiveBiller}>
                <PageTabBar items={billerTabItems} value={effectiveBiller} />

                <TabsContent value="all" className="mt-4">
                  {billers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No billable events in this period.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {billers.map((biller) => {
                        const row = (byBiller.get(biller) ?? [])[0];
                        if (!row) return null;
                        const providerRows = (providerData ?? []).filter((entry) => entry.biller === biller);
                        return (
                          <BillerSpendCard
                            key={biller}
                            row={row}
                            weekSpendCents={weekSpendByBiller.get(biller) ?? 0}
                            budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                            totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                            providerRows={providerRows}
                          />
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {billers.map((biller) => {
                  const row = (byBiller.get(biller) ?? [])[0];
                  if (!row) return null;
                  const providerRows = (providerData ?? []).filter((entry) => entry.biller === biller);
                  return (
                    <TabsContent key={biller} value={biller} className="mt-4">
                      <BillerSpendCard
                        row={row}
                        weekSpendCents={weekSpendByBiller.get(biller) ?? 0}
                        budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                        totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                        providerRows={providerRows}
                      />
                    </TabsContent>
                  );
                })}
              </Tabs>
            </>
          )}
        </TabsContent>

        <TabsContent value="finance" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : financeLoading ? (
            <PageSkeleton variant="costs" />
          ) : financeError ? (
            <p className="text-sm text-destructive">{(financeError as Error).message}</p>
          ) : (
            <>
              <FinanceSummaryCard
                debitCents={financeData?.summary.debitCents ?? 0}
                creditCents={financeData?.summary.creditCents ?? 0}
                netCents={financeData?.summary.netCents ?? 0}
                estimatedDebitCents={financeData?.summary.estimatedDebitCents ?? 0}
                eventCount={financeData?.summary.eventCount ?? 0}
              />

              <div className="grid gap-4 xl:grid-cols-[1.2fr,0.95fr]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="px-5 pt-5 pb-2">
                      <CardTitle className="text-base">By biller</CardTitle>
                      <CardDescription>Account-level financial events grouped by who charged or credited them.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 px-5 pb-5 pt-2 md:grid-cols-2">
                      {(financeData?.byBiller.length ?? 0) === 0 ? (
                        <p className="text-sm text-muted-foreground">No finance events yet.</p>
                      ) : (
                        financeData?.byBiller.map((row) => <FinanceBillerCard key={row.biller} row={row} />)
                      )}
                    </CardContent>
                  </Card>
                  <FinanceTimelineCard rows={topFinanceEvents} />
                </div>

                <FinanceKindCard rows={financeData?.byKind ?? []} />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

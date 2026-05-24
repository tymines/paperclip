/**
 * Cost Watcher — merges three data sources into one dashboard payload:
 *
 *   1. `cost_events` from the bridge (heartbeat usage_json → cost_usd, populated
 *      by openclaw-gateway and other local adapters)
 *   2. Provider-credit cards from services/provider-credits (DeepSeek, Moonshot,
 *      OpenAI, Anthropic, Gemini balances + spend reports)
 *   3. `agents` table for the per-agent leaderboard rollup
 *
 * One round-trip, one cached payload. The page is read-only — no mutations live
 * here. The 30s in-memory cache exists to keep multiple panel reloads from
 * hammering provider APIs; a hot reload only refetches once per 30s.
 *
 * USD is the canonical currency in this payload. Provider-native balances
 * (Moonshot's CNY, etc.) ride through unchanged on the per-provider cards —
 * the totals row only sums providers that already report USD-equivalent.
 */
import { and, desc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, costEvents } from "@paperclipai/db";
import type {
  CostWatcherAgentRow,
  CostWatcherAlert,
  CostWatcherPayload,
  CostWatcherProviderCard,
  CostWatcherTimelineSeries,
  CostWatcherTotals,
} from "@paperclipai/shared";
import { fetchProviderCreditCards } from "./provider-credits/index.js";

const CACHE_TTL_MS = 30_000;
const TIMELINE_DAYS = 30;
const LEADERBOARD_LIMIT = 25;
const RUNWAY_ALERT_DAYS = 7;
const PER_AGENT_DAILY_CEILING_USD = 5;

interface CacheEntry {
  builtAt: number;
  payload: CostWatcherPayload;
}

const cache = new Map<string, CacheEntry>();

/**
 * Stable color palette for agents (the providers bring their own brand colors
 * — agents don't). Recharts will round-robin through these.
 */
const AGENT_COLORS = [
  "#22D3EE",
  "#A78BFA",
  "#F472B6",
  "#FB7185",
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#F97316",
];

function isoDay(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDayLabels(end: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i));
    out.push(isoDay(d));
  }
  return out;
}

function currentUtcMonthWindow(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
}

function trailingDaysWindow(days: number, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - days));
  return { start, end };
}

async function sumCostUsd(db: Db, companyId: string, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({
      totalCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.companyId, companyId),
        gte(costEvents.occurredAt, start),
        lt(costEvents.occurredAt, end),
      ),
    );
  return Number(row?.totalCents ?? 0) / 100;
}

interface DailyProviderRow {
  day: string;
  provider: string;
  costCents: number;
}

async function dailyByProvider(db: Db, companyId: string, start: Date, end: Date): Promise<DailyProviderRow[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${costEvents.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      provider: costEvents.provider,
      costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.companyId, companyId),
        gte(costEvents.occurredAt, start),
        lt(costEvents.occurredAt, end),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${costEvents.occurredAt} at time zone 'UTC')`,
      costEvents.provider,
    );
  return rows.map((row) => ({
    day: row.day,
    provider: row.provider,
    costCents: Number(row.costCents),
  }));
}

interface DailyAgentRow {
  day: string;
  agentId: string;
  costCents: number;
}

async function dailyByAgent(db: Db, companyId: string, start: Date, end: Date): Promise<DailyAgentRow[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${costEvents.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      agentId: costEvents.agentId,
      costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.companyId, companyId),
        gte(costEvents.occurredAt, start),
        lt(costEvents.occurredAt, end),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${costEvents.occurredAt} at time zone 'UTC')`,
      costEvents.agentId,
    );
  return rows.map((row) => ({
    day: row.day,
    agentId: row.agentId,
    costCents: Number(row.costCents),
  }));
}

async function agentLeaderboard(
  db: Db,
  companyId: string,
  start: Date,
  end: Date,
): Promise<CostWatcherAgentRow[]> {
  const rows = await db
    .select({
      agentId: costEvents.agentId,
      agentName: agents.name,
      agentStatus: agents.status,
      adapterType: agents.adapterType,
      runs: sql<number>`count(distinct ${costEvents.heartbeatRunId})::int`,
      inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
      cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
      costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    })
    .from(costEvents)
    .leftJoin(agents, eq(costEvents.agentId, agents.id))
    .where(
      and(
        eq(costEvents.companyId, companyId),
        gte(costEvents.occurredAt, start),
        lt(costEvents.occurredAt, end),
        isNotNull(costEvents.heartbeatRunId),
      ),
    )
    .groupBy(costEvents.agentId, agents.name, agents.status, agents.adapterType)
    .orderBy(desc(sql<number>`coalesce(sum(${costEvents.costCents}), 0)`))
    .limit(LEADERBOARD_LIMIT);

  return rows.map((row) => {
    const spendUsd = Number(row.costCents) / 100;
    const runs = Number(row.runs);
    return {
      agentId: row.agentId,
      agentName: row.agentName ?? "(deleted agent)",
      agentStatus: row.agentStatus ?? "unknown",
      adapterType: row.adapterType ?? "unknown",
      runs,
      inputTokens: Number(row.inputTokens),
      cachedInputTokens: Number(row.cachedInputTokens),
      outputTokens: Number(row.outputTokens),
      spendUsd,
      avgSpendPerRunUsd: runs > 0 ? spendUsd / runs : 0,
    };
  });
}

async function maxAgentDailySpendUsd(
  db: Db,
  companyId: string,
  start: Date,
  end: Date,
): Promise<{ agentId: string; agentName: string | null; costUsd: number } | null> {
  const rows = await db
    .select({
      agentId: costEvents.agentId,
      agentName: agents.name,
      costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    })
    .from(costEvents)
    .leftJoin(agents, eq(costEvents.agentId, agents.id))
    .where(
      and(
        eq(costEvents.companyId, companyId),
        gte(costEvents.occurredAt, start),
        lt(costEvents.occurredAt, end),
      ),
    )
    .groupBy(costEvents.agentId, agents.name)
    .orderBy(desc(sql<number>`coalesce(sum(${costEvents.costCents}), 0)`))
    .limit(1);
  const top = rows[0];
  if (!top) return null;
  return {
    agentId: top.agentId,
    agentName: top.agentName,
    costUsd: Number(top.costCents) / 100,
  };
}

function buildProviderTimeline(
  days: string[],
  dailyRows: DailyProviderRow[],
  providerCards: CostWatcherProviderCard[],
): CostWatcherTimelineSeries[] {
  // Per-provider USD spend pulled from cost_events. We also fold in
  // the provider-API daily series for providers that report it, because
  // the bridge sees only what flows through us — Tyler may also burn
  // credits via direct dashboard / SDK use that bypasses Paperclip.
  const dayIndex = new Map(days.map((day, idx) => [day, idx]));
  const byProviderKey = new Map<string, number[]>();

  for (const row of dailyRows) {
    const idx = dayIndex.get(row.day);
    if (idx == null) continue;
    const arr = byProviderKey.get(row.provider) ?? new Array(days.length).fill(0);
    arr[idx] = (arr[idx] ?? 0) + row.costCents / 100;
    byProviderKey.set(row.provider, arr);
  }

  // Layer in provider-API daily series — only when not already present in
  // cost_events for that day, to avoid double-counting bridge-attributed runs.
  for (const card of providerCards) {
    if (card.dailySeries.length === 0) continue;
    const arr = byProviderKey.get(card.provider) ?? new Array(days.length).fill(0);
    for (const point of card.dailySeries) {
      const idx = dayIndex.get(point.date);
      if (idx == null) continue;
      // Use the larger of (bridge-recorded, provider-API-reported) so the chart
      // never *undercounts* and we surface either source's signal. Currency
      // mismatch is acknowledged but not corrected here — DeepSeek's CNY → USD
      // would need an FX hop the v1 doesn't ship with.
      if (arr[idx] < point.amount) arr[idx] = point.amount;
    }
    byProviderKey.set(card.provider, arr);
  }

  const cardByKey = new Map(providerCards.map((c) => [c.provider, c]));
  const series: CostWatcherTimelineSeries[] = [];
  for (const [providerKey, values] of byProviderKey) {
    const card = cardByKey.get(providerKey);
    series.push({
      key: providerKey,
      name: card?.name ?? providerKey,
      color: card?.brandColor ?? "#94A3B8",
      values,
    });
  }
  // Stable ordering — highest total spend first so the stack reads top-down.
  series.sort((a, b) => sum(b.values) - sum(a.values));
  return series;
}

function buildAgentTimeline(
  days: string[],
  dailyRows: DailyAgentRow[],
  leaderboard: CostWatcherAgentRow[],
): CostWatcherTimelineSeries[] {
  const dayIndex = new Map(days.map((day, idx) => [day, idx]));
  const topAgentIds = new Set(leaderboard.slice(0, AGENT_COLORS.length).map((row) => row.agentId));
  const nameByAgent = new Map(leaderboard.map((row) => [row.agentId, row.agentName]));

  const byAgentId = new Map<string, number[]>();
  const otherValues = new Array(days.length).fill(0);
  let otherUsed = false;

  for (const row of dailyRows) {
    const idx = dayIndex.get(row.day);
    if (idx == null) continue;
    const usd = row.costCents / 100;
    if (topAgentIds.has(row.agentId)) {
      const arr = byAgentId.get(row.agentId) ?? new Array(days.length).fill(0);
      arr[idx] = (arr[idx] ?? 0) + usd;
      byAgentId.set(row.agentId, arr);
    } else {
      otherValues[idx] = (otherValues[idx] ?? 0) + usd;
      otherUsed = true;
    }
  }

  const series: CostWatcherTimelineSeries[] = [];
  let colorIdx = 0;
  for (const agentId of topAgentIds) {
    const values = byAgentId.get(agentId);
    if (!values) continue;
    series.push({
      key: agentId,
      name: nameByAgent.get(agentId) ?? agentId,
      color: AGENT_COLORS[colorIdx % AGENT_COLORS.length],
      values,
    });
    colorIdx += 1;
  }
  if (otherUsed) {
    series.push({
      key: "__other__",
      name: "Other agents",
      color: "#64748B",
      values: otherValues,
    });
  }
  series.sort((a, b) => sum(b.values) - sum(a.values));
  return series;
}

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function buildTotals(
  monthSpendUsd: number,
  last7DaysSpendUsd: number,
  providerCards: CostWatcherProviderCard[],
  now = new Date(),
): CostWatcherTotals {
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = Math.max(1, now.getUTCDate());
  // Burn rate uses the 7-day average (smoother than month-to-date which
  // gets noisy on day 1-2 of a new month) but falls back to MTD if no
  // 7-day data exists yet.
  const burnRatePerDayUsd =
    last7DaysSpendUsd > 0 ? last7DaysSpendUsd / 7 : monthSpendUsd / daysElapsed;
  const projectedMonthlyUsd = burnRatePerDayUsd * daysInMonth;

  // Only sum balances from providers that (a) expose a number, (b) quote it
  // in USD, and (c) didn't error on the last fetch. CNY-denominated cards
  // ride through on the per-provider strip but don't count toward the
  // runway estimate, since runway burns USD.
  let creditsRemainingUsd = 0;
  let creditsRemainingProviderCount = 0;
  for (const card of providerCards) {
    if (card.balance == null) continue;
    if (card.errorMessage) continue;
    if (card.currency.toUpperCase() !== "USD") continue;
    creditsRemainingUsd += card.balance;
    creditsRemainingProviderCount += 1;
  }

  const daysOfRunway =
    burnRatePerDayUsd > 0 ? creditsRemainingUsd / burnRatePerDayUsd : null;

  return {
    monthToDateUsd: monthSpendUsd,
    last7DaysUsd: last7DaysSpendUsd,
    burnRatePerDayUsd,
    projectedMonthlyUsd,
    creditsRemainingUsd,
    creditsRemainingProviderCount,
    daysOfRunway,
  };
}

function buildAlerts(
  totals: CostWatcherTotals,
  providerCards: CostWatcherProviderCard[],
  topAgentLast24h: { agentId: string; agentName: string | null; costUsd: number } | null,
): CostWatcherAlert[] {
  const alerts: CostWatcherAlert[] = [];

  // 1) Provider runway alert — flag any provider whose balance covers <7d
  //    at the current burn rate. We compute the provider's share of total
  //    spend over the last 7 days to estimate its specific burn.
  if (totals.last7DaysUsd > 0) {
    for (const card of providerCards) {
      if (card.balance == null) continue;
      if (card.errorMessage) continue;
      if (card.currency.toUpperCase() !== "USD") continue;
      const burnContribution = card.spendThisWeek > 0 ? card.spendThisWeek / 7 : 0;
      if (burnContribution <= 0) continue;
      const runwayDays = card.balance / burnContribution;
      if (runwayDays < RUNWAY_ALERT_DAYS) {
        alerts.push({
          id: `runway:${card.provider}`,
          severity: runwayDays < 2 ? "error" : "warning",
          title: `${card.name} balance covers <${RUNWAY_ALERT_DAYS} days`,
          body: `Balance $${card.balance.toFixed(2)} at current $${burnContribution.toFixed(2)}/day burn = ${runwayDays.toFixed(1)} days runway.`,
          providerKey: card.provider,
        });
      }
    }
  }

  // 2) Agent ceiling alert — TODO knob this in a config table. v1 uses a
  //    hardcoded $5/day ceiling per the spec.
  if (topAgentLast24h && topAgentLast24h.costUsd > PER_AGENT_DAILY_CEILING_USD) {
    alerts.push({
      id: `ceiling:${topAgentLast24h.agentId}`,
      severity: "warning",
      title: `${topAgentLast24h.agentName ?? "Agent"} crossed $${PER_AGENT_DAILY_CEILING_USD}/day`,
      body: `Spent $${topAgentLast24h.costUsd.toFixed(2)} in the last 24 hours, above the $${PER_AGENT_DAILY_CEILING_USD} ceiling.`,
      agentId: topAgentLast24h.agentId,
    });
  }

  // 3) Provider error alert — any provider whose balance fetch failed.
  for (const card of providerCards) {
    if (!card.errorMessage) continue;
    alerts.push({
      id: `error:${card.provider}`,
      severity: "error",
      title: `${card.name} balance fetch failed`,
      body: card.errorMessage,
      providerKey: card.provider,
    });
  }

  return alerts;
}

/**
 * Build the full Cost Watcher payload from scratch. Callers should use
 * `getCostWatcherPayload` so the 30s cache deduplicates concurrent loads.
 */
export async function buildCostWatcherPayload(db: Db, companyId: string): Promise<CostWatcherPayload> {
  const now = new Date();
  const days = buildDayLabels(now, TIMELINE_DAYS);
  const timelineStart = new Date(`${days[0]}T00:00:00.000Z`);
  const timelineEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const monthWindow = currentUtcMonthWindow(now);
  const week = trailingDaysWindow(7, now);
  const last24h = trailingDaysWindow(1, now);

  const [
    rawProviders,
    monthSpendUsd,
    last7DaysSpendUsd,
    dailyProviderRows,
    dailyAgentRows,
    leaderboard,
    topAgentLast24h,
  ] = await Promise.all([
    fetchProviderCreditCards(),
    sumCostUsd(db, companyId, monthWindow.start, monthWindow.end),
    sumCostUsd(db, companyId, week.start, week.end),
    dailyByProvider(db, companyId, timelineStart, timelineEnd),
    dailyByAgent(db, companyId, timelineStart, timelineEnd),
    agentLeaderboard(db, companyId, timelineStart, timelineEnd),
    maxAgentDailySpendUsd(db, companyId, last24h.start, last24h.end),
  ]);

  // fetchProviderCreditCards returns ProviderCreditCard (provider-credits
  // module type); we just widen with `errorMessage: null` so the page can
  // surface fetch errors uniformly. Real adapter errors would set this.
  const providers: CostWatcherProviderCard[] = rawProviders.map((card) => ({
    provider: card.provider,
    name: card.name,
    currency: card.currency,
    balance: card.balance,
    balanceLastFetchedAt: card.balanceLastFetchedAt,
    spendThisMonth: card.spendThisMonth,
    spendThisWeek: card.spendThisWeek,
    dailySeries: card.dailySeries,
    dashboardUrl: card.dashboardUrl,
    brandColor: card.brandColor,
    hasApiKey: card.hasApiKey,
    isStub: card.isStub,
    errorMessage: null,
  }));

  const totals = buildTotals(monthSpendUsd, last7DaysSpendUsd, providers, now);
  const byProviderTimeline = buildProviderTimeline(days, dailyProviderRows, providers);
  const byAgentTimeline = buildAgentTimeline(days, dailyAgentRows, leaderboard);
  const alerts = buildAlerts(totals, providers, topAgentLast24h);

  return {
    generatedAt: now.toISOString(),
    totals,
    providers,
    timeline: {
      days,
      byProvider: byProviderTimeline,
      byAgent: byAgentTimeline,
    },
    agents: leaderboard,
    alerts,
  };
}

/**
 * Cached entry point used by the route. 30s TTL prevents a hot reload from
 * fanning out to every provider API on every panel mount. Callers expecting
 * to see a balance change immediately should hit `buildCostWatcherPayload`
 * directly (or wait 30 seconds).
 */
export async function getCostWatcherPayload(db: Db, companyId: string): Promise<CostWatcherPayload> {
  const cached = cache.get(companyId);
  const now = Date.now();
  if (cached && now - cached.builtAt < CACHE_TTL_MS) {
    return cached.payload;
  }
  const payload = await buildCostWatcherPayload(db, companyId);
  cache.set(companyId, { builtAt: now, payload });
  return payload;
}

/** Test-only escape hatch — clears the in-memory cache between unit tests. */
export function __resetCostWatcherCache(): void {
  cache.clear();
}

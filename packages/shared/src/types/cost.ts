import type { BillingType } from "../constants.js";

export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  heartbeatRunId: string | null;
  billingCode: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  occurredAt: Date;
  createdAt: Date;
}

export interface CostSummary {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
}

export interface IssueCostSummary {
  issueId: string;
  issueCount: number;
  includeDescendants: boolean;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** number of distinct heartbeat runs aggregated across the issue tree */
  runCount: number;
  /** sum of wall-clock duration of each run in the tree (ms);
   * still-running runs contribute (now - startedAt) so this ticks up live */
  runtimeMs: number;
}

export interface CostByAgent {
  agentId: string;
  agentName: string | null;
  agentStatus: string | null;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByProviderModel {
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByBiller {
  biller: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
  providerCount: number;
  modelCount: number;
}

/** per-agent breakdown by provider + model, for identifying token-hungry agents */
export interface CostByAgentModel {
  agentId: string;
  agentName: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** spend per provider for a fixed rolling time window */
export interface CostWindowSpendRow {
  provider: string;
  biller: string;
  /** duration label, e.g. "5h", "24h", "7d" */
  window: string;
  /** rolling window duration in hours */
  windowHours: number;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** cost attributed to a project via heartbeat run → activity log → issue → project chain */
export interface CostByProject {
  projectId: string | null;
  projectName: string | null;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost Watcher — unified merge of bridge usage, provider-credit balances, and
// per-agent attribution surfaced on a single page. Server returns one payload
// per request; UI consumes it as-is. USD numbers throughout (provider native
// currencies are normalized at the adapter layer or carried alongside).
// ─────────────────────────────────────────────────────────────────────────────

export interface CostWatcherTotals {
  /** Sum of inference cost_events for the current calendar month (USD). */
  monthToDateUsd: number;
  /** Sum of inference cost_events over the trailing 7 days (USD). */
  last7DaysUsd: number;
  /** monthToDateUsd / days-elapsed-in-month — what we'd hit if today repeats. */
  burnRatePerDayUsd: number;
  /** burnRatePerDayUsd * days-in-month, the naive run-rate projection. */
  projectedMonthlyUsd: number;
  /** Sum of provider credit balances (only providers that expose balance). */
  creditsRemainingUsd: number;
  /** How many providers contributed to creditsRemainingUsd. */
  creditsRemainingProviderCount: number;
  /** creditsRemainingUsd / burnRatePerDayUsd, or null if no burn yet. */
  daysOfRunway: number | null;
}

export interface CostWatcherProviderCard {
  provider: string;
  name: string;
  currency: string;
  balance: number | null;
  balanceLastFetchedAt: string | null;
  spendThisMonth: number;
  spendThisWeek: number;
  /** Daily spend in provider-native currency, oldest first. */
  dailySeries: Array<{ date: string; amount: number }>;
  dashboardUrl: string;
  brandColor: string;
  hasApiKey: boolean;
  isStub: boolean;
  /** Set when the most recent fetch failed; surfaced as an alert. */
  errorMessage: string | null;
}

export interface CostWatcherTimelineSeries {
  /** Stable key (provider key or agentId). */
  key: string;
  /** Human label for legend / tooltip. */
  name: string;
  /** Brand or generated color for the area fill. */
  color: string;
  /** values.length === days.length, aligned by index. */
  values: number[];
}

export interface CostWatcherTimeline {
  /** Last 30 day labels, ISO YYYY-MM-DD, oldest → newest. */
  days: string[];
  /** Cost stacked by provider for the same 30-day window. */
  byProvider: CostWatcherTimelineSeries[];
  /** Same data stacked by agent (top N + "Other" rollup). */
  byAgent: CostWatcherTimelineSeries[];
}

export interface CostWatcherAgentRow {
  agentId: string;
  agentName: string;
  agentStatus: string;
  adapterType: string;
  /** Distinct heartbeat_runs that produced cost_events in the window. */
  runs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  spendUsd: number;
  avgSpendPerRunUsd: number;
}

export type CostWatcherAlertSeverity = "warning" | "error";

export interface CostWatcherAlert {
  /** Stable id used for snooze keys; must be deterministic across reloads. */
  id: string;
  severity: CostWatcherAlertSeverity;
  title: string;
  body: string;
  /** Optional cross-link to a provider key the alert is about. */
  providerKey?: string;
  /** Optional cross-link to an agent id the alert is about. */
  agentId?: string;
}

export interface CostWatcherPayload {
  /** ISO timestamp the server built this payload (used as 30s cache key). */
  generatedAt: string;
  totals: CostWatcherTotals;
  providers: CostWatcherProviderCard[];
  timeline: CostWatcherTimeline;
  /** Sorted by spendUsd desc, all agents that produced spend in the window. */
  agents: CostWatcherAgentRow[];
  alerts: CostWatcherAlert[];
}

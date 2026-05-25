export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  failed: number;
  other: number;
  total: number;
  /**
   * Tokens / spend rolled up from cost_events for the same UTC day. Optional
   * so existing fixtures and pre-aggregated data without cost rollup keep
   * compiling — the server's summary() always sets them.
   */
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  /**
   * Tokens rolled up from cost_events for the current calendar month — feeds
   * the dashboard "Tokens" tile so it isn't permanently 0. Optional so old
   * fixtures keep compiling; the server's summary() always sets it.
   */
  tokens?: {
    monthInputTokens: number;
    monthOutputTokens: number;
    monthCachedInputTokens: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  runActivity: DashboardRunActivityDay[];
}

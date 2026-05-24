/**
 * Provider-credits module: aggregate balance + spending across every model
 * provider Tyler uses, including ones outside the OpenClaw bridge (DeepSeek,
 * Moonshot/Kimi, OpenAI, Anthropic, Gemini, …).
 *
 * Each provider file in this directory exports a `ProviderCreditAdapter`
 * with a stable contract. v1 ships stub implementations that return
 * shaped-correctly mock data so the UI is fully usable before Tyler
 * supplies real API keys; real wiring replaces only the per-provider
 * fetchBalance / fetchSpending without UI changes.
 */

export type ProviderKey =
  | "deepseek"
  | "moonshot"
  | "openai"
  | "anthropic"
  | "gemini"
  | "unknown";

export interface ProviderMeta {
  /** Internal stable id (matches file name). */
  key: ProviderKey;
  /** Display name shown on the Provider card. */
  name: string;
  /** Default ISO currency for the balance. Most are USD. */
  currency: string;
  /** Whether the provider exposes a balance endpoint at all. */
  balanceSupported: boolean;
  /** Whether the provider exposes a spending-history endpoint. */
  spendingSupported: boolean;
  /** Tyler clicks here to top up credits — opens in a new tab. */
  dashboardUrl: string;
  /** Brand color (hex) used on the card stripe + logo background. */
  brandColor: string;
}

export interface ProviderBalanceSnapshot {
  /** Current credit balance in the provider's default currency. */
  balance: number;
  currency: string;
  /** When the upstream API returned this number. */
  fetchedAt: Date;
  /** Optional: free / paid breakdown when available. */
  breakdown?: {
    /** Granted credits still on the account. */
    granted?: number;
    /** Pre-paid balance the user added. */
    prepaid?: number;
    /** Sub-zero balance (post-paid invoices in flight). */
    pending?: number;
  };
}

export interface ProviderSpendingPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Spend for that day in the provider's default currency. */
  amount: number;
}

export interface ProviderSpendingReport {
  /** Most-recent days first, padded with zeros for days with no spend. */
  daily: ProviderSpendingPoint[];
  totalMonthToDate: number;
  totalWeekToDate: number;
  currency: string;
  fetchedAt: Date;
}

export interface ProviderCreditAdapter {
  readonly meta: ProviderMeta;

  /**
   * Fetch the current balance. Implementations call the provider's
   * billing/usage endpoint; v1 stubs return obvious-but-shaped fake
   * numbers so the UI looks alive.
   */
  fetchBalance(opts: { apiKey: string | null }): Promise<ProviderBalanceSnapshot>;

  /**
   * Fetch daily spending over the given window. v1 stubs synthesize a
   * deterministic daily series; real impls hit the provider's spending
   * API (different endpoint per provider).
   */
  fetchSpending(opts: {
    apiKey: string | null;
    from: Date;
    to: Date;
  }): Promise<ProviderSpendingReport>;
}

/** Combined shape returned by GET /api/companies/:id/provider-credits. */
export interface ProviderCreditCard {
  provider: ProviderKey;
  name: string;
  currency: string;
  balance: number | null;
  balanceLastFetchedAt: string | null;
  spendThisMonth: number;
  spendThisWeek: number;
  dailySeries: ProviderSpendingPoint[];
  dashboardUrl: string;
  brandColor: string;
  hasApiKey: boolean;
  /** True when the data is from the stub adapter — Tyler sees a "Stub" chip. */
  isStub: boolean;
}

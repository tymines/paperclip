/**
 * DeepSeek provider adapter — STUB.
 *
 * Real impl: GET https://api.deepseek.com/user/balance with header
 *   Authorization: Bearer <api-key>
 * Returns:
 *   { is_available: bool, balance_infos: [{ currency, total_balance,
 *     granted_balance, topped_up_balance }] }
 * Pick balance_infos[0] (USD); map total_balance → balance.
 *
 * Daily spending: DeepSeek does NOT expose a dashboard/spending endpoint
 * (as of mid-2026). Real impl would synthesize spending from local
 * cost_events records keyed by provider=deepseek.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockBalance, mockSpending } from "./stub-data.js";

export const deepseekAdapter: ProviderCreditAdapter = {
  meta: {
    key: "deepseek",
    name: "DeepSeek",
    currency: "USD",
    balanceSupported: true,
    spendingSupported: false, // derived from local cost_events, not API
    dashboardUrl: "https://platform.deepseek.com/usage",
    brandColor: "#1A6EFF",
  },
  async fetchBalance() {
    return mockBalance(11);
  },
  async fetchSpending(opts) {
    return mockSpending(11, opts.from, opts.to);
  },
};

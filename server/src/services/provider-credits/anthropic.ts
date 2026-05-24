/**
 * Anthropic provider adapter — STUB.
 *
 * Real impl: Anthropic exposes per-org admin endpoints —
 *   GET https://api.anthropic.com/v1/organizations/{org_id}/usage_report/messages
 *     ?starting_at=ISO&ending_at=ISO&bucket_width=1d
 *   (admin API key only — different from a workspace key)
 *
 * Balance: Anthropic doesn't expose a "credit balance" the same way
 * DeepSeek does — it's a post-paid model with monthly limits. We surface
 * the monthly-credit-grant amount via the org usage report (subtract
 * spend MTD from the granted-pool) when an admin key is supplied.
 * For now: balanceSupported:false, spendingSupported:true.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const anthropicAdapter: ProviderCreditAdapter = {
  meta: {
    key: "anthropic",
    name: "Anthropic",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://console.anthropic.com/settings/billing",
    brandColor: "#D97757",
  },
  async fetchBalance() {
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(31, opts.from, opts.to);
  },
};

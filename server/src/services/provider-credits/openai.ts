/**
 * OpenAI provider adapter — STUB.
 *
 * Real impl is awkward — OpenAI deprecated the public
 * /v1/dashboard/billing/credit_grants endpoint that used to work with a
 * session cookie. Two viable replacements as of mid-2026:
 *
 *   1. Admin API: GET https://api.openai.com/v1/organization/usage with
 *      header Authorization: Bearer <admin-key>. Returns per-day usage
 *      buckets; no balance, but spend is rich.
 *   2. New "Usage API" beta: GET /v1/usage?date=... returns daily totals;
 *      same auth.
 *
 * Balance is not exposed publicly anywhere — Tyler still has to open the
 * dashboard to see remaining credit grants. So balanceSupported:false;
 * we'll show "—" and link to the dashboard URL.
 *
 * Spending: real impl uses Admin API endpoint. Stub returns mock series.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const openaiAdapter: ProviderCreditAdapter = {
  meta: {
    key: "openai",
    name: "OpenAI",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://platform.openai.com/account/billing/overview",
    brandColor: "#10A37F",
  },
  async fetchBalance() {
    // OpenAI doesn't expose balance via public API — return null balance.
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(23, opts.from, opts.to);
  },
};

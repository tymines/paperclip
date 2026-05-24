/**
 * Generic fallback for any provider Paperclip routes traffic through but
 * for which no dedicated adapter exists yet (e.g. Groq, Together, xAI,
 * Mistral, niche OpenAI-compatible endpoints). Returns spending-only
 * derived from local cost_events; no balance reachable.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const unknownAdapter: ProviderCreditAdapter = {
  meta: {
    key: "unknown",
    name: "Other providers",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://example.com/billing",
    brandColor: "#71717a",
  },
  async fetchBalance() {
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(2, opts.from, opts.to);
  },
};

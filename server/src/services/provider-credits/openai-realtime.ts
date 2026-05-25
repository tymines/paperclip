/**
 * Voice-only adapter for OpenAI Realtime (used by Jarvis premium tier).
 * No balance API — spend tracking flows through the local cost_events
 * table the same way as the other adapters.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const openaiRealtimeAdapter: ProviderCreditAdapter = {
  meta: {
    key: "openai_realtime",
    name: "OpenAI Realtime",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://platform.openai.com/usage",
    brandColor: "#10a37f",
  },
  async fetchBalance() {
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(0, opts.from, opts.to);
  },
};

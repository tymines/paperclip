/**
 * Gemini provider adapter — STUB.
 *
 * Real impl is significantly more work than the others — Gemini billing
 * lives inside Google Cloud Billing. You need:
 *   - a GCP project linked to the user's account
 *   - the Cloud Billing API enabled
 *   - service-account credentials with billing.viewer role
 *   - calls to BigQuery if Tyler wants per-day spend (Cloud Billing's
 *     "Get Cost" endpoint is org-level only)
 *
 * Tyler explicitly said this one was less straightforward; flagging for
 * a later pass. Stub returns mock data so the UI surface still renders.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const geminiAdapter: ProviderCreditAdapter = {
  meta: {
    key: "gemini",
    name: "Gemini (Google AI)",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://aistudio.google.com/usage",
    brandColor: "#4285F4",
  },
  async fetchBalance() {
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(43, opts.from, opts.to);
  },
};

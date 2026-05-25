/**
 * Voice-only adapter for ElevenLabs (used by Jarvis premium tier TTS).
 * No balance API exposed in a normalized form — spend tracking is local.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockSpending } from "./stub-data.js";

export const elevenlabsAdapter: ProviderCreditAdapter = {
  meta: {
    key: "elevenlabs",
    name: "ElevenLabs",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://elevenlabs.io/app/usage",
    brandColor: "#0d0d0d",
  },
  async fetchBalance() {
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending(opts) {
    return mockSpending(0, opts.from, opts.to);
  },
};

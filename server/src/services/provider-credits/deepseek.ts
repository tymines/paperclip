/**
 * DeepSeek provider adapter.
 *
 * Balance endpoint:
 *   GET https://api.deepseek.com/user/balance
 *     Authorization: Bearer <api-key>
 *   →  { is_available: bool, balance_infos: [{
 *          currency, total_balance, granted_balance, topped_up_balance
 *        }] }
 *
 * When an apiKey is supplied we attempt the real call and fall back to
 * stub mock data on any error (network, auth, rate-limit) so the UI
 * always renders. DeepSeek does not expose a public spending endpoint —
 * spending is derived from local cost_events when the real impl lands.
 */
import type { ProviderCreditAdapter, ProviderBalanceSnapshot } from "./types.js";
import { mockBalance, mockSpending } from "./stub-data.js";

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const FETCH_TIMEOUT_MS = 8_000;

export const deepseekAdapter: ProviderCreditAdapter = {
  meta: {
    key: "deepseek",
    name: "DeepSeek",
    currency: "USD",
    balanceSupported: true,
    spendingSupported: false,
    dashboardUrl: "https://platform.deepseek.com/usage",
    brandColor: "#1A6EFF",
  },
  async fetchBalance({ apiKey }) {
    if (!apiKey) {
      return mockBalance(11);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`deepseek balance HTTP ${res.status}`);
      }
      const payload = (await res.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency?: string;
          total_balance?: string | number;
          granted_balance?: string | number;
          topped_up_balance?: string | number;
        }>;
      };
      const info = payload.balance_infos?.[0];
      if (!info) {
        throw new Error("deepseek balance: empty balance_infos");
      }
      const result: ProviderBalanceSnapshot = {
        balance: Number(info.total_balance ?? 0),
        currency: info.currency ?? "USD",
        fetchedAt: new Date(),
        breakdown: {
          granted: Number(info.granted_balance ?? 0),
          prepaid: Number(info.topped_up_balance ?? 0),
        },
      };
      return result;
    } catch (err) {
      // Log once and fall back so the UI still renders.
      // eslint-disable-next-line no-console
      console.warn("[provider-credits/deepseek] live fetch failed, falling back to stub:", err);
      return mockBalance(11);
    }
  },
  async fetchSpending(opts) {
    // No public spending endpoint — return mock until cost_events
    // aggregation lands.
    return mockSpending(11, opts.from, opts.to);
  },
};

/**
 * Moonshot / Kimi provider adapter.
 *
 * Two regional bases — keys are region-bound (a .cn key 401s on .ai and
 * vice versa). We try .ai first (international, USD); if that returns
 * 401 we retry .cn (mainland, CNY). The base that authenticates wins;
 * we remember it for the rest of the call's lifetime (no cross-process
 * cache yet — the next 6h poll re-discovers).
 *
 * Endpoint: GET /v1/users/me/balance
 * Auth:     Authorization: Bearer <api_key>
 * Response envelope:
 *   { code: 0, data: { available_balance, voucher_balance, cash_balance },
 *     scode: "0x0", status: true }
 * The {code,data,scode,status} wrapper is unique to Moonshot — not OpenAI-
 * style. Check code===0 before reading data. Currency is NOT in the
 * payload — infer from the base URL.
 */
import type { ProviderCreditAdapter, ProviderBalanceSnapshot } from "./types.js";
import { mockBalance, mockSpending } from "./stub-data.js";

const BASE_AI = "https://api.moonshot.ai/v1/users/me/balance";
const BASE_CN = "https://api.moonshot.cn/v1/users/me/balance";
const FETCH_TIMEOUT_MS = 8_000;

// ponytail: EPIPE from broken pipe in bg process kills the server
const safeWarn = (...args: unknown[]) => { try { console.warn(...args); } catch {} };

interface MoonshotEnvelope {
  code?: number;
  status?: boolean;
  scode?: string;
  data?: {
    available_balance?: number;
    voucher_balance?: number;
    cash_balance?: number;
  };
}

async function tryFetch(url: string, apiKey: string): Promise<MoonshotEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (res.status === 401) {
    const err = new Error("moonshot 401");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`moonshot HTTP ${res.status}`);
  return (await res.json()) as MoonshotEnvelope;
}

export const moonshotAdapter: ProviderCreditAdapter = {
  meta: {
    key: "moonshot",
    name: "Moonshot / Kimi",
    currency: "USD", // overridden per-call from the base URL we land on
    balanceSupported: true,
    spendingSupported: false,
    dashboardUrl: "https://platform.moonshot.ai/console/account/balance",
    brandColor: "#000000",
  },
  async fetchBalance({ apiKey }) {
    if (!apiKey) {
      return mockBalance(7, "USD");
    }
    let payload: MoonshotEnvelope | null = null;
    let currency: "USD" | "CNY" = "USD";
    try {
      payload = await tryFetch(BASE_AI, apiKey);
      currency = "USD";
    } catch (errAi) {
      // Only retry .cn on auth failures (401); other errors propagate.
      const status = (errAi as Error & { status?: number }).status;
      if (status === 401) {
        try {
          payload = await tryFetch(BASE_CN, apiKey);
          currency = "CNY";
        } catch (errCn) {
          // eslint-disable-next-line no-console
          safeWarn("[provider-credits/moonshot] both .ai and .cn failed:", errCn);
          return mockBalance(7, "USD");
        }
      } else {
        // eslint-disable-next-line no-console
        safeWarn("[provider-credits/moonshot] live fetch failed, falling back to stub:", errAi);
        return mockBalance(7, "USD");
      }
    }
    if (!payload || payload.code !== 0 || !payload.data) {
      // eslint-disable-next-line no-console
      safeWarn("[provider-credits/moonshot] non-zero code or missing data; falling back");
      return mockBalance(7, currency);
    }
    const result: ProviderBalanceSnapshot = {
      balance: Number(payload.data.available_balance ?? 0),
      currency,
      fetchedAt: new Date(),
      breakdown: {
        granted: Number(payload.data.voucher_balance ?? 0),
        prepaid: Number(payload.data.cash_balance ?? 0),
      },
    };
    return result;
  },
  async fetchSpending(opts) {
    // No public spending endpoint — fall back to mock until cost_events
    // aggregation lands.
    return mockSpending(7, opts.from, opts.to, "USD");
  },
};

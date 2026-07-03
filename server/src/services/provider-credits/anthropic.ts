/**
 * Anthropic provider adapter.
 *
 * Balance is NOT exposed via the API — surface "Balance — see Console"
 * link on the card. Spend is exposed via Admin API cost_report.
 *
 * Endpoint:  GET https://api.anthropic.com/v1/organizations/cost_report
 * Auth headers:
 *   x-api-key: sk-ant-admin-...
 *   anthropic-version: 2023-06-01
 *   (NOT Authorization: Bearer — Anthropic Admin uses x-api-key)
 * Params:
 *   starting_at  ISO 8601 inclusive
 *   ending_at    ISO 8601 exclusive
 *   bucket_width "1d" (only "1d" supported on cost_report)
 *   limit        page size, page cursor for pagination
 *
 * Response:
 *   { data: [{ starting_at, ending_at, results: [{ amount, currency, … }] }],
 *     has_more, next_page }
 *
 * Amounts come back as DECIMAL STRINGS IN CENTS — "1234" = $12.34.
 * Easy to ship a 100x dashboard by forgetting the divide.
 */
import type { ProviderCreditAdapter, ProviderSpendingPoint } from "./types.js";
import { mockSpending } from "./stub-data.js";

const COST_REPORT_URL = "https://api.anthropic.com/v1/organizations/cost_report";
const FETCH_TIMEOUT_MS = 12_000;

// ponytail: EPIPE from broken pipe in bg process kills the server
const safeWarn = (...args: unknown[]) => { try { console.warn(...args); } catch {} };

interface AnthropicCostReport {
  data?: Array<{
    starting_at: string;
    ending_at: string;
    results?: Array<{
      amount?: string;
      currency?: string;
      [k: string]: unknown;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

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
    // Anthropic doesn't expose a balance endpoint; card surfaces a
    // dashboard link instead. We return a zero so the card renders
    // without showing a stale stub number.
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending({ apiKey, from, to }) {
    if (!apiKey) {
      return mockSpending(31, from, to);
    }
    const params = new URLSearchParams();
    params.set("starting_at", from.toISOString());
    params.set("ending_at", to.toISOString());
    params.set("bucket_width", "1d");
    params.set("limit", String(Math.min(60, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)))));

    const url = `${COST_REPORT_URL}?${params.toString()}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`anthropic cost_report HTTP ${res.status}`);
      }
      const payload = (await res.json()) as AnthropicCostReport;
      const daily: ProviderSpendingPoint[] = [];
      let monthSum = 0;
      let weekSum = 0;
      const now = Date.now();
      const currency = payload.data?.[0]?.results?.[0]?.currency ?? "USD";

      for (const bucket of payload.data ?? []) {
        // Sum every cost-type line in the bucket (tokens + web_search +
        // code_execution + …). Amounts are decimal strings in cents.
        const totalCents = (bucket.results ?? []).reduce((acc, row) => {
          const raw = row.amount;
          if (typeof raw !== "string") return acc;
          const n = Number(raw);
          return Number.isFinite(n) ? acc + n : acc;
        }, 0);
        const amount = totalCents / 100;
        const date = bucket.starting_at.slice(0, 10);
        daily.push({ date, amount: Number(amount.toFixed(4)) });
        const ageMs = now - new Date(bucket.starting_at).getTime();
        if (ageMs <= 30 * 86_400_000) monthSum += amount;
        if (ageMs <= 7 * 86_400_000) weekSum += amount;
      }

      return {
        daily,
        totalMonthToDate: Number(monthSum.toFixed(4)),
        totalWeekToDate: Number(weekSum.toFixed(4)),
        currency,
        fetchedAt: new Date(),
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      safeWarn("[provider-credits/anthropic] cost_report fetch failed, falling back to stub:", err);
      return mockSpending(31, from, to);
    }
  },
};

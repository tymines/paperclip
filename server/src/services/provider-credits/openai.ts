/**
 * OpenAI provider adapter.
 *
 * Balance is NOT exposed via the public API — legacy
 * /v1/dashboard/billing/credit_grants requires a browser session cookie,
 * not an sk-... key. There is no balance endpoint in the Admin API.
 * Surface "Balance — see dashboard" link.
 *
 * Spend endpoint: GET https://api.openai.com/v1/organization/costs
 * Auth:           Authorization: Bearer sk-admin-...    (Admin Key only)
 * Params (verified at platform.openai.com/docs/api-reference/usage):
 *   start_time    Unix seconds, inclusive
 *   end_time      Unix seconds, exclusive
 *   bucket_width  "1d" (only 1d supported on costs as of 2026)
 *   limit         1..180 buckets, default 7
 *   group_by[]    project_id | line_item | api_key_id
 *
 * Response shape:
 *   { object: "page",
 *     data: [{ object: "bucket", start_time, end_time, results: [
 *       { object: "organization.costs.result",
 *         amount: { value: 1.23, currency: "usd" }, … }
 *     ]}],
 *     has_more, next_page }
 * amount.value is a USD float (NOT cents, NOT string).
 */
import type { ProviderCreditAdapter, ProviderSpendingPoint } from "./types.js";
import { mockSpending } from "./stub-data.js";

const COSTS_URL = "https://api.openai.com/v1/organization/costs";
const FETCH_TIMEOUT_MS = 12_000;

// ponytail: EPIPE from broken pipe in bg process kills the server
const safeWarn = (...args: unknown[]) => { try { console.warn(...args); } catch {} };

interface OpenAICostsPage {
  data?: Array<{
    start_time?: number;
    end_time?: number;
    results?: Array<{
      amount?: { value?: number; currency?: string };
      [k: string]: unknown;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

export const openaiAdapter: ProviderCreditAdapter = {
  meta: {
    key: "openai",
    name: "OpenAI",
    currency: "USD",
    balanceSupported: false,
    spendingSupported: true,
    dashboardUrl: "https://platform.openai.com/settings/organization/billing/overview",
    brandColor: "#10A37F",
  },
  async fetchBalance() {
    // OpenAI doesn't expose balance via the public API. Card surfaces
    // a "see dashboard" link.
    return { balance: 0, currency: "USD", fetchedAt: new Date() };
  },
  async fetchSpending({ apiKey, from, to }) {
    if (!apiKey) {
      return mockSpending(23, from, to);
    }
    const params = new URLSearchParams();
    params.set("start_time", String(Math.floor(from.getTime() / 1000)));
    params.set("end_time", String(Math.floor(to.getTime() / 1000)));
    params.set("bucket_width", "1d");
    params.set("limit", String(Math.min(180, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)))));

    const url = `${COSTS_URL}?${params.toString()}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`openai /organization/costs HTTP ${res.status}`);
      }
      const payload = (await res.json()) as OpenAICostsPage;
      const daily: ProviderSpendingPoint[] = [];
      let monthSum = 0;
      let weekSum = 0;
      const now = Date.now();
      const firstCurrency = payload.data?.[0]?.results?.[0]?.amount?.currency;
      const currency = (firstCurrency ?? "USD").toUpperCase();

      for (const bucket of payload.data ?? []) {
        // Sum every line in the bucket (line_item = gpt-4o-mini,
        // gpt-4o, embeddings-3-small, …). amount.value is already in
        // USD as a JS number — no parsing needed.
        const dollars = (bucket.results ?? []).reduce((acc, row) => {
          const v = row.amount?.value;
          return typeof v === "number" && Number.isFinite(v) ? acc + v : acc;
        }, 0);
        const startSec = bucket.start_time ?? 0;
        const date = new Date(startSec * 1000).toISOString().slice(0, 10);
        daily.push({ date, amount: Number(dollars.toFixed(4)) });
        const ageMs = now - startSec * 1000;
        if (ageMs <= 30 * 86_400_000) monthSum += dollars;
        if (ageMs <= 7 * 86_400_000) weekSum += dollars;
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
      safeWarn("[provider-credits/openai] /organization/costs fetch failed, falling back to stub:", err);
      return mockSpending(23, from, to);
    }
  },
};

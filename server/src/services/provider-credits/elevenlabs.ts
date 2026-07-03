/**
 * ElevenLabs provider adapter.
 *
 * ElevenLabs does NOT expose a USD-balance endpoint the way DeepSeek /
 * Moonshot do. Instead it bills monthly subscriptions priced per character
 * quota:
 *
 *   GET https://api.elevenlabs.io/v1/user/subscription
 *     xi-api-key: <key>
 *   →  { tier, character_count, character_limit, currency, status, ... }
 *
 *   GET https://api.elevenlabs.io/v1/usage/character-stats
 *       ?start_unix=<ms>&end_unix=<ms>&include_workspace_metrics=false
 *     →  { time: [ms, ms, …], usage: { "All": [n, n, …] } }
 *
 *     NB: despite the `_unix` suffix the params are MILLISECOND epoch,
 *     and `usage` is an object keyed by breakdown bucket — `{}` when
 *     the account has no traffic.
 *
 * To unify the card with the other providers we project both metrics into
 * USD via the tier's published monthly price:
 *
 *   pricePerChar     = TIER_USD[tier] / character_limit
 *   creditsRemaining = (character_limit − character_count) × pricePerChar
 *
 * For the `free` tier this is $0 (the allowance is genuinely free), but
 * `breakdown.granted` still carries the dollar-equivalent of the remaining
 * free quota so the card has a non-zero "what you'd otherwise pay" signal.
 */
import type { ProviderCreditAdapter, ProviderBalanceSnapshot, ProviderSpendingPoint, ProviderSpendingReport } from "./types.js";
import { mockBalance, mockSpending } from "./stub-data.js";

const SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription";
const CHARACTER_STATS_URL = "https://api.elevenlabs.io/v1/usage/character-stats";
const FETCH_TIMEOUT_MS = 8_000;

// ponytail: EPIPE from broken pipe in bg process kills the server
const safeWarn = (...args: unknown[]) => { try { console.warn(...args); } catch {} };

// Published monthly subscription prices (USD) as of 2025/26. Used to
// project remaining-character quota into USD for the unified dashboard.
const TIER_USD: Record<string, number> = {
  free: 0,
  starter: 5,
  creator: 22,
  pro: 99,
  scale: 330,
  business: 1320,
};

interface SubscriptionPayload {
  tier?: string;
  character_count?: number;
  character_limit?: number;
  currency?: string;
  status?: string;
  next_character_count_reset_unix?: number;
}

interface CharacterStatsPayload {
  time?: number[];
  usage?: Record<string, number[]>;
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`elevenlabs HTTP ${res.status} (${url})`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function pricePerChar(sub: SubscriptionPayload): number {
  const tier = (sub.tier ?? "").toLowerCase();
  const usd = TIER_USD[tier];
  const limit = Number(sub.character_limit ?? 0);
  if (!usd || !limit) return 0;
  return usd / limit;
}

export const elevenlabsAdapter: ProviderCreditAdapter = {
  meta: {
    key: "elevenlabs",
    name: "ElevenLabs",
    currency: "USD",
    balanceSupported: true,
    spendingSupported: true,
    dashboardUrl: "https://elevenlabs.io/app/usage",
    // Pure black matches ElevenLabs' minimalist mark; the card's accent
    // strip + sparkline both render with this color.
    brandColor: "#000000",
  },
  async fetchBalance({ apiKey }) {
    if (!apiKey) return mockBalance(13);
    try {
      const sub = await fetchJson<SubscriptionPayload>(SUBSCRIPTION_URL, apiKey);
      const limit = Number(sub.character_limit ?? 0);
      const used = Number(sub.character_count ?? 0);
      const remainingChars = Math.max(0, limit - used);
      const tier = (sub.tier ?? "free").toLowerCase();
      const ratio = limit > 0 ? remainingChars / limit : 0;
      // Paid tier balance: $ value of the unused portion of this month's
      // quota at the published monthly price.
      const paidUsd = Number((ratio * (TIER_USD[tier] ?? 0)).toFixed(2));
      // Free quota has $0 list price but represents real value — project
      // it at the Starter rate ($5/30k chars) so the card surfaces a
      // meaningful dollar-equivalent of the remaining free allowance
      // instead of a misleading $0.00.
      const grantedUsd = tier === "free"
        ? Number((ratio * TIER_USD.starter).toFixed(2))
        : 0;
      const snapshot: ProviderBalanceSnapshot = {
        balance: tier === "free" ? grantedUsd : paidUsd,
        currency: (sub.currency ?? "usd").toUpperCase(),
        fetchedAt: new Date(),
        breakdown: {
          granted: grantedUsd,
          prepaid: tier === "free" ? 0 : paidUsd,
        },
      };
      return snapshot;
    } catch (err) {
      // eslint-disable-next-line no-console
      safeWarn("[provider-credits/elevenlabs] balance fetch failed, falling back to stub:", err);
      return mockBalance(13);
    }
  },
  async fetchSpending({ apiKey, from, to }) {
    if (!apiKey) return mockSpending(13, from, to);
    try {
      // Subscription gives us tier → price per character. Fetch both in
      // parallel; the dashboard already runs adapters concurrently so the
      // wall time is one round-trip, not two.
      const [sub, stats] = await Promise.all([
        fetchJson<SubscriptionPayload>(SUBSCRIPTION_URL, apiKey),
        fetchJson<CharacterStatsPayload>(
          `${CHARACTER_STATS_URL}?start_unix=${from.getTime()}&end_unix=${to.getTime()}&include_workspace_metrics=false`,
          apiKey,
        ),
      ]);
      const perChar = pricePerChar(sub);
      const times = stats.time ?? [];
      // The "All" bucket is what breakdown_type=None returns (the default).
      // If absent (empty usage object on a quiet account), sum across whatever
      // buckets exist, or treat as all-zero.
      const buckets = stats.usage ?? {};
      const counts: number[] = times.map((_, i) => {
        let sum = 0;
        for (const series of Object.values(buckets)) {
          const v = Number(series?.[i] ?? 0);
          if (Number.isFinite(v)) sum += v;
        }
        return sum;
      });
      const daily: ProviderSpendingPoint[] = times.map((ms, i) => ({
        date: new Date(ms).toISOString().slice(0, 10),
        amount: Number((counts[i] * perChar).toFixed(4)),
      }));
      const now = Date.now();
      let monthSum = 0;
      let weekSum = 0;
      for (let i = 0; i < times.length; i++) {
        const ageMs = now - times[i];
        const amount = counts[i] * perChar;
        if (ageMs <= 30 * 86_400_000) monthSum += amount;
        if (ageMs <= 7 * 86_400_000) weekSum += amount;
      }
      const report: ProviderSpendingReport = {
        daily,
        totalMonthToDate: Number(monthSum.toFixed(2)),
        totalWeekToDate: Number(weekSum.toFixed(2)),
        currency: (sub.currency ?? "usd").toUpperCase(),
        fetchedAt: new Date(),
      };
      return report;
    } catch (err) {
      // eslint-disable-next-line no-console
      safeWarn("[provider-credits/elevenlabs] spending fetch failed, falling back to stub:", err);
      return mockSpending(13, from, to);
    }
  },
};

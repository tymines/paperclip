/**
 * Shared deterministic mock-data helpers for the provider-credits stubs.
 * Real adapters replace fetchBalance / fetchSpending with HTTP calls; these
 * helpers stay forever (used by tests + the "unknown" fallback adapter).
 */
import type { ProviderSpendingPoint, ProviderSpendingReport, ProviderBalanceSnapshot } from "./types.js";

export function mockBalance(seed: number, currency = "USD"): ProviderBalanceSnapshot {
  // Stable "balance" between ~$5 and ~$240 keyed off the provider seed.
  const base = 5 + ((seed * 37) % 240);
  return {
    balance: Number(base.toFixed(2)),
    currency,
    fetchedAt: new Date(),
    breakdown: {
      granted: Number((base * 0.4).toFixed(2)),
      prepaid: Number((base * 0.6).toFixed(2)),
    },
  };
}

export function mockSpending(seed: number, from: Date, to: Date, currency = "USD"): ProviderSpendingReport {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const daily: ProviderSpendingPoint[] = [];
  let monthSum = 0;
  let weekSum = 0;
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const date = new Date(from.getTime() + i * 86_400_000);
    const day = ((seed + i * 7) % 13) * 0.42 + ((seed * 3 + i) % 5) * 0.18;
    const amount = Number(day.toFixed(2));
    daily.push({ date: date.toISOString().slice(0, 10), amount });
    const ageMs = now - date.getTime();
    if (ageMs <= 30 * 86_400_000) monthSum += amount;
    if (ageMs <= 7 * 86_400_000) weekSum += amount;
  }
  return {
    daily,
    totalMonthToDate: Number(monthSum.toFixed(2)),
    totalWeekToDate: Number(weekSum.toFixed(2)),
    currency,
    fetchedAt: new Date(),
  };
}

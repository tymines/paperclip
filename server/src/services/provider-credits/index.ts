/**
 * Provider-credits aggregation layer. Iterates over every registered
 * adapter, fetches balance + spending in parallel, and returns the
 * combined cards the UI renders.
 *
 * Each adapter currently uses stub data; replacing a single file with
 * a real HTTP impl is enough to light up that provider in the UI with
 * no other code changes.
 */
import type { ProviderCreditAdapter, ProviderCreditCard, ProviderKey } from "./types.js";
import { deepseekAdapter } from "./deepseek.js";
import { moonshotAdapter } from "./moonshot.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { openaiRealtimeAdapter } from "./openai-realtime.js";
import { elevenlabsAdapter } from "./elevenlabs.js";
import { unknownAdapter } from "./unknown.js";
import {
  getRawKey,
  SUPPORTED_PROVIDERS,
  type ProviderKey as ApiKeyProviderKey,
} from "../provider-api-keys/index.js";

const REGISTRY: Record<ProviderKey, ProviderCreditAdapter> = {
  deepseek: deepseekAdapter,
  moonshot: moonshotAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openai_realtime: openaiRealtimeAdapter,
  elevenlabs: elevenlabsAdapter,
  unknown: unknownAdapter,
};

export function listProviderCreditAdapters(): ProviderCreditAdapter[] {
  return Object.values(REGISTRY);
}

export function getProviderCreditAdapter(key: ProviderKey): ProviderCreditAdapter | null {
  return REGISTRY[key] ?? null;
}

/**
 * Build one ProviderCreditCard per registered adapter. Currently always
 * stub mode — when Tyler's API keys come online, replace this to (a)
 * resolve the per-provider API key from instance_settings and (b) pass
 * it through to the adapter.
 */
export async function fetchProviderCreditCards(): Promise<ProviderCreditCard[]> {
  const adapters = listProviderCreditAdapters();
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  // Resolve all keys up-front in parallel so per-card resolution stays cheap.
  const keys: Partial<Record<ProviderKey, string>> = {};
  await Promise.all(
    SUPPORTED_PROVIDERS.map(async (provider: ApiKeyProviderKey) => {
      const raw = await getRawKey(provider);
      if (raw) keys[provider as ProviderKey] = raw;
    }),
  );

  const cards = await Promise.all(
    adapters.map(async (adapter): Promise<ProviderCreditCard> => {
      const apiKey = keys[adapter.meta.key] ?? null;
      const [balance, spending] = await Promise.all([
        adapter.meta.balanceSupported
          ? adapter.fetchBalance({ apiKey }).catch(() => null)
          : Promise.resolve(null),
        adapter.meta.spendingSupported
          ? adapter.fetchSpending({ apiKey, from, to: now }).catch(() => null)
          : Promise.resolve(null),
      ]);

      return {
        provider: adapter.meta.key,
        name: adapter.meta.name,
        currency: balance?.currency ?? spending?.currency ?? adapter.meta.currency,
        balance: adapter.meta.balanceSupported ? balance?.balance ?? null : null,
        balanceLastFetchedAt: balance?.fetchedAt?.toISOString() ?? null,
        spendThisMonth: spending?.totalMonthToDate ?? 0,
        spendThisWeek: spending?.totalWeekToDate ?? 0,
        dailySeries: spending?.daily ?? [],
        dashboardUrl: adapter.meta.dashboardUrl,
        brandColor: adapter.meta.brandColor,
        hasApiKey: apiKey != null,
        // The card is "stub" only when there's no real key — adapters
        // that received a real key are expected to attempt a live call
        // and fall back to mock data on failure.
        isStub: apiKey == null,
      };
    }),
  );
  return cards;
}

export type { ProviderCreditAdapter, ProviderCreditCard, ProviderKey } from "./types.js";

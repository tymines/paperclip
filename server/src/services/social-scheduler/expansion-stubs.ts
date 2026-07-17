/**
 * Legacy stub implementations of the expansion-pass adapter methods
 * (Inbox / Competitors / Analytics / Hashtags).
 *
 * NOT USED ON ANY PRODUCTION PATH. Production adapters no longer spread
 * these in — a missing optional method is translated by `routes/social.ts`
 * into an honest `{ available: false, reason, homework }` response driven
 * by `feasibility.ts`. This factory is kept only as a fixture for tests
 * and explicit demo previews.
 */
import type { SocialAccount, SocialPlatform } from "@paperclipai/shared";
import type {
  AccountAnalytics,
  CompetitorMetricsTimeseries,
  CompetitorProfile,
  DirectMessage,
  DirectMessageThread,
  HashtagSuggestion,
  SocialPlatformAdapter,
} from "./types.js";
import {
  mockAccountAnalytics,
  mockCompetitorMetrics,
  mockCompetitorSearch,
  mockDmStream,
  mockDmThreads,
  mockHashtagSuggestions,
} from "./stub-helpers.js";

type ExpansionMethods = Pick<
  SocialPlatformAdapter,
  | "listDirectMessageThreads"
  | "listDirectMessages"
  | "sendDirectMessage"
  | "searchCompetitors"
  | "getCompetitorMetrics"
  | "getAccountAnalytics"
  | "suggestHashtags"
>;

export function expansionStubs(platform: SocialPlatform): ExpansionMethods {
  return {
    async listDirectMessageThreads(_account: SocialAccount, opts) {
      return mockDmThreads(platform, opts?.limit ?? 20) as DirectMessageThread[];
    },
    async listDirectMessages(_account: SocialAccount, threadId: string) {
      return mockDmStream(platform, threadId, "user") as DirectMessage[];
    },
    async sendDirectMessage(_account: SocialAccount, threadId: string, text: string) {
      return {
        id: `${threadId}-out-${Date.now()}`,
        threadId,
        direction: "outbound" as const,
        sentAt: new Date(),
        text,
      };
    },
    async searchCompetitors(query: string): Promise<CompetitorProfile[]> {
      return mockCompetitorSearch(platform, query);
    },
    async getCompetitorMetrics(handle: string, opts): Promise<CompetitorMetricsTimeseries> {
      return mockCompetitorMetrics(handle, opts.from, opts.to);
    },
    async getAccountAnalytics(account: SocialAccount, opts): Promise<AccountAnalytics> {
      const seed = account.id.charCodeAt(0) || 7;
      return mockAccountAnalytics(opts.from, opts.to, seed);
    },
    async suggestHashtags(opts): Promise<HashtagSuggestion[]> {
      return mockHashtagSuggestions(opts.text, opts.niche);
    },
  };
}

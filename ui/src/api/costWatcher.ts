import type { CostWatcherPayload } from "@paperclipai/shared";
import { api } from "./client";

/** Single-request aggregator for the /cost-watcher page. Server applies a 30s cache. */
export const costWatcherApi = {
  get: (companyId: string) =>
    api.get<CostWatcherPayload>(`/companies/${companyId}/cost-watcher`),
};

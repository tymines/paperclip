import { api } from "./client";

export interface MlflowStatus {
  reachable: boolean;
  url: string;
  experiment: string;
  experimentId: string | null;
  error?: string;
}

export interface MlflowCostsByAlias {
  alias: string;
  calls: number;
  costUsd: number;
  totalTokens: number;
  avgLatencyMs: number | null;
}

export interface MlflowCosts {
  reachable: boolean;
  experimentPresent?: boolean;
  generatedAt?: string;
  windowDays?: number;
  totalCalls: number;
  totalCostUsd: number;
  totalTokens: number;
  truncated?: boolean;
  byAlias: MlflowCostsByAlias[];
  error?: string;
}

export interface MlflowCall {
  runId: string;
  startedAt: string | null;
  alias: string;
  providerModel: string | null;
  provider: string | null;
  status: string | null;
  source: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface MlflowActivity {
  reachable: boolean;
  experimentPresent?: boolean;
  calls: MlflowCall[];
  error?: string;
}

export const mlflowApi = {
  status: () => api.get<MlflowStatus>("/mlflow/status"),
  costs: (days = 30) => api.get<MlflowCosts>(`/mlflow/costs?days=${days}`),
  activity: (limit = 50) => api.get<MlflowActivity>(`/mlflow/activity?limit=${limit}`),
};

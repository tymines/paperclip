import { api } from "./client";
export const pipelineApi = {
  listRuns: (c: string) => api.get(`/companies/${c}/pipeline/runs`),
  getRun: (c: string, id: string) => api.get(`/companies/${c}/pipeline/runs/${id}`),
  start: (c: string, name: string) => api.post(`/companies/${c}/pipeline/start`, { name }),
  gateDecision: (c: string, runId: string, decision: "pass" | "fail", opts?: { reason?: string; send_back_to?: string }) =>
    api.post(`/companies/${c}/gate-decision`, { runId, decision, ...(opts || {}) }),
};

import { Router } from "express";

/**
 * Read-only MLflow observability routes.
 *
 * Surfaces the fleet's real per-call LLM telemetry (cost / latency / tokens /
 * model alias / provider model) that the AugiVector litellm proxy logs to the
 * local MLflow tracking server. Strictly READ-ONLY: it only issues MLflow
 * `search` queries and never writes runs, params, metrics or tags.
 *
 * Data-honest contract: if MLflow is unreachable or has no runs, the endpoints
 * return `reachable:false` / empty arrays so the UI can omit the section. No
 * synthetic or placeholder numbers are ever produced here. Dead/empty runs
 * (failed or legacy calls with no token usage and no cost) are excluded from
 * the breakdown so the UI never shows $0.00 placeholder rows.
 */

const MLFLOW_URL = (process.env.MLFLOW_URL ?? "http://127.0.0.1:5566").replace(/\/+$/, "");
const EXPERIMENT_NAME = process.env.MLFLOW_FLEET_EXPERIMENT ?? "fleet-llm-calls";
const FETCH_TIMEOUT_MS = 4000;
const MAX_RUNS_SCAN = 5000; // safety cap for cost aggregation
const DEFAULT_WINDOW_DAYS = 30;

type Json = Record<string, unknown>;

async function mlflowPost(path: string, body: Json): Promise<Json> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${MLFLOW_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`MLflow ${path} -> HTTP ${res.status}`);
    return (await res.json()) as Json;
  } finally {
    clearTimeout(t);
  }
}

async function resolveExperimentId(): Promise<string | null> {
  const res = await mlflowPost("/api/2.0/mlflow/experiments/search", { max_results: 1000 });
  const experiments = (res.experiments as Array<Json> | undefined) ?? [];
  for (const e of experiments) {
    if (e.name === EXPERIMENT_NAME) return String(e.experiment_id);
  }
  return null;
}

interface MlflowRun {
  info: { run_id: string; start_time?: number; end_time?: number; status?: string };
  data: {
    metrics?: Array<{ key: string; value: number }>;
    params?: Array<{ key: string; value: string }>;
    tags?: Array<{ key: string; value: string }>;
  };
}

function tag(run: MlflowRun, key: string): string | undefined {
  return run.data.tags?.find((t) => t.key === key)?.value;
}
function metric(run: MlflowRun, key: string): number | undefined {
  return run.data.metrics?.find((m) => m.key === key)?.value;
}

async function searchRuns(
  experimentId: string,
  opts: { filter?: string; orderBy?: string[]; maxResults?: number; pageToken?: string },
): Promise<{ runs: MlflowRun[]; nextPageToken?: string }> {
  const body: Json = {
    experiment_ids: [experimentId],
    max_results: opts.maxResults ?? 1000,
  };
  if (opts.filter) body.filter = opts.filter;
  if (opts.orderBy) body.order_by = opts.orderBy;
  if (opts.pageToken) body.page_token = opts.pageToken;
  const res = await mlflowPost("/api/2.0/mlflow/runs/search", body);
  return {
    runs: (res.runs as MlflowRun[] | undefined) ?? [],
    nextPageToken: res.next_page_token as string | undefined,
  };
}

function windowFilter(days: number): string {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return `attributes.start_time > ${sinceMs}`;
}

type Agg = {
  calls: number;
  costUsd: number;
  totalTokens: number;
  latencySum: number;
  latencyN: number;
  providerModel?: string;
};

function bump(
  map: Map<string, Agg>,
  key: string,
  cost: number,
  tokens: number,
  latency: number | undefined,
  providerModel?: string,
): void {
  const g = map.get(key) ?? { calls: 0, costUsd: 0, totalTokens: 0, latencySum: 0, latencyN: 0 };
  g.calls += 1;
  g.costUsd += cost;
  g.totalTokens += tokens;
  if (providerModel && !g.providerModel) g.providerModel = providerModel;
  if (typeof latency === "number") {
    g.latencySum += latency;
    g.latencyN += 1;
  }
  map.set(key, g);
}

export function mlflowRoutes() {
  const router = Router();

  // GET /mlflow/status — is the tracking server reachable + experiment present?
  router.get("/mlflow/status", async (_req, res) => {
    try {
      const experimentId = await resolveExperimentId();
      res.json({
        reachable: true,
        url: MLFLOW_URL,
        experiment: EXPERIMENT_NAME,
        experimentId,
      });
    } catch (err) {
      res.json({
        reachable: false,
        url: MLFLOW_URL,
        experiment: EXPERIMENT_NAME,
        experimentId: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /mlflow/costs — aggregate spend over the trailing window. Returns BOTH:
  //   byModel — grouped by the underlying provider model (what each model costs;
  //             two aliases on the same model are combined). This is the honest
  //             "per-model spend" view.
  //   byAlias — grouped by the proxy model alias / lane (kept for compatibility).
  // Dead/empty runs (no tokens AND no cost) are excluded from totals and rows.
  router.get("/mlflow/costs", async (req, res) => {
    const days = clampInt(req.query.days, DEFAULT_WINDOW_DAYS, 1, 365);
    try {
      const experimentId = await resolveExperimentId();
      if (!experimentId) {
        res.json({ reachable: true, experimentPresent: false, totalCalls: 0, totalCostUsd: 0, totalTokens: 0, byModel: [], byAlias: [], windowDays: days });
        return;
      }
      const filter = windowFilter(days);
      const all: MlflowRun[] = [];
      let pageToken: string | undefined;
      do {
        const { runs, nextPageToken } = await searchRuns(experimentId, {
          filter,
          orderBy: ["attributes.start_time DESC"],
          maxResults: 1000,
          pageToken,
        });
        all.push(...runs);
        pageToken = nextPageToken;
      } while (pageToken && all.length < MAX_RUNS_SCAN);

      const modelGroups = new Map<string, Agg>();
      const aliasGroups = new Map<string, Agg>();
      let totalCost = 0;
      let totalTokens = 0;
      let billableCalls = 0;
      let excludedEmptyCalls = 0;

      for (const run of all) {
        const cost = metric(run, "cost_usd") ?? 0;
        const tokens = metric(run, "total_tokens") ?? 0;
        // Skip dead/empty runs so the breakdown shows only real billable spend.
        if (cost <= 0 && tokens <= 0) {
          excludedEmptyCalls += 1;
          continue;
        }
        const alias = tag(run, "model_alias") ?? "unknown";
        const providerModel = tag(run, "provider_model") || alias;
        const latency = metric(run, "latency_ms");
        bump(modelGroups, providerModel, cost, tokens, latency, providerModel);
        bump(aliasGroups, alias, cost, tokens, latency, providerModel);
        totalCost += cost;
        totalTokens += tokens;
        billableCalls += 1;
      }

      const byModel = [...modelGroups.entries()]
        .map(([model, g]) => ({
          model,
          calls: g.calls,
          costUsd: round(g.costUsd, 6),
          totalTokens: g.totalTokens,
          avgLatencyMs: g.latencyN ? Math.round(g.latencySum / g.latencyN) : null,
        }))
        .sort((a, b) => b.costUsd - a.costUsd);

      const byAlias = [...aliasGroups.entries()]
        .map(([alias, g]) => ({
          alias,
          providerModel: g.providerModel ?? null,
          calls: g.calls,
          costUsd: round(g.costUsd, 6),
          totalTokens: g.totalTokens,
          avgLatencyMs: g.latencyN ? Math.round(g.latencySum / g.latencyN) : null,
        }))
        .sort((a, b) => b.costUsd - a.costUsd);

      res.json({
        reachable: true,
        experimentPresent: true,
        generatedAt: new Date().toISOString(),
        windowDays: days,
        totalCalls: billableCalls,
        totalCostUsd: round(totalCost, 6),
        totalTokens,
        excludedEmptyCalls,
        truncated: all.length >= MAX_RUNS_SCAN,
        byModel,
        byAlias,
      });
    } catch (err) {
      res.json({ reachable: false, error: err instanceof Error ? err.message : String(err), byModel: [], byAlias: [], totalCalls: 0, totalCostUsd: 0, totalTokens: 0 });
    }
  });

  // GET /mlflow/activity — most recent per-call records for the Activity feed.
  router.get("/mlflow/activity", async (req, res) => {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    try {
      const experimentId = await resolveExperimentId();
      if (!experimentId) {
        res.json({ reachable: true, experimentPresent: false, calls: [] });
        return;
      }
      const { runs } = await searchRuns(experimentId, {
        orderBy: ["attributes.start_time DESC"],
        maxResults: limit,
      });
      const calls = runs.map((run) => ({
        runId: run.info.run_id,
        startedAt: run.info.start_time ? new Date(run.info.start_time).toISOString() : null,
        alias: tag(run, "model_alias") ?? "unknown",
        providerModel: tag(run, "provider_model") ?? null,
        provider: tag(run, "provider") ?? null,
        status: tag(run, "status") ?? run.info.status ?? null,
        source: tag(run, "source") ?? null,
        costUsd: metric(run, "cost_usd") ?? null,
        latencyMs: metric(run, "latency_ms") ?? null,
        totalTokens: metric(run, "total_tokens") ?? null,
        promptTokens: metric(run, "prompt_tokens") ?? null,
        completionTokens: metric(run, "completion_tokens") ?? null,
      }));
      res.json({ reachable: true, experimentPresent: true, calls });
    } catch (err) {
      res.json({ reachable: false, error: err instanceof Error ? err.message : String(err), calls: [] });
    }
  });

  return router;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

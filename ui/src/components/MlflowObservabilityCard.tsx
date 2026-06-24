import { useQuery } from "@tanstack/react-query";
import { mlflowApi } from "../api/mlflow";

/**
 * MLflow LLM observability surface (read-only).
 *
 * Renders the fleet's REAL per-call telemetry that the AugiVector litellm proxy
 * logs to the local MLflow tracking server. Data-honest: when MLflow is
 * unreachable or has logged no calls, it shows an explicit status line and
 * renders NO numbers — never mock/placeholder values.
 *
 *   variant="costs"    -> actual provider-billed spend grouped by model (Costs page)
 *   variant="activity" -> most-recent individual calls (Activity page)
 *
 * The "costs" view groups by the underlying provider MODEL (so Tyler can see
 * exactly what each model costs); two proxy aliases that share one model are
 * combined. These figures come straight from MLflow's logged cost/token metrics,
 * so they reconcile with MLflow by construction.
 */

const C = {
  surface: "#0D131D",
  surface2: "#111926",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  critical: "#FF5B5B",
  analytics: "#31D9FF",
} as const;
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
function fmtMs(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <section
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, color: C.text }}
      data-testid="mlflow-observability"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.analytics, fontWeight: 600 }}>
            LLM Observability · MLflow
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>
        </div>
        <span style={{ fontSize: 10, color: C.textFaint, fontFamily: MONO, whiteSpace: "nowrap" }}>fleet-llm-calls</span>
      </div>
      {children}
    </section>
  );
}

function StatusLine({ text, tone }: { text: string; tone: "muted" | "warn" }) {
  return (
    <div style={{ fontSize: 13, color: tone === "warn" ? C.critical : C.textMuted, fontStyle: "italic" }}>{text}</div>
  );
}

export function MlflowObservabilityCard({ variant }: { variant: "costs" | "activity" }) {
  const isCosts = variant === "costs";
  const costsQ = useQuery({
    queryKey: ["mlflow", "costs"],
    queryFn: () => mlflowApi.costs(30),
    enabled: isCosts,
    refetchInterval: 30_000,
  });
  const activityQ = useQuery({
    queryKey: ["mlflow", "activity"],
    queryFn: () => mlflowApi.activity(50),
    enabled: !isCosts,
    refetchInterval: 30_000,
  });

  if (isCosts) {
    const subtitle = "Actual provider-billed spend, grouped by model. Source of truth — reconciles with MLflow.";
    if (costsQ.isLoading) return <Shell subtitle={subtitle}><StatusLine tone="muted" text="Loading MLflow data…" /></Shell>;
    const d = costsQ.data;
    if (!d || d.reachable === false) {
      return <Shell subtitle={subtitle}><StatusLine tone="warn" text="MLflow tracking server not reachable — no data shown." /></Shell>;
    }
    const rows = d.byModel ?? [];
    if (!rows.length) {
      return <Shell subtitle={subtitle}><StatusLine tone="muted" text="No billable LLM calls logged yet." /></Shell>;
    }
    return (
      <Shell subtitle={subtitle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 14 }}>
          <Stat label={`Spend · last ${d.windowDays ?? 30}d`} value={fmtUsd(d.totalCostUsd)} accent={C.success} />
          <Stat label="Calls" value={String(d.totalCalls)} />
          <Stat label="Tokens" value={fmtTokens(d.totalTokens)} />
          <Stat label="Models" value={String(rows.length)} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.textFaint, textAlign: "left" }}>
                <Th>Model</Th><Th right>Calls</Th><Th right>Cost</Th><Th right>Tokens</Th><Th right>Avg latency</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td><span style={{ color: C.text }}>{r.model}</span></Td>
                  <Td right>{r.calls}</Td>
                  <Td right><span style={{ color: C.success }}>{fmtUsd(r.costUsd)}</span></Td>
                  <Td right>{fmtTokens(r.totalTokens)}</Td>
                  <Td right>{fmtMs(r.avgLatencyMs)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: C.textFaint }}>
          Computed by litellm from live provider pricing at the proxy chokepoint.
          {d.excludedEmptyCalls ? ` Excluded ${d.excludedEmptyCalls} empty/failed call${d.excludedEmptyCalls === 1 ? "" : "s"} (no tokens billed).` : ""}
          {d.truncated ? " Showing a capped sample of recent runs." : ""}
        </div>
      </Shell>
    );
  }

  const subtitle = "Most recent individual model calls captured at the proxy chokepoint.";
  if (activityQ.isLoading) return <Shell subtitle={subtitle}><StatusLine tone="muted" text="Loading MLflow data…" /></Shell>;
  const a = activityQ.data;
  if (!a || a.reachable === false) {
    return <Shell subtitle={subtitle}><StatusLine tone="warn" text="MLflow tracking server not reachable — no data shown." /></Shell>;
  }
  if (!a.calls?.length) {
    return <Shell subtitle={subtitle}><StatusLine tone="muted" text="No LLM calls logged yet." /></Shell>;
  }
  return (
    <Shell subtitle={subtitle}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.textFaint, textAlign: "left" }}>
              <Th>Time</Th><Th>Model alias</Th><Th>Provider model</Th><Th right>Cost</Th><Th right>Latency</Th><Th right>Tokens</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {a.calls.map((c) => (
              <tr key={c.runId} style={{ borderTop: `1px solid ${C.border}` }}>
                <Td><span style={{ color: C.textMuted }}>{fmtTime(c.startedAt)}</span></Td>
                <Td><span style={{ color: C.text }}>{c.alias}</span></Td>
                <Td><span style={{ color: C.textMuted }}>{c.providerModel ?? "—"}</span></Td>
                <Td right><span style={{ color: C.success }}>{fmtUsd(c.costUsd)}</span></Td>
                <Td right>{fmtMs(c.latencyMs)}</Td>
                <Td right>{fmtTokens(c.totalTokens)}</Td>
                <Td>
                  <span style={{ color: c.status === "ok" ? C.success : c.status ? C.critical : C.textFaint }}>
                    {c.status ?? "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: MONO, color: accent ?? C.text, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: "6px 10px", textAlign: right ? "right" : "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: "7px 10px", textAlign: right ? "right" : "left", color: C.textMuted, whiteSpace: "nowrap" }}>{children}</td>;
}

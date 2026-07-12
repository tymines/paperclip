/**
 * App detail — tabbed sub-views (spec 1.1). Live now: Overview, Pipeline,
 * Work Orders, Visual QC (read view). Dormant tabs render honestly as
 * dependency-blocked rather than pretending: Sessions (needs a real agent
 * runtime stream), Releases (release train phase), Analytics (PostHog).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, Check, X } from "lucide-react";
import {
  appdevControlApi,
  type AppdevGateRow,
  type AppdevVisualReview,
  type AppdevWorkOrder,
} from "../../api/appdevControl";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { DS, GATE_FROM_PHASE, PHASE_LABELS, PHASE_ORDER, cardBorder, surfaceCard } from "./ds";
import { ChatTab, FeedbackTab, PacksTab, RetroTab, VisualQcPro } from "./StudioTabs";

const TABS = [
  "overview",
  "pipeline",
  "work-orders",
  "packs",
  "chat",
  "feedback",
  "visual-qc",
  "retro",
  "sessions",
  "releases",
  "analytics",
] as const;
type Tab = (typeof TABS)[number];

const DORMANT: Partial<Record<Tab, string>> = {
  sessions:
    "Sessions need a real agent runtime emitting live transcripts. Paperclip has no agent dispatch today — the build pipeline is external. Schema (appdev_sessions) is in place; this tab activates when a dispatcher exists.",
  releases:
    "Release-train records land in a later phase (Fastlane execution additionally needs the Mac lane).",
  analytics: "Analytics reads self-hosted PostHog — deployment decision pending (spec Part 10).",
};

export function AppDevAppDetail() {
  const { appId, tab: tabParam } = useParams<{ appId: string; tab?: string }>();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";

  const { data, isLoading } = useQuery({
    queryKey: ["appdev", "app", selectedCompanyId, appId],
    queryFn: () => appdevControlApi.appDetail(selectedCompanyId!, appId!),
    enabled: !!selectedCompanyId && !!appId,
  });

  const app = data?.app;

  useEffect(() => {
    setBreadcrumbs([
      { label: "App Dev Control Center", href: "/appdev" },
      { label: app?.name ?? "App" },
    ]);
  }, [setBreadcrumbs, app?.name]);

  const kill = useMutation({
    mutationFn: () => appdevControlApi.killApp(selectedCompanyId!, appId!, "killed from app detail"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appdev"] }),
  });

  const outboundGate = app ? GATE_FROM_PHASE[app.phase] : undefined;
  const { data: evidence } = useQuery({
    queryKey: ["appdev", "evidence", selectedCompanyId, appId, outboundGate],
    queryFn: () => appdevControlApi.gateEvidence(selectedCompanyId!, appId!, outboundGate!),
    enabled: !!selectedCompanyId && !!appId && !!outboundGate && !!app,
  });

  if (data?.migrationPending) {
    return (
      <div className="p-8" style={{ background: DS.canvas }}>
        <div className="rounded-xl p-4 text-[13px]" style={{ background: "rgba(244,185,64,0.08)", border: `1px solid rgba(244,185,64,0.35)`, color: DS.textMuted }}>
          Migration 0146 pending — app detail activates once the schema is applied.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5 p-8" style={{ background: DS.canvas }} data-pp-page-v2="appdev-app-detail">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/appdev" className="rounded-lg p-1.5" style={{ border: cardBorder, color: DS.textMuted }}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-[26px] font-semibold leading-tight" style={{ color: DS.text }}>
              {app?.name ?? (isLoading ? "…" : "App")}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-[12px]" style={{ color: DS.textMuted }}>
              {app && (
                <>
                  <span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ background: DS.surface3, color: DS.analytics }}>
                    {PHASE_LABELS[app.phase] ?? app.phase}
                  </span>
                  <span>{app.platform}</span>
                  <span style={{ color: app.status === "killed" ? DS.critical : DS.success }}>{app.status}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {app && app.status !== "killed" && (
          <button
            onClick={() => kill.mutate()}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
            style={{ background: "rgba(255,91,91,0.12)", color: DS.critical, border: `1px solid rgba(255,91,91,0.3)` }}
            title="Per-app kill switch — halts all queued/in-progress work orders (RAIL semantics)"
          >
            <Ban className="h-4 w-4" /> Kill switch
          </button>
        )}
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => navigate(`/appdev/${appId}/${t}`)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize"
            style={
              t === tab
                ? { background: DS.surface3, color: DS.text, border: `1px solid ${DS.border2}` }
                : { color: DORMANT[t] ? DS.textFaint : DS.textMuted, border: "1px solid transparent" }
            }
          >
            {t.replace("-", " ")}
            {DORMANT[t] ? " ·" : ""}
          </button>
        ))}
      </nav>

      {DORMANT[tab] ? (
        <section style={surfaceCard} className="flex items-start gap-3 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: DS.warning }} />
          <div className="text-[13px] leading-relaxed" style={{ color: DS.textMuted }}>
            <div className="mb-1 font-semibold" style={{ color: DS.text }}>
              Dormant — dependency not met
            </div>
            {DORMANT[tab]}
          </div>
        </section>
      ) : tab === "overview" ? (
        <OverviewTab
          phase={app?.phase}
          evidence={evidence}
          outboundGate={outboundGate}
          workOrders={data?.workOrders ?? []}
        />
      ) : tab === "pipeline" ? (
        <PipelineTab gates={data?.gates ?? []} phase={app?.phase} />
      ) : tab === "work-orders" ? (
        <WorkOrdersTab workOrders={data?.workOrders ?? []} />
      ) : tab === "packs" ? (
        <PacksTab companyId={selectedCompanyId!} appId={appId!} />
      ) : tab === "chat" ? (
        <ChatTab companyId={selectedCompanyId!} appId={appId!} />
      ) : tab === "feedback" ? (
        <FeedbackTab companyId={selectedCompanyId!} appId={appId!} />
      ) : tab === "retro" ? (
        <RetroTab companyId={selectedCompanyId!} appId={appId!} />
      ) : (
        <div className="flex flex-col gap-4">
          <VisualQcPro companyId={selectedCompanyId!} appId={appId!} screens={data?.screens ?? []} />
          <VisualQcTab reviews={data?.visualReviews ?? []} screens={data?.screens ?? []} />
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  phase,
  evidence,
  outboundGate,
  workOrders,
}: {
  phase?: string;
  evidence?: { ok: boolean; missing: string[]; notes: string[] };
  outboundGate?: string;
  workOrders: AppdevWorkOrder[];
}) {
  const open = workOrders.filter((w) => !["done", "killed"].includes(w.status));
  const spend = workOrders.reduce((s, w) => s + Number(w.costUsd || 0), 0);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section style={surfaceCard} className="p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          Phase progress
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PHASE_ORDER.map((p, i) => {
            const idx = PHASE_ORDER.indexOf(phase ?? "idea");
            const state = i < idx ? "done" : i === idx ? "current" : "todo";
            return (
              <span
                key={p}
                className="rounded-md px-2 py-1 text-[11px] font-medium"
                style={{
                  background: state === "current" ? DS.primary : state === "done" ? "rgba(47,227,138,0.12)" : DS.surface3,
                  color: state === "current" ? "#fff" : state === "done" ? DS.success : DS.textFaint,
                }}
              >
                {PHASE_LABELS[p]}
              </span>
            );
          })}
        </div>
        {outboundGate && evidence && (
          <div className="mt-4 rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
              Next gate: <code>{outboundGate}</code>
            </div>
            {evidence.ok ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: DS.success }}>
                <Check className="h-4 w-4" /> Evidence complete — decidable from the queue.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {evidence.missing.map((m) => (
                  <span key={m} className="flex items-center gap-2 text-[12px]" style={{ color: DS.critical }}>
                    <X className="h-3.5 w-3.5" /> <code>{m}</code>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <section style={surfaceCard} className="p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          Work
        </div>
        <div className="flex gap-6">
          <div>
            <div className="text-[24px] font-semibold" style={{ color: DS.text }}>{open.length}</div>
            <div className="text-[11px]" style={{ color: DS.textFaint }}>open work orders</div>
          </div>
          <div>
            <div className="text-[24px] font-semibold" style={{ color: DS.text }}>${spend.toFixed(2)}</div>
            <div className="text-[11px]" style={{ color: DS.textFaint }}>spend to date (posted back)</div>
          </div>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed" style={{ color: DS.textFaint }}>
          Work orders are records; execution is the external pipeline, which reports in through the
          post-back API (plans, proof bundles, status, costs).
        </p>
      </section>
    </div>
  );
}

function PipelineTab({ gates, phase }: { gates: AppdevGateRow[]; phase?: string }) {
  return (
    <section style={surfaceCard} className="p-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
        Gate history — every passage attempt, who, verdict, evidence
      </div>
      {gates.length === 0 ? (
        <div className="text-[13px]" style={{ color: DS.textFaint }}>
          No gate attempts yet. App sits at {PHASE_LABELS[phase ?? "idea"]}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {gates.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
              <div className="flex items-center gap-3">
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                  style={{
                    background:
                      g.verdict === "passed" ? "rgba(47,227,138,0.12)" : g.verdict === "changes_requested" ? "rgba(244,185,64,0.12)" : "rgba(255,91,91,0.12)",
                    color: g.verdict === "passed" ? DS.success : g.verdict === "changes_requested" ? DS.warning : DS.critical,
                  }}
                >
                  {g.verdict}
                </span>
                <code className="text-[12px]" style={{ color: DS.text }}>{g.gate}</code>
                <span className="text-[12px]" style={{ color: DS.textMuted }}>by {g.reviewer}</span>
              </div>
              <span className="text-[11px]" style={{ color: DS.textFaint }}>
                {g.decidedAt ? new Date(g.decidedAt).toLocaleString() : "pending"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkOrdersTab({ workOrders }: { workOrders: AppdevWorkOrder[] }) {
  const [showComposerNote, setShowComposerNote] = useState(false);
  return (
    <section style={surfaceCard} className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          Work orders
        </div>
        <button
          onClick={() => setShowComposerNote((v) => !v)}
          className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: DS.surface3, color: DS.textMuted }}
        >
          Composer rules
        </button>
      </div>
      {showComposerNote && (
        <div className="mb-3 rounded-xl p-3 text-[12px] leading-relaxed" style={{ background: DS.surface, border: cardBorder, color: DS.textMuted }}>
          UI-touching orders are refused without a reference pack (app layer + DB CHECK). Size m/l
          orders cannot enter in_progress without an approved plan. Proof requirements for UI
          orders: build, test, screenshot_set, self_check.
        </div>
      )}
      {workOrders.length === 0 ? (
        <div className="text-[13px]" style={{ color: DS.textFaint }}>No work orders yet.</div>
      ) : (
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr style={{ color: DS.textFaint }}>
              <th className="pb-2 font-medium">Code</th>
              <th className="pb-2 font-medium">Lane</th>
              <th className="pb-2 font-medium">Objective</th>
              <th className="pb-2 font-medium">Size</th>
              <th className="pb-2 font-medium">Plan</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">UI</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((w) => (
              <tr key={w.id} style={{ borderTop: cardBorder, color: DS.textMuted }}>
                <td className="py-2 font-mono" style={{ color: DS.text }}>{w.code}</td>
                <td className="py-2">{w.lane}</td>
                <td className="max-w-[280px] truncate py-2" title={w.objective}>{w.objective}</td>
                <td className="py-2 uppercase">{w.sizeClass}</td>
                <td className="py-2">
                  <span style={{ color: w.planStatus === "escalated" ? DS.warning : w.planStatus === "approved" ? DS.success : DS.textFaint }}>
                    {w.planStatus}
                  </span>
                </td>
                <td className="py-2">
                  <span style={{ color: w.status === "changes_requested" ? DS.warning : w.status === "done" ? DS.success : w.status === "killed" ? DS.critical : DS.textMuted }}>
                    {w.status}
                  </span>
                </td>
                <td className="py-2">{w.touchesUi ? "yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function VisualQcTab({
  reviews,
  screens,
}: {
  reviews: AppdevVisualReview[];
  screens: Array<{ id: string; screenTag: string; comparisonMode: string; baselineAssetId: string | null }>;
}) {
  const latestByWo = useMemo(() => reviews.slice(0, 10), [reviews]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section style={surfaceCard} className="p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          Screen inventory ({screens.length})
        </div>
        {screens.length === 0 ? (
          <div className="text-[13px]" style={{ color: DS.textFaint }}>
            No screens declared. The harness, VFG and baselines all iterate over this inventory —
            declare screens before the first UI work order.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {screens.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg p-2.5" style={{ background: DS.surface, border: cardBorder }}>
                <code className="text-[12px]" style={{ color: DS.text }}>{s.screenTag}</code>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: DS.textFaint }}>
                  <span className="rounded px-1.5" style={{ background: DS.surface3 }}>{s.comparisonMode}</span>
                  <span>{s.baselineAssetId ? "baseline ✓" : "no baseline"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section style={surfaceCard} className="p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          VFG-2 reviews (Claude vision, decorrelated from the code lane)
        </div>
        {latestByWo.length === 0 ? (
          <div className="text-[13px]" style={{ color: DS.textFaint }}>No visual reviews yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {latestByWo.map((r) => (
              <div key={r.id} className="rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
                <div className="flex items-center justify-between">
                  <span
                    className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase"
                    style={{
                      background: r.verdict === "pass" ? "rgba(47,227,138,0.12)" : r.verdict === "borderline" ? "rgba(244,185,64,0.12)" : "rgba(255,91,91,0.12)",
                      color: r.verdict === "pass" ? DS.success : r.verdict === "borderline" ? DS.warning : DS.critical,
                    }}
                  >
                    {r.verdict}
                  </span>
                  <span className="text-[11px]" s
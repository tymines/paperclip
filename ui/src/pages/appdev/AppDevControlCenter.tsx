/**
 * App Dev Control Center — portfolio board + roster (spec v1.1 Part 1).
 * Route: /appdev  (legacy dashboard remains at /app-dev, linked below)
 *
 * Degrades gracefully while migration 0146 is gated: amber banner, intake and
 * board disabled, everything reviewable.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, ShieldAlert, ArrowRight } from "lucide-react";
import { appdevControlApi, type AppdevApp } from "../../api/appdevControl";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { DS, PHASE_LABELS, PHASE_ORDER, cardBorder, surfaceCard } from "./ds";

export function AppDevControlCenter() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ideaName, setIdeaName] = useState("");
  const [showIntake, setShowIntake] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "App Dev Control Center" }]);
  }, [setBreadcrumbs]);

  const { data: overview, isLoading } = useQuery({
    queryKey: ["appdev", "overview", selectedCompanyId],
    queryFn: () => appdevControlApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createApp = useMutation({
    mutationFn: (name: string) => appdevControlApi.createApp(selectedCompanyId!, { name }),
    onSuccess: (resp) => {
      setIdeaName("");
      setShowIntake(false);
      queryClient.invalidateQueries({ queryKey: ["appdev", "overview", selectedCompanyId] });
      navigate(`/appdev/${resp.app.id}`);
    },
  });

  const migrationPending = overview?.migrationPending === true;
  const apps: AppdevApp[] = overview?.apps ?? [];
  const waiting = overview?.waitingOnTyler ?? 0;
  const byPhase = new Map<string, AppdevApp[]>();
  for (const app of apps) {
    if (!byPhase.has(app.phase)) byPhase.set(app.phase, []);
    byPhase.get(app.phase)!.push(app);
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8" style={{ background: DS.canvas }} data-pp-page-v2="appdev-control-center">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
            App Dev Control Center
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: DS.textMuted }}>
            Concept → launch-ready → operated. Apps move only by gate passage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Waiting-on-Tyler — the loudest state in the UI (spec 1.1). */}
          <Link
            to="/appdev/queue"
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
            style={
              waiting > 0
                ? { background: "rgba(244,185,64,0.14)", border: `1px solid ${DS.warning}`, color: DS.warning, animation: "pulse 2s infinite" }
                : { background: DS.surface, border: cardBorder, color: DS.textFaint }
            }
          >
            <ShieldAlert className="h-4 w-4" />
            Waiting on you: {waiting}
          </Link>
          <button
            onClick={() => setShowIntake((v) => !v)}
            disabled={migrationPending}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
            style={{ background: DS.primary, color: "#fff", opacity: migrationPending ? 0.4 : 1 }}
          >
            <Plus className="h-4 w-4" /> New Idea
          </button>
        </div>
      </header>

      {migrationPending && (
        <div
          className="flex items-start gap-3 rounded-xl p-4"
          style={{ background: "rgba(244,185,64,0.08)", border: `1px solid rgba(244,185,64,0.35)` }}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: DS.warning }} />
          <div className="text-[13px] leading-relaxed" style={{ color: DS.textMuted }}>
            <span style={{ color: DS.warning, fontWeight: 600 }}>Migration pending.</span>{" "}
            The Control Center schema ({overview?.migration ?? "0146_appdev_control_center.sql"}) is
            written but gated — not applied to the database yet, per the migration freeze. The tab is
            reviewable; intake and gate actions unlock once Tyler approves the migration.
          </div>
        </div>
      )}

      {showIntake && !migrationPending && (
        <section style={surfaceCard} className="flex items-center gap-3 p-4">
          <input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="App idea name…"
            className="flex-1 rounded-xl bg-transparent px-3 py-2 text-[14px] outline-none"
            style={{ color: DS.text, border: cardBorder }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ideaName.trim()) createApp.mutate(ideaName.trim());
            }}
          />
          <button
            onClick={() => ideaName.trim() && createApp.mutate(ideaName.trim())}
            disabled={!ideaName.trim() || createApp.isPending}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold"
            style={{ background: DS.success, color: DS.canvas, opacity: !ideaName.trim() ? 0.5 : 1 }}
          >
            {createApp.isPending ? "Creating…" : "Create at Idea"}
          </button>
        </section>
      )}

      {/* Portfolio board — columns are phases; drag is disabled by design:
          apps move columns only via gate passage (spec 1.1). */}
      <section className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {PHASE_ORDER.map((phase) => {
            const col = byPhase.get(phase) ?? [];
            return (
              <div key={phase} className="w-[190px] shrink-0 rounded-2xl p-3" style={{ background: DS.surface, border: cardBorder }}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
                    {PHASE_LABELS[phase]}
                  </span>
                  <span className="rounded-full px-1.5 text-[10px] font-bold" style={{ background: DS.surface3, color: DS.textMuted }}>
                    {col.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {col.map((app) => (
                    <button
                      key={app.id}
                      onClick={() => navigate(`/appdev/${app.id}`)}
                      className="rounded-xl p-2.5 text-left"
                      style={{
                        background: DS.surface2,
                        border: phase === "tyler_gate" ? `1px solid ${DS.warning}` : cardBorder,
                      }}
                    >
                      <div className="text-[12px] font-semibold" style={{ color: DS.text }}>{app.name}</div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px]" style={{ color: DS.textFaint }}>
                        <span>{app.platform}</span>
                        <span style={{ color: app.status === "killed" ? DS.critical : app.status === "paused" ? DS.warning : DS.success }}>
                          {app.status}
                        </span>
                      </div>
                    </button>
                  ))}
                  {col.length === 0 && (
                    <div className="rounded-lg p-2 text-center text-[10px]" style={{ color: DS.textFaint, border: `1px dashed ${DS.border}` }}>
                      —
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isLoading && !overview && (
        <div className="text-[13px]" style={{ color: DS.textFaint }}>Loading portfolio…</div>
      )}

      <footer className="flex items-center justify-between text-[12px]" style={{ color: DS.textFaint }}>
        <span>
          Gates are objects, not Slack threads — every passage is recorded with evidence.
        </span>
        <Link to="/app-dev" className="flex items-center gap-1" style={{ color: DS.primary }}>
          Legacy App Dev dashboard (design chat & feedback) <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </footer>
    </div>
  );
}

export default AppDevControlCenter;

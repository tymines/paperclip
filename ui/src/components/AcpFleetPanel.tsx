/** Read-only detail panel for the canonical 2026-08-04-v2 Fleet roster. */
import { useQuery } from "@tanstack/react-query";
import { acpApi, type AcpFleetResult } from "../api/acp";
import { RefreshCw, Users } from "lucide-react";

const C = {
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
} as const;

export function AcpFleetPanel({ url, companyId }: { url?: string; companyId?: string } = {}) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<AcpFleetResult>({
    queryKey: ["acp", "fleet", url ?? "default", companyId ?? "no-company"],
    queryFn: () => acpApi.fleet({ url, companyId }),
    staleTime: 30_000,
    retry: false,
  });
  const agents = data?.ok ? data.agents : [];
  const registeredCount = agents.filter((agent) => agent.registered).length;
  const missingCount = agents.length - registeredCount;
  const hostCount = new Set(agents.map((agent) => agent.hostKey).filter(Boolean)).size;
  const requestedModels = Array.from(new Set(agents.map((agent) => agent.model).filter((model): model is string => Boolean(model))));
  const harnessCount = agents.filter((agent) => agent.harness).length;
  const hasCanonicalRoster = data?.ok === true && data.rosterSource === "canonical";
  const hasRegisteredOnlyRoster = data?.ok === true && data.rosterSource !== "canonical";

  return (
    <section
      className="overflow-hidden rounded-[14px]"
      style={{ background: `linear-gradient(180deg, ${C.surface2}, ${C.surface})`, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2.5">
          <Users className="h-4 w-4" style={{ color: C.primary }} />
          <div>
            <div className="text-[14px] font-semibold" style={{ color: C.text }}>
              {hasRegisteredOnlyRoster ? "Registered company roster" : "Canonical Fleet roster"}
            </div>
            <div className="text-[11px]" style={{ color: C.textFaint }}>
              {hasRegisteredOnlyRoster
                ? "Registered Paperclip agents for the selected company; no canonical AUG metadata or gateway connection"
                : "Current v2 definitions reconciled read-only to registered Paperclip agents; no gateway connection"}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold"
          style={{ background: C.surface3, border: `1px solid ${C.border2}`, color: C.text }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="px-5 py-4">
        {isLoading ? <p className="text-[13px]" style={{ color: C.textMuted }}>Loading canonical roster…</p> : null}
        {error ? <p className="text-[13px]" style={{ color: C.critical }}>Could not load canonical Fleet: {(error as Error).message}</p> : null}
        {data && !data.ok ? <p className="text-[13px]" style={{ color: C.critical }}>Could not load canonical Fleet: {data.error}</p> : null}

        {hasCanonicalRoster ? (
          <div className="flex flex-col gap-3" data-pp-fleet-summary>
            <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: C.textMuted }}>
              <span><strong style={{ color: C.text }}>{data.agentCount}</strong> canonical positions</span>
              <span><strong style={{ color: C.success }}>{registeredCount}</strong> registered</span>
              <span><strong style={{ color: C.warning }}>{missingCount}</strong> not registered</span>
              <span><strong style={{ color: C.text }}>{hostCount}</strong> host groups</span>
              <span><strong style={{ color: C.text }}>{harnessCount}</strong> harness positions</span>
            </div>
            <div className="text-[11px]" style={{ color: C.textFaint }}>
              Requested model labels: {requestedModels.join(", ")} · harnesses are represented separately from models.
            </div>
            <div className="text-[11px]" style={{ color: C.textMuted }}>
              Registration comes from matched Paperclip DB IDs; lineup and presentation metadata come from the canonical source definition.
            </div>
            <div className="text-[11px]" style={{ color: C.textMuted }}>
              Workflow: builder → paired reviewer → Zeus senior review → Tyler approval. No automatic deployment.
            </div>
          </div>
        ) : hasRegisteredOnlyRoster ? (
          <div className="flex flex-col gap-3" data-pp-fleet-summary data-pp-fleet-registered-only-summary>
            <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: C.textMuted }}>
              <span><strong style={{ color: C.text }}>{data.agentCount}</strong> registered company agents</span>
            </div>
            <div className="text-[11px]" style={{ color: C.textMuted }}>
              Only registered database agents are shown; canonical AUG hosts, pairings, models, and missing positions are not inferred.
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

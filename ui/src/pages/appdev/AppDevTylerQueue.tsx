/**
 * Tyler Gate queue (spec Part 7) — everything awaiting Tyler, oldest first.
 * Approve is physically disabled while required evidence is missing.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, X, MessageSquareWarning, ShieldAlert } from "lucide-react";
import { appdevControlApi, type TylerQueueItem } from "../../api/appdevControl";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { DS, cardBorder, surfaceCard } from "./ds";

function GateItemCard({ item, companyId }: { item: TylerQueueItem; companyId: string }) {
  const queryClient = useQueryClient();
  const [comments, setComments] = useState("");
  const gate = String((item.detail as { gate?: string }).gate ?? "tyler_to_implement");

  // Evidence preflight — drives the disabled state of Approve.
  const { data: evidence } = useQuery({
    queryKey: ["appdev", "evidence", companyId, item.appId, gate],
    queryFn: () => appdevControlApi.gateEvidence(companyId, item.appId, gate),
    enabled: item.kind === "gate",
  });

  const decide = useMutation({
    mutationFn: (verdict: "passed" | "failed" | "changes_requested") =>
      appdevControlApi.decideGate(companyId, item.appId, gate, {
        verdict,
        comments: comments.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appdev"] });
    },
  });

  const missing = evidence?.missing ?? [];
  const approveBlocked = evidence ? !evidence.ok : true;

  return (
    <section style={surfaceCard} className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <Link to={`/appdev/${item.appId}`} className="text-[15px] font-semibold" style={{ color: DS.text }}>
          {item.title}
        </Link>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "rgba(244,185,64,0.12)", color: DS.warning }}>
          {item.kind === "gate" ? `gate: ${gate}` : "plan escalation"}
        </span>
      </div>

      {/* Evidence checklist — the reason Approve is or isn't available. */}
      {evidence && (
        <div className="rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
            Required evidence
          </div>
          {missing.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: DS.success }}>
              <Check className="h-4 w-4" /> All machine-checkable evidence on file.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {missing.map((m) => (
                <li key={m} className="flex items-center gap-2 text-[12px]" style={{ color: DS.critical }}>
                  <X className="h-3.5 w-3.5 shrink-0" /> <code>{m}</code>
                </li>
              ))}
            </ul>
          )}
          {(evidence.notes ?? []).map((n, i) => (
            <div key={i} className="mt-1.5 flex items-start gap-2 text-[11px]" style={{ color: DS.textMuted }}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: DS.warning }} />
              {n}
            </div>
          ))}
        </div>
      )}

      {item.kind === "plan_escalation" && (
        <pre className="max-h-48 overflow-auto rounded-xl p-3 text-[11px]" style={{ background: DS.surface, border: cardBorder, color: DS.textMuted }}>
          {JSON.stringify((item.detail as { plan?: unknown }).plan ?? {}, null, 2)}
        </pre>
      )}

      <textarea
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="Comments (routed verbatim to the responsible work orders on Request Changes)…"
        rows={2}
        className="w-full rounded-xl bg-transparent p-3 text-[13px] outline-none"
        style={{ color: DS.text, border: cardBorder }}
      />

      {item.kind === "gate" && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => decide.mutate("passed")}
            disabled={approveBlocked || decide.isPending}
            title={approveBlocked ? `Blocked — missing: ${missing.join(", ")}` : "Approve and advance phase"}
            className="flex-1 rounded-xl px-3 py-2.5 text-[13px] font-semibold"
            style={{
              background: approveBlocked ? DS.surface3 : DS.success,
              color: approveBlocked ? DS.textFaint : DS.canvas,
              cursor: approveBlocked ? "not-allowed" : "pointer",
            }}
          >
            Approve
          </button>
          <button
            onClick={() => decide.mutate("changes_requested")}
            disabled={decide.isPending}
            className="flex-1 rounded-xl px-3 py-2.5 text-[13px] font-semibold"
            style={{ background: "rgba(244,185,64,0.12)", color: DS.warning, border: `1px solid rgba(244,185,64,0.3)` }}
          >
            Request changes
          </button>
          <button
            onClick={() => decide.mutate("failed")}
            disabled={decide.isPending}
            className="rounded-xl px-3 py-2.5 text-[13px] font-semibold"
            style={{ background: "rgba(255,91,91,0.12)", color: DS.critical, border: `1px solid rgba(255,91,91,0.3)` }}
          >
            Reject
          </button>
        </div>
      )}
      {decide.isError && (
        <div className="flex items-start gap-2 text-[12px]" style={{ color: DS.critical }}>
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          {(decide.error as Error).message}
        </div>
      )}
    </section>
  );
}

export function AppDevTylerQueue() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "App Dev Control Center", href: "/appdev" },
      { label: "Waiting on you" },
    ]);
  }, [setBreadcrumbs]);

  const { data } = useQuery({
    queryKey: ["appdev", "tyler-queue", selectedCompanyId],
    queryFn: () => appdevControlApi.tylerQueue(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="flex min-h-full flex-col gap-5 p-8" style={{ background: DS.canvas }} data-pp-page-v2="appdev-tyler-queue">
      <header className="flex items-center gap-3">
        <ShieldAlert className="h-7 w-7" style={{ color: DS.warning }} />
        <div>
          <h1 className="text-[28px] font-semibold" style={{ color: DS.text }}>Waiting on you</h1>
          <p className="text-[13px]" style={{ color: DS.textMuted }}>
            Blocked-on-human is the fleet's most expensive condition. Oldest first.
          </p>
        </div>
      </header>

      {data?.migrationPending && (
        <div className="rounded-xl p-4 text-[13px]" style={{ background: "rgba(244,185,64,0.08)", border: `1px solid rgba(244,185,64,0.35)`, color: DS.textMuted }}>
          Migration 0146 pending — the queue activates once the schema is applied.
        </div>
      )}

      {items.length === 0 && !data?.migrationPending && (
        <div className="rounded-xl p-8 text-center text-[14px]" style={{ background: DS.surface, border: cardBorder, color: DS.textFaint }}>
          Queue clear. Nothing is blocked on you.
        </div>
      )}

      <div className="flex max-w-[760px] flex-col gap-4">
        {items.map((item) => (
          <GateItemCard key={item.id} item={item} companyId={selectedCompanyId!} />
        ))}
      </div>
    </div>
  );
}

export default AppDevTylerQueue;

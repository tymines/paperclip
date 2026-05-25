import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { Check, MessageSquare, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentIcon } from "./AgentIconPicker";
import { StatusBadge } from "./StatusBadge";
import { Identity } from "./Identity";
import { AgentBridgeActivityPanel } from "./AgentBridgeActivityPanel";
import {
  AGENT_ROLE_LABELS,
  type Agent,
  type AgentChainOfCommandEntry,
  type AgentDetail,
  type HeartbeatRun,
} from "@paperclipai/shared";
import { relativeTime } from "../lib/utils";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

interface AgentProfileTabProps {
  agent: AgentDetail;
  runs: HeartbeatRun[];
  directReports: Agent[];
  agentRouteId: string;
  onTalk: () => void;
}

/**
 * Read-only "share card" view of an agent — the first iteration of the
 * agent-profile-as-shareable-unit pattern the UX research room converged on.
 * Today the URL is internal (login required); a future round will gate this
 * same view behind a public `/p/agents/:slug` route. Layout intentionally
 * spare so it survives being embedded in a guest / preview context later.
 */
export function AgentProfileTab({
  agent,
  runs,
  directReports,
  agentRouteId,
  onTalk,
}: AgentProfileTabProps) {
  const [copied, setCopied] = useState(false);

  const recentRuns = useMemo(() => {
    return [...runs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [runs]);

  const manager = agent.chainOfCommand?.[0] ?? null;

  function handleCopyLink() {
    const url = `${window.location.origin}/agents/${agentRouteId}/profile`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {
        setCopied(false);
      },
    );
  }

  const capabilities = (agent.capabilities ?? "").trim();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Hero card */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-accent">
            <AgentIcon icon={agent.icon} className="h-10 w-10" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold leading-tight">{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {roleLabels[agent.role] ?? agent.role}
              {agent.title ? ` · ${agent.title}` : ""}
            </p>
            {capabilities ? (
              <p className="mt-3 max-w-prose whitespace-pre-line text-sm text-foreground/90">
                {capabilities}
              </p>
            ) : (
              <p className="mt-3 text-sm italic text-muted-foreground">
                No capabilities described yet. Add a short bio in Instructions
                so collaborators know what this agent does.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={onTalk}>
            <MessageSquare className="h-4 w-4" />
            Talk to this agent
          </Button>
          <Button variant="outline" onClick={handleCopyLink} data-testid="agent-profile-share">
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Link copied" : "Share profile"}
          </Button>
        </div>
      </section>

      {/* Chain of command + recent runs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Chain of command
          </h2>
          <div className="mt-3 space-y-3">
            {manager ? (
              <ChainRow label="Reports to" entry={manager} />
            ) : (
              <p className="text-sm text-muted-foreground">No manager assigned.</p>
            )}
            {directReports.length > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">
                  Direct reports ({directReports.length})
                </p>
                <ul className="mt-2 space-y-1.5">
                  {directReports.slice(0, 5).map((report) => (
                    <li key={report.id}>
                      <Link
                        to={`/agents/${report.urlKey ?? report.id}/profile`}
                        className="flex items-center gap-2 text-sm hover:underline"
                      >
                        <Identity name={report.name} size="sm" />
                        <span className="truncate">{report.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {roleLabels[report.role] ?? report.role}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {directReports.length > 5 ? (
                    <li className="text-xs text-muted-foreground">
                      +{directReports.length - 5} more
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent runs
            </h2>
            <Link
              to={`/agents/${agentRouteId}/runs`}
              className="text-xs text-primary hover:underline"
            >
              See all
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No runs yet. Trigger the first heartbeat to see activity here.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recentRuns.map((run) => (
                <li key={run.id}>
                  <Link
                    to={`/agents/${agentRouteId}/runs/${run.id}`}
                    className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-accent/40"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate flex-1">
                      Run {run.id.slice(0, 8)} · {run.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(run.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AgentBridgeActivityPanel
        agentId={agent.id}
        companyId={agent.companyId}
      />


      <p className="text-center text-[11px] text-muted-foreground">
        Public agent profiles (no-login share links) coming next round —
        today this URL works for instance collaborators only.
      </p>
    </div>
  );
}

function ChainRow({ label, entry }: { label: string; entry: AgentChainOfCommandEntry }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Identity name={entry.name} size="sm" />
      <span className="truncate">{entry.name}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {roleLabels[entry.role] ?? entry.role}
      </span>
    </div>
  );
}


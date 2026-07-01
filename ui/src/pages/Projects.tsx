import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { costsApi } from "../api/costs";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  formatCostUsdCompact,
  formatDate,
  formatTokens,
  projectUrl,
} from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Hexagon, Plus } from "lucide-react";

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const projects = useMemo(
    () => (allProjects ?? []).filter((p) => !p.archivedAt),
    [allProjects],
  );

  // Server already aggregates cost_events by project (via heartbeat_run →
  // activity_log → issue → project), so this is one cheap query at the
  // list level instead of N requests per row.
  const { data: costByProject } = useQuery({
    queryKey: [...queryKeys.projects.list(selectedCompanyId!), "cost-by-project"],
    queryFn: () => costsApi.byProject(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const costByProjectId = useMemo(() => {
    const map = new Map<string, { costCents: number; inputTokens: number; outputTokens: number }>();
    for (const row of costByProject ?? []) {
      if (!row.projectId) continue;
      map.set(row.projectId, {
        costCents: row.costCents,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });
    }
    return map;
  }, [costByProject]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={openNewProject}>
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && (
        <div className="border border-border">
          {projects.map((project) => {
            const cost = costByProjectId.get(project.id);
            const totalTokens = (cost?.inputTokens ?? 0) + (cost?.outputTokens ?? 0);
            return (
              <EntityRow
                key={project.id}
                title={project.name}
                subtitle={project.description ?? undefined}
                to={projectUrl(project)}
                trailing={
                  <div className="flex items-center gap-3">
                    {cost && (cost.costCents > 0 || totalTokens > 0) ? (
                      <span
                        className="hidden items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground sm:inline-flex"
                        data-pp-project-cost={project.id}
                        title={`Spend on this project: $${(cost.costCents / 100).toFixed(2)} · ${totalTokens} tokens`}
                      >
                        <span className="text-foreground/80">
                          {formatCostUsdCompact(cost.costCents / 100)}
                        </span>
                        {totalTokens > 0 ? <span>{formatTokens(totalTokens)}t</span> : null}
                      </span>
                    ) : null}
                    {project.targetDate && (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(project.targetDate)}
                      </span>
                    )}
                    <StatusBadge status={project.status} />
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

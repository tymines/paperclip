import { useEffect, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Target, Plus } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to the Goals surface so the redesign is self-contained and */
/* does not mutate global theme variables used by other pages. Matches the    */
/* Home / Costs / Fleet builds.                                               */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  critical: "#FF5B5B",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view goals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="goals"
    >
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
            Goals
          </h1>
          <p className="text-[14px]" style={{ color: DS.textMuted }}>
            Company, team, agent, and task goals — active and planned.
          </p>
        </div>
        {goals && goals.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Goal
          </Button>
        )}
      </div>

      {error && <p className="text-sm" style={{ color: DS.critical }}>{error.message}</p>}

      {goals && goals.length === 0 && (
        <EmptyState
          icon={Target}
          message="No goals yet."
          action="Add Goal"
          onAction={() => openNewGoal()}
        />
      )}

      {goals && goals.length > 0 && (
        <div style={surfaceCard} className="p-5">
          <GoalTree goals={goals} goalLink={(goal) => `/goals/${goal.id}`} />
        </div>
      )}
    </div>
  );
}

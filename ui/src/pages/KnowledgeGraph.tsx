import { useEffect, useState } from "react";
import { FleetBrainView } from "../components/knowledge-graph/FleetBrainView";
import { FleetKbView } from "../components/knowledge-graph/FleetKbView";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

type KnowledgeGraphView = "brain" | "kb";

/**
 * KnowledgeGraph is intentionally trimmed to two live views:
 * - Neural FleetBrainView (default)
 * - Fleet KB reader
 *
 * The legacy Entity Graph/standard force graph is removed from the rendered
 * bundle so the Knowledge Graph entry point cannot expose a third mode.
 */
export function KnowledgeGraph() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [view, setView] = useState<KnowledgeGraphView>("brain");

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge Graph" }]);
  }, [setBreadcrumbs]);

  if (view === "kb") {
    return <FleetKbView onBack={() => setView("brain")} />;
  }

  return <FleetBrainView onShowKb={() => setView("kb")} />;
}

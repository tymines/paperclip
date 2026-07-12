/**
 * World View  per-layer data hook (TYL-131).
 *
 * Progressive + visibility-aware fetching per the spec: a layer only polls while
 * it is enabled AND the tab is visible. Uses TanStack Query with `enabled` gating
 * (the layerFetchedRef-style dedupe that OSIRIS relies on) so toggling a layer off
 * stops its network traffic.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { LayerDef } from "../layerRegistry";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export interface LayerData {
  geojson: FeatureCollection;
  count: number;
  status: "idle" | "loading" | "live" | "error";
  note: string | null;
}

export function useLayerData(layer: LayerDef, enabled: boolean): LayerData {
  const visible = usePageVisible();

  const q = useQuery({
    queryKey: ["worldview", "layer", layer.id],
    queryFn: async () => {
      const items = await layer.fetch();
      return { geojson: layer.toGeoJSON(items), count: items.length };
    },
    enabled,
    // Fast layers pause when hidden; slow layers (satellites/conflicts) don't need it.
    refetchInterval: enabled && visible ? layer.pollMs : false,
    refetchIntervalInBackground: false,
    staleTime: Math.min(layer.pollMs, 60000),
    retry: 1,
  });

  return {
    geojson: q.data?.geojson || EMPTY,
    count: q.data?.count ?? 0,
    status: !enabled ? "idle" : q.isLoading ? "loading" : q.isError ? "error" : "live",
    note: q.isError ? String((q.error as Error)?.message || "feed error") : null,
  };
}

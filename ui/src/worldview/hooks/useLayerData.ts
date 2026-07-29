import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { FeedState, LayerDef, LayerFetch } from "../layerRegistry";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export interface HistoricalOverride {
  items: unknown[];
  source: string;
  state: FeedState;
  note?: string | null;
  at: Date;
}

export interface LayerData {
  geojson: FeatureCollection;
  count: number;
  status: "idle" | "loading" | "live" | "fallback" | "needs_key" | "offline";
  source: string;
  note: string | null;
}

export function useLayerData(layer: LayerDef, enabled: boolean, historical?: HistoricalOverride): LayerData {
  const visible = usePageVisible();
  const query = useQuery({
    queryKey: ["worldview", "layer", layer.id],
    queryFn: () => layer.fetch(),
    enabled: enabled && !historical,
    refetchInterval: enabled && visible && !historical ? layer.pollMs : false,
    refetchIntervalInBackground: false,
    staleTime: Math.min(layer.pollMs, 60_000),
    retry: 1,
  });

  const payload = historical || query.data;
  const at = historical?.at;
  const geojson = useMemo(() => payload ? layer.toGeoJSON(payload.items, at) : EMPTY, [layer, payload, at]);
  const error = query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;
  return {
    geojson,
    count: payload?.items.length || 0,
    status: !enabled ? "idle" : query.isLoading && !historical ? "loading" : query.isError && !historical ? "offline" : payload?.state || "offline",
    source: payload?.source || layer.provider,
    note: payload?.note || error,
  };
}

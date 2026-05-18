import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";

const UI_V1_ATTR = "data-ui-v1";

/**
 * Returns whether UI v1 (Linear-inspired Home + trimmed sidebar + ⌘K Create
 * composer) is enabled, and mirrors the value onto <html> so the v1 theme
 * tokens in index.css activate. When the flag is off, the legacy chrome and
 * legacy theme apply exactly as before.
 */
export function useUiV1(): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    staleTime: 30_000,
  });

  const enabled = data?.enableUiV1 === true;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute(UI_V1_ATTR, "true");
    } else {
      root.removeAttribute(UI_V1_ATTR);
    }
  }, [enabled]);

  return enabled;
}

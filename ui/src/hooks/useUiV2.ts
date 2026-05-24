import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";

const UI_V2_ATTR = "data-ui-v2";

/**
 * Returns whether UI v2 (pass 1: sidebar visual skin) is enabled, and mirrors
 * the value onto <html> so the v2 tokens in index.css activate. Pass 1 only
 * touches the desktop sidebar — topbar, page content, and mobile drawer stay
 * on the v1 / legacy chrome.
 */
export function useUiV2(): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    staleTime: 30_000,
  });

  const enabled = data?.enableUiV2 === true;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute(UI_V2_ATTR, "true");
    } else {
      root.removeAttribute(UI_V2_ATTR);
    }
  }, [enabled]);

  return enabled;
}

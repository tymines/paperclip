import { useCallback, useState } from "react";
import { RECOMMENDED_MODEL_ID } from "@/components/image-studio/models";

/**
 * Remembers the user's chosen model per persona × tool (localStorage), defaulting
 * to the ⭐ Recommended pick. So Tyler doesn't have to re-pick every time, but the
 * recommended one is the out-of-the-box default.
 */
export function usePersistedModel(
  personaId: string | null | undefined,
  tool: string,
  fallback: string = RECOMMENDED_MODEL_ID,
): readonly [string, (id: string) => void] {
  const key = `image-studio:model:${personaId ?? "none"}:${tool}`;
  const [model, setModelState] = useState<string>(() => {
    if (typeof window === "undefined") return fallback;
    return localStorage.getItem(key) ?? fallback;
  });
  const setModel = useCallback(
    (id: string) => {
      setModelState(id);
      try {
        localStorage.setItem(key, id);
      } catch {
        // ignore storage failures (private mode etc)
      }
    },
    [key],
  );
  return [model, setModel] as const;
}

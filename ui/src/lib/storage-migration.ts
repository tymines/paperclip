import { PRODUCT_IDENTIFIERS } from "@paperclipai/shared/brand";

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEYS = {
  canonical: `${PRODUCT_IDENTIFIERS.canonical.slug}.theme`,
  compatibility: `${PRODUCT_IDENTIFIERS.compatibility.slug}.theme`,
} as const;

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark";
}

export function readThemePreference(storage: ThemeStorage): ThemePreference | null {
  const canonicalTheme = storage.getItem(THEME_STORAGE_KEYS.canonical);
  if (isThemePreference(canonicalTheme)) return canonicalTheme;

  const compatibilityTheme = storage.getItem(THEME_STORAGE_KEYS.compatibility);
  if (!isThemePreference(compatibilityTheme)) return null;

  try {
    storage.setItem(THEME_STORAGE_KEYS.canonical, compatibilityTheme);
  } catch {
    // The legacy preference remains usable even if migration storage is restricted.
  }
  return compatibilityTheme;
}

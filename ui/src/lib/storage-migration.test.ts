import { describe, expect, it, vi } from "vitest";
import { readThemePreference, THEME_STORAGE_KEYS } from "./storage-migration";

function createStorage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    entries,
  };
}

describe("readThemePreference", () => {
  it("prefers the Olympus value when both valid keys exist", () => {
    const storage = createStorage({
      [THEME_STORAGE_KEYS.canonical]: "light",
      [THEME_STORAGE_KEYS.compatibility]: "dark",
    });

    expect(readThemePreference(storage)).toBe("light");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.entries.get(THEME_STORAGE_KEYS.compatibility)).toBe("dark");
  });

  it("copies a valid legacy value to Olympus without changing the legacy key", () => {
    const storage = createStorage({
      [THEME_STORAGE_KEYS.compatibility]: "dark",
    });

    expect(readThemePreference(storage)).toBe("dark");
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEYS.canonical, "dark");
    expect(storage.entries.get(THEME_STORAGE_KEYS.compatibility)).toBe("dark");
  });

  it("does not migrate an invalid legacy value", () => {
    const storage = createStorage({
      [THEME_STORAGE_KEYS.compatibility]: "system",
    });

    expect(readThemePreference(storage)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.entries.has(THEME_STORAGE_KEYS.canonical)).toBe(false);
    expect(storage.entries.get(THEME_STORAGE_KEYS.compatibility)).toBe("system");
  });
});

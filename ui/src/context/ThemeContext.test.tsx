// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEYS } from "../lib/storage-migration";
import { ThemeProvider, useTheme } from "./ThemeContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ThemeProbe() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  return <span>{theme}</span>;
}

describe("ThemeProvider storage compatibility", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("migrates a valid legacy theme and writes subsequent changes only to Olympus", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEYS.compatibility, "light");

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    expect(container.textContent).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEYS.canonical)).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEYS.compatibility)).toBe("light");

    await act(async () => {
      root.unmount();
    });
  });
});

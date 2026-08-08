// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorOsNavigation } from "./CreatorOsNavigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CreatorOsNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("exposes every Creator OS destination with selected semantics", async () => {
    await act(async () => {
      root.render(<CreatorOsNavigation active="personas" onNavigate={vi.fn()} />);
    });

    expect(container.querySelectorAll("nav button")).toHaveLength(10);
    expect(container.querySelector('[data-testid="creator-nav-personas"]')?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[data-testid="creator-nav-overview"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("marks operational destinations available and keeps navigation real", async () => {
    const onNavigate = vi.fn();
    await act(async () => {
      root.render(<CreatorOsNavigation active="overview" onNavigate={onNavigate} />);
    });

    const flows = container.querySelector<HTMLButtonElement>('[data-testid="creator-nav-flows"]')!;
    expect(flows.getAttribute("aria-label")).toBe("Flows");
    expect(container.querySelector('[data-testid="creator-nav-social"]')?.getAttribute("aria-label")).toBe("Social");
    await act(async () => flows.click());
    expect(onNavigate).toHaveBeenCalledWith("flows");
  });
});

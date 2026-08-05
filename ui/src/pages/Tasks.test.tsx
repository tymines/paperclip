// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChip } from "./Tasks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Tasks phone controls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps a 44px phone lens target, restores compact desktop spacing, and activates the lens", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClick = vi.fn();

    act(() => {
      root.render(
        <FilterChip label="Blocked" count={2} active={false} tone="danger" onClick={onClick} />,
      );
    });

    const button = container.querySelector("button");
    expect(button?.className).toContain("h-11");
    expect(button?.className).toContain("sm:h-auto");
    expect(button?.className).toContain("sm:py-1.5");

    act(() => button?.click());
    expect(onClick).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { GoalDetailTabList, GoalPropertiesToggleButton } from "./GoalDetail";

vi.mock("../components/InlineEditor", () => ({ InlineEditor: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("GoalPropertiesToggleButton", () => {
  it("shows the reopen control when the properties panel is hidden", () => {
    const html = renderToStaticMarkup(
      <GoalPropertiesToggleButton panelVisible={false} onShowProperties={() => {}} />,
    );

    expect(html).toContain('title="Show properties"');
    expect(html).toContain("opacity-100");
  });

  it("collapses the reopen control while the properties panel is already visible", () => {
    const html = renderToStaticMarkup(
      <GoalPropertiesToggleButton panelVisible onShowProperties={() => {}} />,
    );

    expect(html).toContain("opacity-0");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("w-0");
  });
});

it("mounts unclipped 44px goal tabs and switches to projects", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Tabs defaultValue="children"><GoalDetailTabList childCount={2} projectCount={3} /></Tabs>));
  const list = container.querySelector<HTMLElement>("[data-slot='tabs-list']");
  const projects = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-slot='tabs-trigger']"))
    .find((button) => button.textContent?.includes("Projects"));
  expect(list?.className).toContain("min-h-[50px]");
  expect(list?.className).toContain("sm:h-9");
  expect(projects?.className).toContain("min-h-11");
  act(() => projects?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  expect(projects?.getAttribute("data-state")).toBe("active");
  act(() => root.unmount());
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { PageTabBar } from "./PageTabBar";

const mockSidebarState = vi.hoisted(() => ({ isMobile: true }));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => mockSidebarState,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const items = [
  { value: "overview", label: "Overview" },
  { value: "history", label: "History" },
  { value: "settings", label: "Settings" },
];

describe("PageTabBar", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockSidebarState.isMobile = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("uses an accessible select for a controlled mobile tab bar", async () => {
    const onValueChange = vi.fn();
    await act(async () => root.render(<PageTabBar items={items} value="overview" onValueChange={onValueChange} />));

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Page section"]')!;
    expect(select.value).toBe("overview");
    await act(async () => {
      select.value = "history";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("history");
  });

  it("keeps Radix tab semantics inside the uncontrolled mobile overflow scroller", async () => {
    await act(async () => root.render(
      <Tabs defaultValue="overview">
        <PageTabBar items={items} />
      </Tabs>,
    ));

    const scroller = container.querySelector("[data-pp-page-tabs-scroll]");
    const triggers = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(scroller).not.toBeNull();
    expect(triggers).toHaveLength(3);
    expect(scroller?.hasAttribute("tabindex")).toBe(false);
    expect(triggers.every((trigger) => trigger.tagName === "BUTTON")).toBe(true);
    expect(triggers[0]!.getAttribute("aria-selected")).toBe("true");
  });
});

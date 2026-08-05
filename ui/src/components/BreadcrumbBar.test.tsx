// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbBar } from "./BreadcrumbBar";

const mockBreadcrumbState = vi.hoisted(() => ({
  breadcrumbs: [] as Array<{ label: string; href?: string }>,
  mobileToolbar: null as ReactNode,
}));
const mockSidebarState = vi.hoisted(() => ({ isMobile: true }));
const mockToggleSidebar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbState,
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: mockSidebarState.isMobile, toggleSidebar: mockToggleSidebar }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "AUG" } }),
}));

vi.mock("@/plugins/slots", () => ({
  usePluginSlots: () => ({ slots: [] }),
  PluginSlotOutlet: () => null,
}));

vi.mock("@/plugins/launchers", () => ({
  usePluginLaunchers: () => ({ launchers: [] }),
  PluginLauncherOutlet: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("BreadcrumbBar", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockBreadcrumbState.breadcrumbs = [];
    mockBreadcrumbState.mobileToolbar = null;
    mockSidebarState.isMobile = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("keeps the sidebar trigger reachable when a route has no breadcrumbs", async () => {
    await act(async () => root.render(<BreadcrumbBar />));

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Open sidebar"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    expect(mockToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("keeps the sidebar trigger beside a custom mobile toolbar", async () => {
    mockBreadcrumbState.mobileToolbar = <button type="button">Route action</button>;
    await act(async () => root.render(<BreadcrumbBar />));

    expect(container.querySelector('button[aria-label="Open sidebar"]')).not.toBeNull();
    expect(container.querySelector("button:not([aria-label])")?.textContent).toBe("Route action");
  });
});

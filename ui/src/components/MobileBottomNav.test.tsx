// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav";

const mockOpenCreateComposer = vi.hoisted(() => vi.fn());
const mockOpenNewIssue = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ pathname: "/home" }));

vi.mock("@/lib/router", () => ({
  useLocation: () => mockLocation,
  NavLink: ({ children, to, className }: { children: ReactNode | ((state: { isActive: boolean }) => ReactNode); to: string; className?: string | ((state: { isActive: boolean }) => string) }) => {
    const isActive = mockLocation.pathname === to;
    return (
      <a href={to} className={typeof className === "function" ? className({ isActive }) : className}>
        {typeof children === "function" ? children({ isActive }) : children}
      </a>
    );
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openCreateComposer: mockOpenCreateComposer, openNewIssue: mockOpenNewIssue }),
}));

vi.mock("../hooks/useInboxBadge", () => ({ useInboxBadge: () => ({ inbox: 3 }) }));
vi.mock("../hooks/useIssueNoun", () => ({ useIssueNoun: () => ({ capPlural: "Tasks" }) }));
vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: { getExperimental: () => Promise.resolve({ enableUiV1: true }) },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("MobileBottomNav", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockLocation.pathname = "/home";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  async function renderNav(props: { visible: boolean; disabled?: boolean }) {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <MobileBottomNav {...props} />
      </QueryClientProvider>,
    ));
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("renders five reachable destinations and invokes the central Create action", async () => {
    await renderNav({ visible: true });

    const nav = container.querySelector('nav[aria-label="Mobile navigation"]')!;
    const targets = nav.querySelectorAll("a, button");
    expect(targets).toHaveLength(5);
    expect(container.querySelector('a[href="/home"]')).not.toBeNull();
    expect(container.querySelector('a[href="/agents/all"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(mockOpenCreateComposer).toHaveBeenCalledTimes(1);
  });

  it("removes hidden or drawer-blocked navigation from accessibility and focus navigation", async () => {
    await renderNav({ visible: false, disabled: true });
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-hidden")).toBe("true");
    expect(nav.hasAttribute("inert")).toBe(true);
  });
});

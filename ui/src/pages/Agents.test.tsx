// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agents, classifyFleetDisplayRole, groupFleetAgents } from "./Agents";
import { ToastProvider } from "../context/ToastContext";

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
}));

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
}));

const mockOpenNewAgent = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/agents/all", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewAgent: mockOpenNewAgent }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => type,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("Fleet display roles", () => {
  it.each([
    ["Zeus", "CEO/Manager"],
    ["Ares", "Manager"],
    ["Hermes", "Manager"],
    ["New Agent", "Worker"],
  ] as const)("classifies %s as %s", (name, role) => {
    expect(classifyFleetDisplayRole(name)).toBe(role);
  });

  it("groups only Zeus, Ares, and Hermes in Leadership and defaults unknown agents to Workers", () => {
    const agents = [
      makeAgent({ id: "new", name: "New Agent" }),
      makeAgent({ id: "hermes", name: "Hermes" }),
      makeAgent({ id: "zeus", name: "Zeus" }),
      makeAgent({ id: "ares", name: "Ares" }),
      makeAgent({ id: "baily", name: "Baily AI" }),
    ];

    const groups = groupFleetAgents(agents);

    expect(groups.leadership.map((agent) => agent.name)).toEqual(["Ares", "Hermes", "Zeus"]);
    expect(groups.workers.map((agent) => agent.name)).toEqual(["Baily AI", "New Agent"]);
  });
});

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("Agents", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ adapterConfig: { model: "gpt-5.4" } }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "agent-1",
        name: "Alpha",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the configured model on the all agents page", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("gpt-5.4");
  });
});

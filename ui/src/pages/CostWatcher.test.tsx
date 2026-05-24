// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CostWatcherPayload } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── mocks ──────────────────────────────────────────────────────────────────
// The page depends on a few small surfaces; we mock just those, not the
// full app shell. Each mock receives a value the test below can swap out.

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getCostWatcher: vi.fn(),
}));

vi.mock("@/lib/router", () => ({
  useNavigate: () => routerMock.navigate,
}));

vi.mock("../api/costWatcher", () => ({
  costWatcherApi: { get: apiMocks.getCostWatcher },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { issuePrefix: "TYL" },
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// Recharts depends on ResizeObserver and SVG measurement APIs jsdom doesn't
// implement. The tests below assert payload→UI mapping (tile math, sort,
// alert handling), so stub the chart entirely — its rendering is verified
// visually via the screenshot pass, not here.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  AreaChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="recharts-areachart" data-points={data?.length ?? 0}>{children}</div>
  ),
  Area: ({ dataKey, name }: { dataKey: string; name?: string }) => (
    <div data-testid={`recharts-area-${dataKey}`} data-name={name ?? ""} />
  ),
  XAxis: () => <div data-testid="recharts-xaxis" />,
  YAxis: () => <div data-testid="recharts-yaxis" />,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

// EmptyState/PageSkeleton/Button only need to render something — the real
// implementations pull in icons and tailwind classes that don't matter for
// behavior tests.
vi.mock("../components/EmptyState", () => ({
  EmptyState: ({ message }: { message: string }) => <div data-testid="empty-state">{message}</div>,
}));

vi.mock("../components/PageSkeleton", () => ({
  PageSkeleton: () => <div data-testid="page-skeleton" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import { CostWatcher } from "./CostWatcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── fixtures ───────────────────────────────────────────────────────────────

function buildPayload(overrides: Partial<CostWatcherPayload> = {}): CostWatcherPayload {
  const days: string[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(2026, 4, 24 - i));
    days.push(d.toISOString().slice(0, 10));
  }
  return {
    generatedAt: "2026-05-24T12:00:00.000Z",
    totals: {
      monthToDateUsd: 124.5,
      last7DaysUsd: 42,
      burnRatePerDayUsd: 6,
      projectedMonthlyUsd: 186,
      creditsRemainingUsd: 240,
      creditsRemainingProviderCount: 3,
      daysOfRunway: 40,
    },
    providers: [
      {
        provider: "deepseek",
        name: "DeepSeek",
        currency: "USD",
        balance: 22,
        balanceLastFetchedAt: "2026-05-24T11:00:00.000Z",
        spendThisMonth: 40,
        spendThisWeek: 14, // -> 2/day; 22/2 = 11d runway, NOT alerted
        dailySeries: days.map((date) => ({ date, amount: 1.5 })),
        dashboardUrl: "https://example.com/deepseek",
        brandColor: "#1A6EFF",
        hasApiKey: true,
        isStub: false,
        errorMessage: null,
      },
      {
        provider: "openai",
        name: "OpenAI",
        currency: "USD",
        balance: 3,
        balanceLastFetchedAt: "2026-05-24T11:00:00.000Z",
        spendThisMonth: 70,
        spendThisWeek: 21, // -> 3/day; 3/3 = 1d runway -> ERROR
        dailySeries: days.map((date) => ({ date, amount: 3 })),
        dashboardUrl: "https://example.com/openai",
        brandColor: "#10A37F",
        hasApiKey: true,
        isStub: false,
        errorMessage: null,
      },
    ],
    timeline: {
      days,
      byProvider: [
        {
          key: "deepseek",
          name: "DeepSeek",
          color: "#1A6EFF",
          values: days.map(() => 1.5),
        },
        {
          key: "openai",
          name: "OpenAI",
          color: "#10A37F",
          values: days.map(() => 3),
        },
      ],
      byAgent: [
        {
          key: "agent-a",
          name: "Atlas",
          color: "#22D3EE",
          values: days.map(() => 2),
        },
      ],
    },
    agents: [
      {
        agentId: "agent-a",
        agentName: "Atlas",
        agentStatus: "active",
        adapterType: "openclaw-gateway",
        runs: 12,
        inputTokens: 100_000,
        cachedInputTokens: 50_000,
        outputTokens: 25_000,
        spendUsd: 60,
        avgSpendPerRunUsd: 5,
      },
      {
        agentId: "agent-b",
        agentName: "Mercury",
        agentStatus: "paused",
        adapterType: "claude-local",
        runs: 30,
        inputTokens: 200_000,
        cachedInputTokens: 10_000,
        outputTokens: 70_000,
        spendUsd: 12,
        avgSpendPerRunUsd: 0.4,
      },
    ],
    alerts: [],
    ...overrides,
  };
}

// ─── harness ────────────────────────────────────────────────────────────────

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 },
    },
  });
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={client}>
        <CostWatcher />
      </QueryClientProvider>,
    );
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

async function flush(container?: HTMLElement) {
  // React Query resolves through several microtasks before the component
  // re-renders with data; alternating microtask and macrotask drains gets
  // it consistently. The optional `until` lets a caller stop early once the
  // expected DOM has appeared, avoiding hangs and unnecessary churn.
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (container && container.querySelector("[data-pp-page='cost-watcher']")) return;
  }
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("CostWatcher", () => {
  beforeEach(() => {
    routerMock.navigate.mockReset();
    apiMocks.getCostWatcher.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the four top tiles from payload totals", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      expect(container.textContent).toContain("$124.50");        // MTD
      expect(container.textContent).toContain("$6.00/day");      // burn rate
      expect(container.textContent).toContain("$186");           // projected
      expect(container.textContent).toContain("$240");           // credits
      expect(container.textContent).toContain("3 providers");    // count
      expect(container.textContent).toContain("1.3mo");          // runway 40d -> 1.3mo
    } finally {
      cleanup();
    }
  });

  it("renders an Indefinite runway when there is no burn", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(
      buildPayload({
        totals: {
          monthToDateUsd: 0,
          last7DaysUsd: 0,
          burnRatePerDayUsd: 0,
          projectedMonthlyUsd: 0,
          creditsRemainingUsd: 100,
          creditsRemainingProviderCount: 2,
          daysOfRunway: null,
        },
      }),
    );
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      expect(container.textContent).toContain("Indefinite");
    } finally {
      cleanup();
    }
  });

  it("renders the timeline chart with one area per series", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      expect(container.querySelector("[data-testid='recharts-areachart']")).not.toBeNull();
      expect(container.querySelector("[data-testid='recharts-area-deepseek']")).not.toBeNull();
      expect(container.querySelector("[data-testid='recharts-area-openai']")).not.toBeNull();
      // 30-day window
      expect(
        container.querySelector("[data-testid='recharts-areachart']")?.getAttribute("data-points"),
      ).toBe("30");
    } finally {
      cleanup();
    }
  });

  it("toggles between by-provider and by-agent stacking", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      // default = by-provider
      expect(container.querySelector("[data-testid='recharts-area-deepseek']")).not.toBeNull();
      const toggle = container.querySelector<HTMLButtonElement>(
        "[data-pp-chart-mode='byAgent']",
      );
      expect(toggle).not.toBeNull();
      act(() => {
        toggle?.click();
      });
      await flush(container);
      expect(container.querySelector("[data-testid='recharts-area-agent-a']")).not.toBeNull();
      expect(container.querySelector("[data-testid='recharts-area-deepseek']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("leaderboard defaults to spend desc and reorders on sort header click", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      const rowsInitial = Array.from(container.querySelectorAll("[data-pp-leaderboard-row]"));
      expect(rowsInitial.map((r) => r.getAttribute("data-pp-leaderboard-row"))).toEqual([
        "agent-a",
        "agent-b",
      ]);

      const runsHeader = container.querySelector<HTMLButtonElement>("[data-pp-sort='runs']");
      expect(runsHeader).not.toBeNull();
      act(() => {
        runsHeader?.click();
      });
      await flush(container);

      const rowsAfter = Array.from(container.querySelectorAll("[data-pp-leaderboard-row]"));
      // agent-b has 30 runs vs agent-a's 12 — by runs desc agent-b is first.
      expect(rowsAfter.map((r) => r.getAttribute("data-pp-leaderboard-row"))).toEqual([
        "agent-b",
        "agent-a",
      ]);
    } finally {
      cleanup();
    }
  });

  it("clicking a leaderboard row navigates to the agent detail page", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      const firstRow = container.querySelector<HTMLElement>("[data-pp-leaderboard-row='agent-a']");
      act(() => {
        firstRow?.click();
      });
      expect(routerMock.navigate).toHaveBeenCalledWith("/TYL/agents/agent-a");
    } finally {
      cleanup();
    }
  });

  it("renders alerts and snoozes them to localStorage", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(
      buildPayload({
        alerts: [
          {
            id: "runway:openai",
            severity: "error",
            title: "OpenAI runway",
            body: "1d at $3/day",
            providerKey: "openai",
          },
          {
            id: "ceiling:agent-a",
            severity: "warning",
            title: "Atlas crossed $5/day",
            body: "Spent $6 in last 24h.",
            agentId: "agent-a",
          },
        ],
      }),
    );
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      expect(container.querySelectorAll("[data-pp-alert]").length).toBeGreaterThanOrEqual(2);
      const snoozeButton = container.querySelector<HTMLButtonElement>(
        "[data-pp-alert-snooze='runway:openai']",
      );
      expect(snoozeButton).not.toBeNull();
      act(() => {
        snoozeButton?.click();
      });
      await flush(container);
      expect(
        container.querySelector("[data-pp-alert='runway:openai']"),
      ).toBeNull();
      expect(window.localStorage.getItem("cost-watcher:snooze:runway:openai")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("shows EmptyState when there is no company selected", async () => {
    apiMocks.getCostWatcher.mockResolvedValue(buildPayload());
    // Override the mocked company context for this single test.
    const companyMod = await import("../context/CompanyContext");
    const original = companyMod.useCompany;
    (companyMod as unknown as { useCompany: () => unknown }).useCompany = () => ({
      selectedCompanyId: null,
      selectedCompany: null,
    });
    const { container, cleanup } = await renderPage();
    await flush(container);
    try {
      expect(container.querySelector("[data-testid='empty-state']")?.textContent).toContain(
        "Select a company",
      );
    } finally {
      (companyMod as unknown as { useCompany: () => unknown }).useCompany = original;
      cleanup();
    }
  });
});

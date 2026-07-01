// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanySkillListItem } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsCatalog } from "./SkillsCatalog";

const mockApi = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  listAgentGrants: vi.fn(),
  setEnabled: vi.fn(),
  setAgentGrant: vi.fn(),
  invoke: vi.fn(),
  installManifest: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { name: "Acme" },
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: mockPushToast }),
}));

vi.mock("../api/companySkills", () => ({
  companySkillsApi: mockApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeSkill(overrides: Partial<CompanySkillListItem>): CompanySkillListItem {
  return {
    id: "skill-1",
    companyId: "company-1",
    key: "translate",
    slug: "translate",
    name: "Translate",
    description: "Translate text between languages",
    sourceType: "local_path",
    sourceLocator: "skills/translate",
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    attachedAgentCount: 2,
    totalAgentCount: 4,
    usage30d: { invocations: 12, successRate: 0.91, avgLatencyMs: 145, totalCostCents: 23 },
    editable: true,
    editableReason: null,
    sourceLabel: "Local",
    sourceBadge: "local",
    sourcePath: "skills/translate",
    ...overrides,
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("SkillsCatalog", () => {
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
    mockApi.detail.mockResolvedValue(null);
    mockApi.listAgentGrants.mockResolvedValue({ skillId: "skill-1", skillKey: "translate", grants: [] });
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => { currentRoot.unmount(); });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function mount() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <SkillsCatalog />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
  }

  it("renders the catalog header and a skill card for each item returned by the API", async () => {
    mockApi.list.mockResolvedValue([
      makeSkill({}),
      makeSkill({
        id: "skill-2",
        slug: "web-search",
        name: "Web Search",
        sourceBadge: "paperclip",
        sourceLabel: "Paperclip",
        usage30d: { invocations: 4321, successRate: null, avgLatencyMs: null, totalCostCents: 0 },
      }),
    ]);
    await mount();

    expect(container.textContent).toContain("Skills");
    expect(container.textContent).toContain("Acme");

    const cards = container.querySelectorAll('[data-testid="skill-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0]?.textContent).toContain("Translate");
    expect(cards[1]?.textContent).toContain("Web Search");

    // 30-day invocation count surfaces on cards (formatted).
    expect(container.textContent).toContain("4.3k invocations");
  });

  it("opens the detail drawer when a skill card is clicked", async () => {
    mockApi.list.mockResolvedValue([makeSkill({})]);
    await mount();

    expect(document.querySelector('[data-testid="skill-detail-drawer"]')).toBeNull();

    const cardButton = container.querySelector('[data-testid="skill-card"] button[aria-label^="Open"]') as HTMLButtonElement | null;
    expect(cardButton).not.toBeNull();
    await act(async () => { cardButton!.click(); });
    await flushReact();

    const drawer = document.querySelector('[data-testid="skill-detail-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain("Translate");
    expect(drawer!.textContent).toContain("Overview");
    expect(drawer!.textContent).toContain("Try it");
  });

  it("shows the empty-state hero when no skills are returned", async () => {
    mockApi.list.mockResolvedValue([]);
    await mount();

    expect(container.textContent).toContain("Bootstrap your skill library");
    expect(container.textContent).toContain("Web Search");
    expect(container.textContent).toContain("Code Execution");
    expect(container.textContent).toContain("Read Filesystem");
  });
});

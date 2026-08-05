// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agents } from "./Agents";
import { ToastProvider } from "../context/ToastContext";

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
  get: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
  list: vi.fn(),
}));

const mockAcpApi = vi.hoisted(() => ({ fleet: vi.fn() }));
const mockCostsApi = vi.hoisted(() => ({ summary: vi.fn() }));
const mockLocation = vi.hoisted(() => ({ pathname: "/agents/all", search: "", hash: "", state: null }));

const mockOpenNewAgent = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockSidebar = vi.hoisted(() => ({ isMobile: false }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => mockLocation,
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
  useSidebar: () => mockSidebar,
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../api/acp", () => ({
  acpApi: mockAcpApi,
}));

vi.mock("../api/costs", () => ({
  costsApi: mockCostsApi,
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

const canonicalNames = [
  "Zeus", "Athena", "Hermes", "Atlas", "Artemis", "Chronos", "Achlys", "Augi",
  "Ares", "Apollo", "Hephaestus", "Poseidon", "Hades", "Calliope", "Book Keeper", "August",
];

function canonicalDefinition(name: string) {
  const index = canonicalNames.indexOf(name);
  const hostKey = index < 2 ? "windows" : index < 8 ? "box1" : "box2";
  const hostLabel = hostKey === "windows" ? "WINDOWS — ZEUS" : hostKey === "box1" ? "BOX 1 — HERMES" : "BOX 2 — ARES";
  const hostMachine = hostKey === "windows" ? "WindowsAugi" : hostKey === "box1" ? "AugiAIs-Mini" : "AugiBot2s-Mini";
  const models: Record<string, string> = {
    Zeus: "SOL", Athena: "Kimi K3", Hermes: "SOL", Atlas: "SOL", Artemis: "Kimi K3", Chronos: "SOL", Achlys: "Kimi K3",
    Ares: "Kimi K3", Apollo: "SOL", Hephaestus: "Kimi K3", Poseidon: "SOL", Hades: "Kimi K3", Calliope: "SOL", "Book Keeper": "DeepSeek V4 Flash",
  };
  const fleetRoles: Record<string, string> = {
    Zeus: "Chief / senior reviewer", Athena: "Agent", Hermes: "Boss / coordinator",
    Atlas: "Builder", Artemis: "Builder", Chronos: "Reviewer", Achlys: "Reviewer", Augi: "OpenClaw agent",
    Ares: "Boss / coordinator", Apollo: "Builder", Hephaestus: "Builder", Poseidon: "Reviewer", Hades: "Reviewer",
    Calliope: "Baily's agent", "Book Keeper": "Book Keeper", August: "OpenClaw agent",
  };
  const pairings: Record<string, string> = {
    Atlas: "Reviewed by Achlys", Artemis: "Reviewed by Chronos", Chronos: "Reviews Artemis", Achlys: "Reviews Atlas",
    Apollo: "Reviewed by Hades", Hephaestus: "Reviewed by Poseidon", Poseidon: "Reviews Hephaestus", Hades: "Reviews Apollo",
  };
  const registered = name !== "Calliope";
  return {
    id: registered ? `db-${name.toLowerCase().replace(/\s+/g, "-")}` : "canonical:calliope",
    name,
    registered,
    status: registered ? "active" : null,
    role: registered ? "engineer" : null,
    fleetRole: fleetRoles[name],
    pairing: pairings[name] ?? null,
    title: registered ? `${name} title` : null,
    hostedBy: `${hostMachine} · under ${hostKey === "box2" ? "Ares" : hostKey === "box1" ? "Hermes" : "Zeus"}`,
    hostKey,
    hostLabel,
    hostMachine,
    hostParent: name === "Zeus" ? null : hostKey === "box2" ? "Ares" : hostKey === "box1" ? "Hermes" : "Zeus",
    framework: name === "Augi" || name === "August" ? "openclaw" : null,
    harness: name === "Augi" || name === "August" ? "OpenClaw" : null,
    relationship: name === "Calliope" ? "Baily's agent" : null,
    surfaceLinks: name === "Calliope" ? [
      { label: "Book Writing", href: "/book-writing" },
      { label: "AI Influencer Studio", href: "/image-studio" },
    ] : [],
    workspace: null,
    runtime: null,
    model: models[name] ?? null,
    modelInfo: null,
    modes: [],
    modeDefault: null,
    teamCapable: false,
    provenance: { model: "derived" },
  };
}

function fleetResult() {
  const definitions = canonicalNames.map(canonicalDefinition);
  return {
    ok: true as const,
    transport: "canonical-db",
    url: "",
    connectedAtMs: 0,
    handshakeMs: 0,
    server: { version: "canonical-roster-2026-08-04-v2", protocol: null, connId: null },
    methods: [], events: [], models: [], slashCommands: [],
    identity: { name: "Canonical Fleet", avatar: null },
    teamCapable: false,
    teamCapableReason: "Not evaluated",
    agents: definitions,
    agentCount: 16,
    rosterSource: "canonical" as const,
    provenance: { agents: "derived" as const },
    notes: { real: [], derived: [], stub: ["Calliope is not registered"] },
  };
}

function registeredOnlyFleetResult(agents: Agent[]) {
  return {
    ok: true as const,
    transport: "canonical-db" as const,
    url: "",
    agentLabel: "Canonical Fleet",
    connectedAtMs: Date.now(),
    handshakeMs: 0,
    server: { version: "registered-roster", protocol: null, connId: null },
    methods: [], events: [], models: [], slashCommands: [],
    identity: { name: "Registered agents", avatar: null },
    teamCapable: false,
    teamCapableReason: "Not evaluated",
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      registered: true,
      status: agent.status,
      role: agent.role,
      fleetRole: null,
      pairing: null,
      title: agent.title,
      hostedBy: null,
      hostKey: null,
      hostLabel: null,
      hostMachine: null,
      hostParent: null,
      framework: null,
      harness: null,
      relationship: null,
      surfaceLinks: [],
      workspace: null,
      runtime: null,
      model: null,
      capabilities: [],
      commands: [],
      channelCount: 0,
    })),
    agentCount: agents.length,
    rosterSource: "handshake" as const,
    provenance: { agents: "real" as const },
    notes: { real: ["registered-only"], derived: [], stub: [] },
  };
}

function registeredAgentsFixture() {
  return [
    ...canonicalNames.filter((name) => name !== "Calliope").map((name) => makeAgent({
      id: `db-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      urlKey: name.toLowerCase().replace(/\s+/g, "-"),
      adapterConfig: name === "Athena"
        ? { model: "SOL" }
        : name === "Atlas"
          ? { model: "DeepSeek V4 Pro" }
          : name === "Zeus"
            ? { model: "gpt-5.6-sol" }
            : {},
    })),
    makeAgent({ id: "db-baily", name: "Baily AI", urlKey: "baily-ai", adapterConfig: { model: "qwen3-vl-8b" } }),
  ];
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderAgents(container: HTMLDivElement, queryClient: QueryClient) {
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Agents /></ToastProvider>
      </QueryClientProvider>,
    );
  });
  await flushReact();
  await flushReact();
  return root;
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

    mockLocation.pathname = "/agents/all";
    mockLocation.search = "";
    mockSidebar.isMobile = false;
    const registeredAgents = registeredAgentsFixture();
    mockAgentsApi.list.mockResolvedValue(registeredAgents);
    mockAgentsApi.get.mockImplementation((id: string) => Promise.resolve(registeredAgents.find((agent) => agent.id === id)));
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
    mockHeartbeatsApi.list.mockResolvedValue([]);
    mockAcpApi.fleet.mockResolvedValue(fleetResult());
    mockCostsApi.summary.mockResolvedValue({ spendCents: 0, budgetCents: 0 });
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

  it("renders the exact canonical host groups, model overrides, and honest missing Calliope", async () => {
    root = await renderAgents(container, queryClient);

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-pp-fleet-position]"));
    expect(rows.map((row) => row.dataset.ppFleetPosition)).toEqual(canonicalNames);
    expect(container.querySelector("[data-pp-fleet-summary]")).not.toBeNull();
    expect((container.textContent?.match(/Athena/g) ?? [])).toHaveLength(1);
    expect(container.textContent).toContain("WINDOWS — ZEUS");
    expect(container.textContent).toContain("BOX 1 — HERMES");
    expect(container.textContent).toContain("BOX 2 — ARES");
    expect(container.textContent).toContain("16 Fleet positions · 1 other registered records preserved");
    expect(container.textContent).not.toContain("Opening gateway WebSocket");
    expect(container.textContent).not.toContain("hello-ok");

    const athena = container.querySelector<HTMLElement>('[data-pp-fleet-position="Athena"]')!;
    const atlas = container.querySelector<HTMLElement>('[data-pp-fleet-position="Atlas"]')!;
    expect(athena.textContent).toContain("Kimi K3");
    expect(athena.textContent).not.toContain("SOL");
    expect(atlas.textContent).toContain("SOL");
    expect(atlas.textContent).not.toContain("DeepSeek V4 Pro");
    expect(atlas.textContent).toContain("Builder · Reviewed by Achlys");
    const hephaestus = container.querySelector<HTMLElement>('[data-pp-fleet-position="Hephaestus"]')!;
    expect(hephaestus.textContent).toContain("Kimi K3");
    expect(hephaestus.textContent).toContain("Builder · Reviewed by Poseidon");

    const calliope = container.querySelector<HTMLElement>('[data-pp-fleet-position="Calliope"]')!;
    expect(calliope.textContent).toContain("Not registered");
    expect(calliope.querySelector('a[href="/book-writing"]')?.textContent).toBe("Book Writing");
    expect(calliope.querySelector('a[href="/image-studio"]')?.textContent).toBe("AI Influencer Studio");
    expect(calliope.querySelector('[aria-label="Configure agent"]')).toBeNull();
    expect(calliope.querySelector('[data-pp-fleet-pause-resume]')).toBeNull();

    const hermes = container.querySelector<HTMLElement>('[data-pp-fleet-position="Hermes"]')!;
    expect(hermes.querySelector('a[href="/agents/hermes/configuration"]')).not.toBeNull();
    await act(async () => hermes.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushReact();
    expect(container.querySelector('a[href="/agents/hermes"]')).not.toBeNull();
    expect(container.querySelector('[data-pp-fleet-position="Baily AI"]')).toBeNull();
  });

  it("preserves noncanonical registered agents in the explicit Other view", async () => {
    mockLocation.search = "?view=other";
    root = await renderAgents(container, queryClient);

    expect(container.textContent).toContain("Other registered agents");
    expect(container.textContent).toContain("Baily AI");
    expect(container.querySelector('a[href="/agents/baily-ai/configuration"]')).not.toBeNull();
    expect(container.textContent).toContain("1 registered noncanonical records preserved");
  });

  it("renders a successful registered-only response with null canonical metadata in List and Org", async () => {
    const registeredAgents = [
      makeAgent({ id: "tenant-alpha", name: "Tenant Alpha", urlKey: "tenant-alpha", title: "Coordinator" }),
      makeAgent({ id: "tenant-beta", name: "Tenant Beta", urlKey: "tenant-beta", status: "paused", title: "Reviewer" }),
    ];
    mockAgentsApi.list.mockResolvedValue(registeredAgents);
    mockAgentsApi.get.mockImplementation((id: string) => Promise.resolve(registeredAgents.find((agent) => agent.id === id)));
    mockAcpApi.fleet.mockResolvedValue(registeredOnlyFleetResult(registeredAgents));

    root = await renderAgents(container, queryClient);

    expect(container.textContent).toContain("2 registered company agents");
    expect(container.querySelector('[data-pp-fleet-row="tenant-alpha"]')).not.toBeNull();
    expect(container.querySelector('[data-pp-fleet-row="tenant-beta"]')).not.toBeNull();
    expect(container.querySelector('a[href="/agents/tenant-alpha/configuration"]')).not.toBeNull();
    expect(container.textContent).not.toContain("WINDOWS — ZEUS");

    const orgButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Org"));
    await act(async () => orgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const orgAgents = container.querySelectorAll("[data-pp-fleet-registered-org-agent]");
    expect(orgAgents).toHaveLength(2);
    await act(async () => orgAgents[0]?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushReact();
    expect(container.querySelector('a[href="/agents/tenant-alpha"]')).not.toBeNull();
  });

  it("keeps duplicate-name registered rows discoverable in Other by unmatched ID", async () => {
    mockLocation.search = "?view=other";
    const duplicateAthena = makeAgent({
      id: "db-athena-collision",
      name: "Athena",
      urlKey: "athena-collision",
      adapterConfig: { model: "legacy-collision-model" },
    });
    const agents = [...registeredAgentsFixture(), duplicateAthena];
    mockAgentsApi.list.mockResolvedValue(agents);
    mockAgentsApi.get.mockImplementation((id: string) => Promise.resolve(agents.find((agent) => agent.id === id)));

    root = await renderAgents(container, queryClient);

    expect(container.querySelector('[data-pp-fleet-row="db-athena-collision"]')).not.toBeNull();
    expect(container.querySelector('a[href="/agents/athena-collision/configuration"]')).not.toBeNull();
    expect(container.textContent).toContain("2 registered noncanonical records preserved");
  });

  it("keeps every registered record reachable when the canonical route returns ok false", async () => {
    mockAcpApi.fleet.mockResolvedValue({
      ok: false,
      agentLabel: "Canonical Fleet",
      url: "",
      error: "roster read failed",
      stage: "roster",
    });
    root = await renderAgents(container, queryClient);

    expect(container.textContent).toContain("Could not load the canonical Fleet: roster read failed");
    expect(container.querySelector("[data-pp-fleet-fallback]")).not.toBeNull();
    expect(container.textContent).toContain("All 16 registered records remain reachable");
    expect(container.querySelector('[data-pp-fleet-row="db-baily"]')).not.toBeNull();
    expect(container.querySelector('a[href="/agents/baily-ai/configuration"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Canonical Fleet definitions are unavailable and no registered agents were returned");
  });

  it("groups all 16 canonical positions in the org view without making Calliope operational", async () => {
    root = await renderAgents(container, queryClient);
    const orgButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Org"));
    await act(async () => orgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.querySelectorAll("[data-pp-fleet-org-position]")).toHaveLength(16);
    const calliope = container.querySelector<HTMLElement>('[data-pp-fleet-org-position="Calliope"]')!;
    expect(calliope.tagName).toBe("DIV");
    expect(calliope.textContent).toContain("Not registered");
    expect(calliope.querySelector('a[href="/book-writing"]')).not.toBeNull();
  });

  it("keeps phone Fleet controls reachable and opens and closes the agent drawer", async () => {
    mockSidebar.isMobile = true;
    root = await renderAgents(container, queryClient);

    const page = container.querySelector<HTMLElement>('[data-pp-page-v2="fleet"]')!;
    expect(page.className).toContain("p-4");
    expect(page.className).toContain("sm:p-8");

    const newAgent = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("New Agent"))!;
    expect(newAgent.className).toContain("min-h-11");
    await act(async () => newAgent.click());
    expect(mockOpenNewAgent).toHaveBeenCalledOnce();

    const athena = container.querySelector<HTMLElement>('[data-pp-fleet-position="Athena"]')!;
    expect(athena.className).toContain("grid-cols-[1fr_auto]");
    expect(athena.className).toContain("lg:grid-cols-[minmax(200px,1.5fr)_130px_minmax(150px,1.4fr)_150px_84px_96px_84px]");
    expect(athena.className).not.toContain(" grid-cols-[minmax(200px,1.5fr)");
    const canonicalConfigure = athena.querySelector<HTMLAnchorElement>('a[aria-label="Configure agent"]')!;
    expect(canonicalConfigure.className).toContain("h-11");
    expect(canonicalConfigure.className).toContain("sm:h-8");
    await act(async () => athena.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await flushReact();
    const drawer = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(drawer.className).toContain("w-full");
    const close = drawer.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close.className).toContain("h-11");
    await act(async () => close.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    mockLocation.search = "?view=other";
    await act(async () => root?.unmount());
    root = await renderAgents(container, queryClient);
    const otherRow = container.querySelector<HTMLElement>('[data-pp-fleet-row="db-baily"]')!;
    expect(otherRow.className).toContain("grid-cols-[1fr_auto]");
    expect(otherRow.className).toContain("lg:grid-cols-[minmax(200px,1.5fr)_130px_minmax(150px,1.4fr)_150px_84px_96px_84px]");
    const otherConfigure = otherRow.querySelector<HTMLAnchorElement>('a[aria-label="Configure agent"]')!;
    expect(otherConfigure.className).toContain("w-11");
    expect(otherConfigure.getAttribute("href")).toBe("/agents/baily-ai/configuration");
    await act(async () => otherRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await flushReact();
    expect(container.querySelector('[role="dialog"] a[href="/agents/baily-ai"]')).not.toBeNull();
  });
});

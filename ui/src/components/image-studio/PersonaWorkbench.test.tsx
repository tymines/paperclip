// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ImageProvider } from "@/api/imageStudio";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { id: "company-1" } }),
}));
vi.mock("./StructuredControlPanel", () => ({ StructuredControlPanel: () => null }));
vi.mock("./PromptPreview", () => ({ PromptPreview: () => null }));
vi.mock("./ModelPicker", () => ({
  ModelPicker: ({ value }: { value: string }) => <span data-testid="model-value">{value}</span>,
}));
vi.mock("./TemplateLibraryTab", () => ({ TemplateLibraryTab: () => null }));
vi.mock("./PhotoShootCategoryGrid", () => ({
  PhotoShootCategoryGrid: ({ initialTemplate }: { initialTemplate?: { id: string } | null }) => (
    <span data-testid="photoshoot-template-state">{initialTemplate?.id ?? "none"}</span>
  ),
}));
vi.mock("./UndresserInline", () => ({
  UndresserInline: ({ models, capabilitiesLoading }: { models?: unknown[]; capabilitiesLoading?: boolean }) => (
    <span data-testid="undresser-capabilities">
      {Array.isArray(models) && capabilitiesLoading === false ? "capabilities-provided" : "capabilities-missing"}
    </span>
  ),
}));
vi.mock("./UnifiedLibrary", () => ({
  UnifiedLibrary: ({ onApply }: { onApply: (template: unknown, apply: unknown) => void }) => (
    <button
      type="button"
      data-testid="mock-library-apply"
      onClick={() => onApply({ id: "carnival-template", name: "Carnival" }, { tool: "photoshoot" })}
    >
      Apply Carnival
    </button>
  ),
}));

const apiMocks = vi.hoisted(() => ({
  getAttributeControls: vi.fn(async () => ({ controls: [] })),
  getCapabilities: vi.fn(async (_companyId: string, _personaId: string) => ({
    generatedAt: "2026-08-06T20:30:00.000Z",
    providers: [],
    capabilities: [],
  })),
}));

vi.mock("@/api/imageStudio", async () => {
  const actual = await vi.importActual<typeof import("@/api/imageStudio")>("@/api/imageStudio");
  return {
    ...actual,
    imageStudioApi: {
      ...actual.imageStudioApi,
      getAttributeControls: apiMocks.getAttributeControls,
      getCapabilities: apiMocks.getCapabilities,
    },
  };
});

import { PersonaWorkbench } from "./PersonaWorkbench";

function persona(id: string): ImageProvider {
  return {
    id,
    companyId: "company-1",
    name: id,
    type: "local_lora",
    providerKey: null,
    endpoint: null,
    model: null,
    defaultParams: null,
    bio: null,
    attributes: null,
    costPerUnit: "0",
    status: null,
    statusDetail: null,
    trainingCapable: false,
    trainingModel: null,
    sortOrder: 0,
    groupId: null,
    avatarPath: null,
    isFavorite: false,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.clearAllMocks();
});

it("clears transient Generate state when the selected persona changes", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const renderPersona = (value: ImageProvider) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PersonaWorkbench persona={value} onBatchStarted={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>
  );

  await act(async () => root.render(renderPersona(persona("persona-a"))));
  const freeText = container.querySelector<HTMLTextAreaElement>("[data-testid='free-text']");
  expect(freeText).not.toBeNull();
  await act(async () => {
    if (!freeText) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(freeText, "state belonging to persona A");
    freeText.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(freeText?.value).toBe("state belonging to persona A");

  await act(async () => root.render(renderPersona(persona("persona-b"))));
  const nextFreeText = container.querySelector<HTMLTextAreaElement>("[data-testid='free-text']");
  expect(nextFreeText?.value).toBe("");
  expect(nextFreeText).not.toBe(freeText);

  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

it("shares the loaded capability result with the Undresser workspace", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <PersonaWorkbench persona={persona("persona-a")} onBatchStarted={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="tab-undresser"]')!.click();
  });

  expect(container.querySelector('[data-testid="undresser-capabilities"]')?.textContent)
    .toBe("capabilities-provided");

  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

it("hands a library PhotoShoot template to the matching workspace without firing generation", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <PersonaWorkbench persona={persona("persona-a")} onBatchStarted={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="tab-library"]')!.click();
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="mock-library-apply"]')!.click();
  });

  expect(container.querySelector('[data-testid="tab-photoshoot"]')?.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector('[data-testid="photoshoot-template-state"]')?.textContent).toBe("carnival-template");
  expect(container.querySelector('[data-testid="library-notice"]')?.textContent).toContain(
    "Loaded \"Carnival\" with 5 images",
  );

  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

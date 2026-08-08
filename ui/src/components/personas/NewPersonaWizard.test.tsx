// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  createPersona: vi.fn(),
  deleteProvider: vi.fn(),
  getAttributeControls: vi.fn(async () => ({ controls: [] })),
  listTrainers: vi.fn(async () => ({ providers: [] })),
  updatePersona: vi.fn(),
  trainPersona: vi.fn(),
  uploadImage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "AUG" },
  }),
}));

vi.mock("@/lib/router", () => ({ useNavigate: () => apiMocks.navigate }));

vi.mock("@/api/imageStudio", async () => {
  const actual = await vi.importActual<typeof import("@/api/imageStudio")>("@/api/imageStudio");
  return {
    ...actual,
    imageStudioApi: {
      ...actual.imageStudioApi,
      createPersona: apiMocks.createPersona,
      deleteProvider: apiMocks.deleteProvider,
      getAttributeControls: apiMocks.getAttributeControls,
      listTrainers: apiMocks.listTrainers,
      updatePersona: apiMocks.updatePersona,
      trainPersona: apiMocks.trainPersona,
    },
  };
});

vi.mock("@/api/assets", () => ({ assetsApi: { uploadImage: apiMocks.uploadImage } }));

import { NewPersonaWizard } from "./NewPersonaWizard";

function setNativeValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("NewPersonaWizard draft lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    onOpenChange = vi.fn();
    apiMocks.createPersona.mockResolvedValue({ provider: { id: "draft-persona-1" } });
    apiMocks.deleteProvider.mockResolvedValue({ provider: { id: "draft-persona-1" } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderWizard() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <NewPersonaWizard open onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  async function createDraft() {
    const name = document.querySelector<HTMLInputElement>('[data-testid="np-name"]')!;
    await act(async () => setNativeValue(name, "QA Persona"));
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="np-next"]')!.click();
    });
    await flushReact();
    expect(apiMocks.createPersona).toHaveBeenCalledTimes(1);
  }

  it("discards an empty draft when the user backs out", async () => {
    await renderWizard();
    await createDraft();

    const footerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    await act(async () => footerButtons.find((button) => button.textContent?.trim() === "Back")!.click());
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Cancel")!
        .click();
    });
    await flushReact();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apiMocks.deleteProvider).toHaveBeenCalledTimes(1);
    expect(apiMocks.deleteProvider).toHaveBeenCalledWith("company-1", "draft-persona-1");
  });

  it("preserves exactly one explicit save-for-later draft", async () => {
    await renderWizard();
    await createDraft();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="np-skip"]')!.click();
    });
    await flushReact();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apiMocks.deleteProvider).not.toHaveBeenCalled();
  });

  it("does not allow training progress without an uploaded photo", async () => {
    await renderWizard();
    await createDraft();

    const continueButton = document.querySelector<HTMLButtonElement>('[data-testid="np-continue"]')!;
    expect(continueButton.disabled).toBe(true);
    expect(continueButton.title).toContain("at least one training photo");
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageProvider, PromptTemplate } from "@/api/imageStudio";
import { PhotoShootCategoryGrid } from "./PhotoShootCategoryGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  listPromptTemplates: vi.fn(),
  batchGenerate: vi.fn(),
}));

vi.mock("@/api/imageStudio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/imageStudio")>();
  return {
    ...actual,
    imageStudioApi: {
      ...actual.imageStudioApi,
      listPromptTemplates: apiMocks.listPromptTemplates,
      batchGenerate: apiMocks.batchGenerate,
    },
  };
});

const carnival = {
  id: "carnival-template",
  name: "Carnival",
  description: "Carnival portrait",
  attributePreset: { setting: "carnival" },
  applicableTools: ["photoshoot"],
  compatibleModels: ["persona-lora"],
  contentRating: "sfw",
  genderTargeting: "any",
  previewImagePath: null,
  previewImagePaths: [],
  category: "photoshoot",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as PromptTemplate;

const persona = {
  id: "persona-1",
  companyId: "company-1",
  name: "Sidney SFW",
} as ImageProvider;

describe("PhotoShootCategoryGrid template handoff", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    client?.clear();
    container?.remove();
    apiMocks.listPromptTemplates.mockReset();
    apiMocks.batchGenerate.mockReset();
  });

  it("preselects five images without submitting paid generation", async () => {
    apiMocks.listPromptTemplates.mockResolvedValue({ templates: [carnival] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <PhotoShootCategoryGrid
            persona={persona}
            showExplicit={false}
            gender="female"
            onBatchStarted={() => {}}
            initialTemplate={{ id: carnival.id, requestId: 1 }}
          />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const five = container.querySelector<HTMLButtonElement>(
      '[data-testid="photoshoot-qty-carnival-template-5"]',
    )!;
    expect(five.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="photoshoot-total"]')?.textContent).toContain("5 images");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="photoshoot-fire"]')!.disabled).toBe(false);
    expect(apiMocks.batchGenerate).not.toHaveBeenCalled();
  });
});

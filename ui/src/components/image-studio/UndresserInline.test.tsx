// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageProvider } from "@/api/imageStudio";
import { UndresserInline } from "./UndresserInline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  generate: vi.fn(),
}));

vi.mock("@/api/imageStudio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/imageStudio")>();
  return {
    ...actual,
    imageStudioApi: {
      ...actual.imageStudioApi,
      femaleUndresserGenerate: apiMocks.generate,
    },
  };
});

vi.mock("./ModelPicker", () => ({
  ModelPicker: ({ models, loading }: { models?: unknown[]; loading?: boolean }) => (
    <span data-testid="model-picker-state">
      {Array.isArray(models) && !loading ? `${models.length} ready` : "not ready"}
    </span>
  ),
}));

function persona(configured: boolean): ImageProvider {
  return {
    id: "persona-1",
    companyId: "company-1",
    name: "Sidney SFW",
    type: "local_lora",
    providerHost: "replicate",
    endpoint: null,
    model: "tymines/sidney-sfw",
    status: "ready",
    statusDetail: null,
    costPerImage: null,
    defaultParams: configured ? { undresser_model: "provider/approved-model" } : {},
    sortOrder: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  } as ImageProvider;
}

const models = [
  {
    id: "replicate-flux",
    name: "Replicate Flux",
    provider: "replicate",
    kind: "image" as const,
    enabled: true,
    recommended: true,
    disabledReason: null,
  },
];

describe("UndresserInline", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    client?.clear();
    container?.remove();
    apiMocks.generate.mockReset();
    localStorage.clear();
  });

  async function render(configured: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <UndresserInline
            persona={persona(configured)}
            showExplicit={false}
            models={models}
            providers={[]}
            capabilitiesLoading={false}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("shows loaded capabilities but keeps generation disabled without approved config", async () => {
    await render(false);
    expect(container.querySelector('[data-testid="model-picker-state"]')?.textContent).toBe("1 ready");
    expect(container.textContent).toContain("not configured for this persona");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="undresser-generate"]')!.disabled)
      .toBe(true);
  });

  it("submits the selected file bytes once the persona route is configured", async () => {
    apiMocks.generate.mockResolvedValue({ status: "submitted", message: "Submitted" });
    await render(true);

    const file = new File(["image-bytes"], "source.png", { type: "image/png" });
    const input = container.querySelector<HTMLInputElement>('[data-testid="undresser-source"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));

    const button = container.querySelector<HTMLButtonElement>('[data-testid="undresser-generate"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(apiMocks.generate).toHaveBeenCalledTimes(1);
    expect(apiMocks.generate.mock.calls[0]?.[0]).toMatchObject({
      persona_id: "persona-1",
      source_file: "source.png",
      count: 1,
      content_rating: "sfw",
    });
    expect(apiMocks.generate.mock.calls[0]?.[0]?.source_image).toMatch(/^data:image\/png;base64,/);
  });
});

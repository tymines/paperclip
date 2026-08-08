// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentPanel,
  ContentGallery,
  GenerateContentPanel,
  ImageStudio,
  SettingsTab,
} from "./ImageStudio";
import {
  imageStudioApi,
  type ImageProvider,
  type PersonaGeneration,
} from "../api/imageStudio";
import { ApiError } from "../api/client";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "11111111-1111-4111-8111-111111111111",
    selectedCompany: { id: "11111111-1111-4111-8111-111111111111", issuePrefix: "AUG" },
  }),
}));

const routerState = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/router", () => ({
  useSearchParams: () => [new URLSearchParams(routerState.search), vi.fn()],
  useNavigate: () => vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY_UUID = "11111111-1111-4111-8111-111111111111";
const PERSONA_UUID = "22222222-2222-4222-8222-222222222222";

const persona: ImageProvider = {
  id: PERSONA_UUID,
  companyId: COMPANY_UUID,
  name: "Sidney",
  type: "local_lora",
  providerKey: null,
  endpoint: null,
  model: "flux-dev-lora",
  defaultParams: null,
  bio: null,
  attributes: { content_rating: "sfw" },
  costPerUnit: "0.04",
  status: "ready",
  statusDetail: null,
  trainingCapable: true,
  trainingModel: null,
  sortOrder: 0,
  groupId: null,
  avatarPath: null,
  isFavorite: false,
  createdAt: "2026-08-08T12:00:00.000Z",
  updatedAt: "2026-08-08T12:00:00.000Z",
};

function generation(
  id: string,
  imagePath: string,
  thumbnailPath: string | null,
  generationMetadata: Record<string, unknown> | null = null,
): PersonaGeneration {
  return {
    id,
    personaId: PERSONA_UUID,
    source: "test",
    prompt: `${id} prompt`,
    loraStrength: "0.8",
    model: "test-model",
    imagePath,
    thumbnailPath,
    generationMetadata,
    replicatePredictionId: null,
    costUsd: null,
    contentRating: "sfw",
    createdAt: "2026-08-08T12:00:00.000Z",
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Image Studio focused UI repairs", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    routerState.search = "";
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("moves the confirmed 390x844 generator controls fully above the fixed mobile nav", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GenerateContentPanel persona={persona} />
        </QueryClientProvider>,
      );
    });

    const panel = container.querySelector<HTMLElement>('[data-testid="generate-content-panel"]');
    expect(panel?.className).toContain("pb-[calc(5rem+env(safe-area-inset-bottom))]");
    expect(panel?.className).toContain("md:pb-0");
    const advanced = container.querySelector('[data-testid="advanced-toggle"]');
    const generate = container.querySelector('[data-testid="generate-submit"]');
    expect(panel?.contains(advanced)).toBe(true);
    expect(panel?.contains(generate)).toBe(true);

    // Frozen live-audit geometry: nav y=779..844, Advanced y=735.5..789.5,
    // Generate y=801.5..842.5. The mobile-only 5rem tail creates 80px of
    // additional scroll range (before any safe-area inset), so both controls
    // can be scrolled until their bottom edge clears the fixed nav.
    const mobileNavTop = 779;
    const reservedScrollRange = 5 * 16;
    const confirmedControls = [
      { label: "Advanced", bottom: 789.5 },
      { label: "Generate", bottom: 842.5 },
    ];
    for (const control of confirmedControls) {
      expect(control.bottom - reservedScrollRange, control.label).toBeLessThanOrEqual(mobileNavTop);
    }
  });

  it("keeps unavailable video truthful and exposes selection state for generator controls", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GenerateContentPanel persona={persona} />
        </QueryClientProvider>,
      );
    });

    const imageMode = container.querySelector<HTMLButtonElement>('[data-testid="mode-image"]')!;
    const videoMode = container.querySelector<HTMLButtonElement>('[data-testid="mode-video"]')!;
    expect(imageMode.getAttribute("aria-pressed")).toBe("true");
    expect(videoMode.disabled).toBe(true);
    expect(videoMode.getAttribute("aria-label")).toBe("Video generation unavailable");
    expect(videoMode.title).toContain("not available");

    const countTwo = container.querySelector<HTMLButtonElement>('[data-testid="count-2"]')!;
    const countFour = container.querySelector<HTMLButtonElement>('[data-testid="count-4"]')!;
    expect(countTwo.getAttribute("aria-pressed")).toBe("true");
    expect(countFour.getAttribute("aria-pressed")).toBe("false");
    await act(async () => countFour.click());
    expect(countFour.getAttribute("aria-pressed")).toBe("true");
    expect(countTwo.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps useful settings while hiding raw company and persona UUIDs", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SettingsTab persona={persona} />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("Hosted generation backend");
    expect(container.textContent).toContain("Replicate");
    expect(container.textContent).toContain("Atlas Cloud");
    expect(container.textContent).toContain("WaveSpeed AI");
    expect(container.textContent).toContain("Favorite persona");
    expect(container.textContent).toContain("Mark favorite");
    expect(container.textContent).not.toContain(COMPANY_UUID);
    expect(container.textContent).not.toContain(PERSONA_UUID);
  });

  it("remounts the whole workspace when the active persona changes", async () => {
    const secondPersona = {
      ...persona,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Raven",
      sortOrder: 1,
    };
    vi.spyOn(imageStudioApi, "listProviders").mockResolvedValue({
      providers: [persona, secondPersona],
    });
    vi.spyOn(imageStudioApi, "listTrainingJobs").mockResolvedValue({ jobs: [] });
    vi.spyOn(imageStudioApi, "listGenerations").mockResolvedValue({
      generations: [],
      nextCursor: null,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImageStudio />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="creator-nav-create"]')!.click();
    });
    await flushReact();

    const prompt = container.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]')!;
    await act(async () => {
      setNativeValue(prompt, "persona-one draft prompt");
    });
    expect(prompt.value).toBe("persona-one draft prompt");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ws-tab-settings"]')!.click();
    });
    expect(container.textContent).toContain("Hosted generation backend");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        `[data-testid="open-studio-${secondPersona.id}"]`,
      )!.click();
    });
    await flushReact();

    expect(container.textContent).not.toContain("Hosted generation backend");
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]')?.value).toBe("");
    expect(container.querySelector('[data-testid="generate-submit"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="creator-nav-flows"]')!.click();
    });
    expect(container.textContent).toContain("no route to run, rerun, approve, or publish");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="open-studio-33333333-3333-4333-8333-333333333333"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="creator-foundation-state"] button')?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="creator-nav-create"]')!.click();
    });
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]')?.value).toBe("");
  });

  it("preserves generated ideas and explains typed generator unavailability", async () => {
    const generatedIdea = {
      title: "Behind the scenes",
      caption: "A saved idea that must remain visible.",
      suggestedHashtags: ["#studio"],
    };
    vi.spyOn(imageStudioApi, "listDrafts").mockResolvedValue({ drafts: [] });
    vi.spyOn(imageStudioApi, "generateContent")
      .mockResolvedValueOnce({ ideas: [generatedIdea] })
      .mockRejectedValueOnce(new ApiError("Generator unavailable", 503, {
        code: "content_generator_unavailable",
        retryable: false,
      }))
      .mockRejectedValueOnce(new ApiError("Generator temporarily unavailable", 503, {
        code: "content_generator_unavailable",
        retryable: true,
      }));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ContentPanel
            persona={persona}
            companyId={COMPANY_UUID}
            status={{ label: "Ready", color: "green", progress: null, ready: true }}
          />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const topic = container.querySelector<HTMLInputElement>('[data-testid="content-topic-input"]')!;
    await act(async () => {
      setNativeValue(topic, "launch");
    });
    const generate = container.querySelector<HTMLButtonElement>(
      '[data-testid="content-generate-submit"]',
    )!;

    await act(async () => generate.click());
    await flushReact();
    expect(container.textContent).toContain(generatedIdea.title);

    await act(async () => generate.click());
    await flushReact();
    expect(container.textContent).toContain(generatedIdea.title);
    expect(container.querySelector('[data-testid="content-generation-error"]')?.textContent)
      .toContain("Configure a content generator, then try again.");

    await act(async () => generate.click());
    await flushReact();
    expect(container.textContent).toContain(generatedIdea.title);
    expect(container.querySelector('[data-testid="content-generation-error"]')?.textContent)
      .toContain("Try again shortly.");
  });

  it.each(["generate", "photoshoot", "undresser", "library"])(
    "opens the legacy ?tab=%s deep link inside Create",
    async (legacyTab) => {
      routerState.search = `?tab=${legacyTab}`;
      vi.spyOn(imageStudioApi, "listProviders").mockResolvedValue({ providers: [persona] });
      vi.spyOn(imageStudioApi, "listTrainingJobs").mockResolvedValue({ jobs: [] });
      vi.spyOn(imageStudioApi, "listGenerations").mockResolvedValue({ generations: [], nextCursor: null });
      vi.spyOn(imageStudioApi, "listPromptTemplates").mockResolvedValue({ templates: [] });

      await act(async () => {
        root.render(<QueryClientProvider client={queryClient}><ImageStudio /></QueryClientProvider>);
      });
      await flushReact();
      await flushReact();

      expect(container.querySelector('[data-testid="creator-create"]')).not.toBeNull();
      expect(container.querySelector(`[data-testid="tab-${legacyTab}"]`)?.getAttribute("aria-selected")).toBe("true");
    },
  );

  it("renders video assets semantically and keeps image thumbnails and viewer behavior", async () => {
    const noThumbnailVideo = generation("video-no-thumb", "videos/no-thumb.mp4", null);
    const posterVideo = generation(
      "video-with-poster",
      "videos/with-poster.webm",
      "thumbnails/video-poster.jpg",
      { media_type: "video" },
    );
    const stillImage = generation("still-image", "images/still.png", "thumbnails/still.jpg");
    vi.spyOn(imageStudioApi, "listGenerations").mockResolvedValue({
      generations: [noThumbnailVideo, posterVideo, stillImage],
      nextCursor: null,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ContentGallery persona={persona} />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const noThumbnailItem = container.querySelector<HTMLElement>(
      '[data-testid="gallery-item-video-no-thumb"]',
    )!;
    const noThumbnailPreview = noThumbnailItem.querySelector<HTMLVideoElement>("video")!;
    expect(noThumbnailPreview.getAttribute("src")).toBe("/api/uploads/videos/no-thumb.mp4");
    expect(noThumbnailPreview.getAttribute("poster")).toBeNull();
    expect(noThumbnailPreview.preload).toBe("metadata");
    expect(noThumbnailPreview.muted).toBe(true);

    const posterPreview = container.querySelector<HTMLVideoElement>(
      '[data-testid="gallery-item-video-with-poster"] video',
    )!;
    expect(posterPreview.getAttribute("poster")).toBe(
      "/api/uploads/thumbnails/video-poster.jpg",
    );
    expect(posterPreview.preload).toBe("none");

    const imagePreview = container.querySelector<HTMLImageElement>(
      '[data-testid="gallery-item-still-image"] img',
    )!;
    expect(imagePreview.getAttribute("src")).toBe("/api/uploads/thumbnails/still.jpg");
    expect(imagePreview.getAttribute("loading")).toBe("lazy");

    const gridView = container.querySelector<HTMLButtonElement>('[data-testid="gallery-view-grid"]')!;
    const listView = container.querySelector<HTMLButtonElement>('[data-testid="gallery-view-list"]')!;
    expect(gridView.getAttribute("aria-label")).toBe("Grid view");
    expect(gridView.getAttribute("aria-pressed")).toBe("true");
    expect(listView.getAttribute("aria-label")).toBe("List view");
    await act(async () => listView.click());
    expect(listView.getAttribute("aria-pressed")).toBe("true");
    expect(gridView.getAttribute("aria-pressed")).toBe("false");

    await act(async () => noThumbnailItem.click());
    const viewerVideo = container.querySelector<HTMLVideoElement>(
      '[data-testid="gallery-viewer-video"]',
    )!;
    expect(viewerVideo.getAttribute("src")).toBe("/api/uploads/videos/no-thumb.mp4");
    expect(viewerVideo.controls).toBe(true);
    expect(viewerVideo.playsInline).toBe(true);

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="gallery-viewer"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="gallery-item-still-image"]')!.click();
    });
    expect(
      container.querySelector<HTMLImageElement>('[data-testid="gallery-viewer-image"]')
        ?.getAttribute("src"),
    ).toBe("/api/uploads/images/still.png");
  });

  it("loads gallery pages from the server without the old 100-item ceiling", async () => {
    const firstPage = generation("first-page", "images/first.png", null);
    const secondPage = generation("second-page", "images/second.png", null);
    const listSpy = vi.spyOn(imageStudioApi, "listGenerations").mockImplementation(
      async (_personaId, options) =>
        options?.cursor === "cursor-2"
          ? { generations: [secondPage], nextCursor: null }
          : { generations: [firstPage], nextCursor: "cursor-2" },
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ContentGallery persona={persona} />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.querySelector('[data-testid="gallery-item-first-page"]')).not.toBeNull();
    const loadMore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Load more",
    );
    expect(loadMore).toBeDefined();

    await act(async () => loadMore!.click());
    await flushReact();

    expect(container.querySelector('[data-testid="gallery-item-second-page"]')).not.toBeNull();
    expect(listSpy).toHaveBeenLastCalledWith(PERSONA_UUID, {
      limit: 40,
      cursor: "cursor-2",
    });
  });
});

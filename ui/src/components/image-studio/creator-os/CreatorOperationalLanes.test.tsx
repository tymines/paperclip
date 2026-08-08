// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";

const apiMocks = vi.hoisted(() => ({
  listFlows: vi.fn(),
  listRuns: vi.fn(),
  runFlow: vi.fn(),
  retryStep: vi.fn(),
  createFlow: vi.fn(),
  updateFlow: vi.fn(),
  archiveFlow: vi.fn(),
  listCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  archiveCampaign: vi.fn(),
  addCampaignItem: vi.fn(),
  listSources: vi.fn(),
  listReviews: vi.fn(),
  createReview: vi.fn(),
  decideReview: vi.fn(),
  rereview: vi.fn(),
  handoff: vi.fn(),
  getSocial: vi.fn(),
  schedule: vi.fn(),
}));
const imageApiMocks = vi.hoisted(() => ({ getCapabilities: vi.fn() }));

vi.mock("@/api/creatorOs", () => ({
  creatorOsApi: apiMocks,
}));
vi.mock("@/api/imageStudio", () => ({ imageStudioApi: imageApiMocks }));

import { CreatorOperationalLanes } from "./CreatorOperationalLanes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("CreatorOperationalLanes", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.listRuns.mockResolvedValue({ runs: [] });
    imageApiMocks.getCapabilities.mockResolvedValue({ generationWorker: { enabled: true, disabledReason: null }, providers: [], capabilities: [{
      id: "general", providerHost: "replicate", providerName: "Replicate", providerColor: "#000", nativeModel: null,
      name: "Persona LoRA", mediaKind: "image", supportsLora: true, identityMethod: "trained_persona_identity",
      requiredInputs: ["prompt", "trained_persona"], configured: true, credentialVerified: true, catalogAvailable: true,
      readiness: "credential_verified", enabled: true, disabledReason: null, recommended: true, providerFeatured: true,
      priceEstimate: { amountUsd: 0, unit: "image", source: "provider_adapter_catalog", observedAt: new Date().toISOString() },
    }] });
    apiMocks.runFlow.mockResolvedValue({ run: { id: "run-1" } });
    apiMocks.listCampaigns.mockResolvedValue({ campaigns: [] });
    apiMocks.listSources.mockResolvedValue({ sources: [] });
    apiMocks.listReviews.mockResolvedValue({ reviews: [] });
    apiMocks.getSocial.mockResolvedValue({ accounts: [], drafts: [] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a truthful zero state when no durable flows exist", async () => {
    apiMocks.listFlows.mockResolvedValue({ flows: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="flows" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    expect(container.textContent).toContain("No flows yet");
    expect(container.textContent).toContain("Saving never generates");
    expect(apiMocks.runFlow).not.toHaveBeenCalled();
  });

  it("distinguishes unauthorized lane access from an empty result", async () => {
    apiMocks.listFlows.mockRejectedValue(new ApiError("Forbidden", 403, null));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="flows" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    expect(container.textContent).toContain("not authorized");
    expect(container.textContent).not.toContain("No flows yet");
  });

  it("requires explicit confirmation before starting a paid flow run", async () => {
    apiMocks.listFlows.mockResolvedValue({ flows: [{
      id: "flow-1", companyId: "company-1", personaId: "persona-1", name: "Launch", description: null,
      status: "active", createdBy: "board", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: [{ id: "step-1", flowId: "flow-1", position: 0, name: "Hero", config: { prompt: "hero" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="flows" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Run"));
    expect(run).toBeTruthy();
    await act(async () => run!.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(apiMocks.runFlow).not.toHaveBeenCalled();
  });

  it("disables Run and Retry and visibly explains server-owned worker unavailability", async () => {
    const reason = "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled.";
    imageApiMocks.getCapabilities.mockResolvedValue({ generationWorker: { enabled: false, disabledReason: reason }, providers: [], capabilities: [{
      id: "general", providerHost: "replicate", providerName: "Replicate", providerColor: "#000", nativeModel: null,
      name: "Persona LoRA", mediaKind: "image", supportsLora: true, identityMethod: "trained_persona_identity",
      requiredInputs: ["prompt", "trained_persona"], configured: true, credentialVerified: true, catalogAvailable: true,
      readiness: "credential_verified", enabled: true, disabledReason: null, recommended: true, providerFeatured: true,
      priceEstimate: { amountUsd: 0, unit: "image", source: "provider_adapter_catalog", observedAt: new Date().toISOString() },
    }] });
    apiMocks.listFlows.mockResolvedValue({ flows: [{
      id: "flow-1", companyId: "company-1", personaId: "persona-1", name: "Launch", description: null,
      status: "active", createdBy: "board", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: [{ id: "step-1", flowId: "flow-1", position: 0, name: "Hero", config: { prompt: "hero" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }] });
    apiMocks.listRuns.mockResolvedValue({ runs: [{
      id: "run-1", companyId: "company-1", personaId: "persona-1", flowId: "flow-1", status: "failed", idempotencyKey: "run-key", createdBy: "board", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), errorMessage: "failed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: [{ id: "attempt-1", runId: "run-1", flowStepId: "step-1", stepName: "Hero", configSnapshot: { prompt: "hero" }, position: 0, attempt: 1, status: "failed", generationJobId: "job-1", retryIdempotencyKey: null, errorMessage: "failed", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retryEligible: true }],
    }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="flows" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    await settle();
    expect(container.textContent).toContain(reason);
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Run"))!;
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Retry Hero"]')!;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe(reason);
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe(reason);
    await act(async () => { run.click(); retry.click(); });
    expect(apiMocks.runFlow).not.toHaveBeenCalled();
    expect(apiMocks.retryStep).not.toHaveBeenCalled();
  });

  it("edits the complete ordered flow step collection without dropping configuration", async () => {
    apiMocks.listFlows.mockResolvedValue({ flows: [{
      id: "flow-1", companyId: "company-1", personaId: "persona-1", name: "Launch", description: null,
      status: "active", createdBy: "board", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: [
        { id: "step-1", flowId: "flow-1", position: 0, name: "Hero", config: { prompt: "hero", providerHost: "replicate", aspectRatio: "1:1" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "step-2", flowId: "flow-1", position: 1, name: "Detail", config: { prompt: "detail", providerHost: "atlascloud", model: "atlas-image", guidance: 4 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    }] });
    apiMocks.updateFlow.mockResolvedValue({ flow: { id: "flow-1" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="flows" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit")!.click());
    expect(container.querySelectorAll('input[aria-label$="prompt"]')).toHaveLength(2);
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Save edit")!.click());
    await settle();
    expect(apiMocks.updateFlow).toHaveBeenCalledWith("company-1", "flow-1", {
      name: "Launch",
      steps: [
        { name: "Hero", config: { prompt: "hero", providerHost: "replicate", aspectRatio: "1:1" } },
        { name: "Detail", config: { prompt: "detail", providerHost: "atlascloud", model: "atlas-image", guidance: 4 } },
      ],
    });
  });

  it("links an existing record into a campaign without copying it", async () => {
    apiMocks.listCampaigns.mockResolvedValue({ campaigns: [{
      id: "campaign-1", companyId: "company-1", personaId: "persona-1", name: "Launch", description: null,
      channels: ["instagram"], status: "draft", createdBy: "board", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [],
    }] });
    apiMocks.listSources.mockResolvedValue({ sources: [{
      id: "11111111-1111-4111-8111-111111111111", kind: "generation", label: "Launch hero", detail: "production generation", reviewEligible: true,
      preview: { mediaUrl: "/hero.png", content: "Hero prompt" },
    }] });
    apiMocks.addCampaignItem.mockResolvedValue({ item: { id: "item-1" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="campaigns" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    const reference = container.querySelector<HTMLSelectElement>('select[aria-label="Visible content for Launch"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(reference, "generation:11111111-1111-4111-8111-111111111111");
      reference.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Launch hero");
    expect(container.querySelector('[data-testid="selected-content-preview"]')).toBeTruthy();
    const link = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add to campaign")!;
    await act(async () => link.click());
    expect(apiMocks.addCampaignItem).toHaveBeenCalledWith("company-1", "campaign-1", { kind: "generation", referenceId: "11111111-1111-4111-8111-111111111111" });
  });

  it("requests review from a visible human-labelled source without exposing a UUID input", async () => {
    apiMocks.listSources.mockResolvedValue({ sources: [{
      id: "22222222-2222-4222-8222-222222222222", kind: "asset", label: "Final cover.png", detail: "image/png", reviewEligible: true,
      preview: { mediaUrl: "/cover.png", content: null },
    }] });
    apiMocks.createReview.mockResolvedValue({ review: { id: "review-1" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="review" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    expect(container.querySelector('input[aria-label="Review source ID"]')).toBeNull();
    const source = container.querySelector<HTMLSelectElement>('select[aria-label="Visible content for review"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(source, "asset:22222222-2222-4222-8222-222222222222");
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Request review")!.click());
    await settle();
    expect(apiMocks.createReview).toHaveBeenCalledWith("company-1", { personaId: "persona-1", sourceType: "asset", sourceId: "22222222-2222-4222-8222-222222222222" });
  });

  it("shows the server-owned reconnect reason and excludes tokenless Social accounts", async () => {
    apiMocks.getSocial.mockResolvedValue({ accounts: [{
      id: "account-1", companyId: "company-1", platform: "instagram", platformAccountId: "tokenless", displayName: "Tokenless account", username: null, avatarUrl: null,
      status: "connected", tokenExpiresAt: null, metadata: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
      publishCapability: { available: false, reason: "Reconnect Tokenless account in Social: no real platform access token is available." },
    }], drafts: [{ id: "post-1", companyId: "company-1", title: null, content: "Approved", postType: "text", status: "draft", scheduledAt: null, publishedAt: null, mediaUrls: [], tags: [], metadata: { personaId: "persona-1" }, createdBy: null, createdAt: new Date(), updatedAt: new Date() }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="social" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    expect(container.textContent).toContain("Reconnect Tokenless account in Social");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Target accounts"]')!.disabled).toBe(true);
  });

  it("hands approved content to Social as an explicit draft action", async () => {
    apiMocks.listReviews.mockResolvedValue({ reviews: [{
      id: "review-1", companyId: "company-1", personaId: "persona-1", sourceType: "generation",
      sourceId: "22222222-2222-4222-8222-222222222222", status: "approved", feedback: null,
      requestedBy: "board", decidedBy: "board", decidedAt: new Date().toISOString(), supersedesRequestId: null,
      createdAt: new Date().toISOString(), preview: { kind: "generation", mediaUrl: "/preview.png", content: null },
    }] });
    apiMocks.handoff.mockResolvedValue({ post: { id: "post-1", status: "draft" }, targets: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><CreatorOperationalLanes destination="review" companyId="company-1" personaId="persona-1" /></QueryClientProvider>));
    await settle();
    const content = container.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Social content"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(content, "Approved caption");
      content.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const handoff = [...container.querySelectorAll("button")].find((button) => button.textContent === "Hand off to Social")!;
    await act(async () => handoff.click());
    expect(apiMocks.handoff).toHaveBeenCalledWith("company-1", "review-1", "Approved caption");
  });
});

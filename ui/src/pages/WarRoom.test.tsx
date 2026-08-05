// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WarRoom } from "./WarRoom";

const mockPipelineApi = vi.hoisted(() => ({
  listRuns: vi.fn(), getRun: vi.fn(), start: vi.fn(), gateDecision: vi.fn(), kill: vi.fn(),
}));

vi.mock("../api/pipeline", () => ({
  pipelineApi: mockPipelineApi,
}));
vi.mock("../api/rooms", () => ({
  roomsApi: { listMessages: vi.fn(), sendMessage: vi.fn(), create: vi.fn() },
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../components/WarRoomHermesChat", () => ({ WarRoomHermesChat: () => <div data-testid="hermes-chat">Hermes chat</div> }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockPipelineApi.listRuns.mockResolvedValue({ runs: [] });
  if (!(globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent) {
    Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true });
  }
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: () => {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { value: () => {}, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("uses phone targets and switches from the pipeline to Hermes", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><WarRoom /></QueryClientProvider>);
  });
  const responsiveRoot = container.querySelector<HTMLElement>("[data-testid='war-room-responsive-root']");
  const hermes = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes("Hermes"));
  expect(responsiveRoot?.className).toContain("[&_button]:min-h-11");
  act(() => hermes?.click());
  expect(container.querySelector("[data-testid='hermes-chat']")?.textContent).toBe("Hermes chat");
  act(() => root.unmount());
  client.clear();
});

it("opens a populated run by keyboard and exposes its stage and gate scrollers", async () => {
  mockPipelineApi.listRuns.mockResolvedValue({
    runs: [{ id: "run-1", name: "Phone release", current_stage: "build", status: "active" }],
  });
  mockPipelineApi.getRun.mockResolvedValue({
    run: { id: "run-1", name: "Phone release", status: "active", room_id: null },
    stages: [
      { name: "idea", status: "passed" },
      { name: "spec", status: "passed" },
      { name: "design", status: "passed" },
      { name: "architecture", status: "passed" },
      { name: "build", status: "active" },
    ],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><WarRoom /></QueryClientProvider>);
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  const runCard = Array.from(container.querySelectorAll<HTMLElement>("[role='button']"))
    .find((item) => item.textContent?.includes("Phone release"))!;
  await act(async () => {
    runCard.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  expect(mockPipelineApi.getRun).toHaveBeenCalledWith("company-1", "run-1");
  const stageScroller = container.querySelector<HTMLElement>('[aria-label^="Pipeline stages"]')!;
  expect(stageScroller.getAttribute("tabindex")).toBe("0");
  const gateSelect = container.querySelector<HTMLElement>("button[role='combobox']")!;
  act(() => gateSelect.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
  const option = document.body.querySelector<HTMLElement>("[role='option']")!;
  expect(option.className).toContain("min-h-11");
  expect(option.className).toContain("sm:min-h-0");
  act(() => root.unmount());
  client.clear();
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WarRoom } from "./WarRoom";

vi.mock("../api/pipeline", () => ({
  pipelineApi: {
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getRun: vi.fn(), start: vi.fn(), gateDecision: vi.fn(), kill: vi.fn(),
  },
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

afterEach(() => {
  document.body.innerHTML = "";
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

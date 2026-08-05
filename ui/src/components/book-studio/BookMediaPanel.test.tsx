// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "acme" }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../../api/bookMedia", () => ({
  bookMediaApi: { overview: vi.fn(async (_company: string, bookId: string) => ({ book: { title: bookId, coverUrl: null, coverLocked: false }, providerStatus: { higgsfield: { configured: false }, openart: { configured: false }, replicate: { configured: false } }, chapters: [], coverJobs: [], trailerJobs: [], narrationJobs: [], assets: [], characters: [], locations: [] })) },
}));
vi.mock("../../api/creativeStudio", () => ({ creativeStudioApi: { models: vi.fn(async () => ({ models: [] })) } }));

import { BookMediaPanel } from "./BookMediaPanel";
import { bookMediaApi } from "../../api/bookMedia";

async function flush() { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); }
function stubPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches, media: "(max-width: 767px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
}

describe("BookMediaPanel controlled mode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it("opens from its parent without a competing floating launcher and closes through the controlled callback", async () => {
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" bookTitle="Immediate Title" open onOpenChange={onOpenChange} showLauncher={false} /></QueryClientProvider>));
    await flush();
    expect(container.textContent).toContain("Book Media");
    expect(container.textContent).toContain("Immediate Title");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Media")).toBe(false);
    const close = Array.from(container.querySelectorAll("button")).find((button) => button.querySelector("svg") && !button.textContent?.trim())!;
    act(() => close.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the controlled panel a modal dialog with a phone scrim", async () => {
    stubPhone(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" open onOpenChange={vi.fn()} showLauncher={false} /></QueryClientProvider>));
    await flush();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector('[data-media-backdrop]')).not.toBeNull();
    expect(dialog.className).toContain("max-h-[90dvh]");
    expect(container.querySelector('[aria-label="Close media panel"]')?.className).toContain("h-11");
    for (const label of ["Cover", "Illustrations", "Trailer", "Narration", "Library"]) expect(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.includes(label))?.className).toContain("min-h-11");
  });

  it("traps phone focus across every focusable, closes on Escape, and returns focus", async () => {
    stubPhone(true);
    const onOpenChange = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" open onOpenChange={onOpenChange} showLauncher={false} /></QueryClientProvider>)); await flush();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    controls.at(-1)!.focus(); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(controls[0]);
    controls[0].focus(); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(controls.at(-1));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" open={false} onOpenChange={onOpenChange} showLauncher={false} /></QueryClientProvider>));
    expect(document.activeElement).toBe(trigger); trigger.remove();
  });

  it("keeps the desktop dock non-modal without focus interception", async () => {
    stubPhone(false);
    const onOpenChange = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const outside = document.createElement("button"); document.body.appendChild(outside); outside.focus();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" open onOpenChange={onOpenChange} showLauncher={false} /></QueryClientProvider>)); await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.querySelector("[data-media-backdrop]")).toBeNull(); expect(document.activeElement).toBe(outside);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onOpenChange).not.toHaveBeenCalled(); outside.remove();
  });

  it("switching books while open requests the new book and renders the new title immediately", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-1" bookTitle="One" open showLauncher={false} /></QueryClientProvider>));
    await flush();
    act(() => root!.render(<QueryClientProvider client={client}><BookMediaPanel bookId="book-2" bookTitle="Two" open showLauncher={false} /></QueryClientProvider>));
    expect(container.textContent).toContain("Two");
    expect(container.textContent).not.toContain("One");
    await flush();
    expect(bookMediaApi.overview).toHaveBeenCalledWith("acme", "book-2");
  });
});

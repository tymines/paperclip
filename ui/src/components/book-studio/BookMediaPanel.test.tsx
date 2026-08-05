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

describe("BookMediaPanel controlled mode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; vi.clearAllMocks(); });

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

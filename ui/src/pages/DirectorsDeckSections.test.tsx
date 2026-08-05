// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_BIBLE_SECTIONS } from "@/components/book-studio/storyBibleSections";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "acme" }) }));
vi.mock("@/components/book-studio/ChatDrawer", () => ({ ChatDrawer: () => null }));
vi.mock("@/components/book-studio/BookMediaPanel", () => ({ BookMediaPanel: () => null }));
vi.mock("@/components/book-studio/StoryBibleSectionEditor", () => ({
  StoryBibleSectionEditor: ({ book, section }: { book: { id: string }; section: string }) => <div data-testid="legacy-center" data-book={book.id} data-section={section} />,
}));
vi.mock("@/components/book-studio/CodexPanel", () => ({
  CodexPanel: ({ bookId, activeSection }: { bookId: string; activeSection: string }) => <div data-testid="codex-center" data-book={bookId} data-section={activeSection} />,
}));

import { DirectorsDeckPage } from "./DirectorsDeckPage";

const BOOKS = [
  { id: "book-1", companyId: "acme", slug: "one", title: "One", metadata: {}, createdAt: "", updatedAt: "" },
  { id: "book-2", companyId: "acme", slug: "two", title: "Two", metadata: {}, createdAt: "", updatedAt: "" },
];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = {};
    if (url.endsWith("/book-studio/books")) payload = { books: BOOKS };
    else if (url.includes("/outline")) payload = { outline: [] };
    else if (url.includes("/chapters")) payload = { chapters: [] };
    else if (url.includes("/characters")) payload = { characters: [] };
    else if (url.includes("/world-locations")) payload = { "world-locations": [] };
    else if (url.includes("/style")) payload = { style: [] };
    else if (url.includes("/bible-review-queue")) payload = { pendingCount: 0 };
    else if (url.includes("/codex-relationships")) payload = { available: true, relationships: [] };
    else if (url.includes("/codex-facts")) payload = { available: true, known: [] };
    else if (url.includes("/codex/")) payload = { available: true, entities: [] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
  }));
}

async function flush() { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }

describe("Director's Deck Story Bible routing", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; vi.unstubAllGlobals(); });

  async function renderPage() {
    stubFetch();
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container); act(() => root!.render(<DirectorsDeckPage />)); await flush();
  }

  it("routes every authoritative rail ID to the matching editable center and marks the same item", async () => {
    await renderPage();
    for (const definition of STORY_BIBLE_SECTIONS) {
      const button = container!.querySelector(`button[data-section-id="${definition.id}"]`);
      expect(button, `rail button ${definition.id}`).not.toBeNull();
      click(button!); await flush();
      const center = container!.querySelector('[data-testid$="-center"]') as HTMLElement;
      expect(center.dataset.section).toBe(definition.id);
      expect(button!.getAttribute("aria-current")).toBe("page");
    }
  });

  it("keeps the selected section but immediately binds the center to the newly selected book", async () => {
    await renderPage();
    const characters = container!.querySelector('button[data-section-id="characters"]')!;
    click(characters); await flush();
    expect((container!.querySelector('[data-testid="legacy-center"]') as HTMLElement).dataset.book).toBe("book-1");
    const select = container!.querySelector('select[aria-label="Active book"]') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    act(() => { setter.call(select, "book-2"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect((container!.querySelector('[data-testid="legacy-center"]') as HTMLElement).dataset.book).toBe("book-2");
    expect((container!.querySelector('[data-testid="legacy-center"]') as HTMLElement).dataset.section).toBe("characters");
    await flush();
  });
});

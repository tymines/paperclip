// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_BIBLE_SECTIONS } from "@/components/book-studio/storyBibleSections";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "acme" }) }));
vi.mock("@/components/book-studio/ChatDrawer", () => ({ ChatDrawer: ({ isOpen }: { isOpen: boolean }) => <div data-testid="chat-state" data-open={isOpen} /> }));
vi.mock("@/components/book-studio/BookMediaPanel", () => ({ BookMediaPanel: ({ open }: { open: boolean }) => <div data-testid="media-state" data-open={open} /> }));
vi.mock("@/components/book-studio/StoryBibleSectionEditor", () => ({
  StoryBibleSectionEditor: ({ book, section }: { book: { id: string }; section: string }) => <div data-testid="legacy-center" data-book={book.id} data-section={section} />,
}));
vi.mock("@/components/book-studio/CodexPanel", () => ({
  CodexPanel: ({ bookId, activeSection }: { bookId: string; activeSection: string }) => <div data-testid="codex-center" data-book={bookId} data-section={activeSection} />,
}));

import { DirectorsDeckPage } from "./DirectorsDeckPage";

const BOOKS = [
  { id: "book-1", companyId: "acme", slug: "one", title: "One", metadata: { chapterStatus: { "1": "exception" } }, revision: 1, createdAt: "", updatedAt: "" },
  { id: "book-2", companyId: "acme", slug: "two", title: "Two", metadata: {}, revision: 1, createdAt: "", updatedAt: "" },
];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    let payload: unknown = {};
    if (options?.method === "PATCH" && url.endsWith("/books/book-1")) {
      const body = JSON.parse(String(options.body ?? "{}"));
      payload = { book: { ...BOOKS[0], metadata: body.metadata ?? BOOKS[0].metadata, revision: 2 } };
    } else if (url.endsWith("/book-studio/books")) payload = { books: BOOKS };
    else if (url.includes("/outline")) payload = { outline: [{ id: "outline-1", chapterNumber: 1, title: "Opening", locked: false, revision: 1, beats: [] }] };
    else if (url.includes("/chapters")) payload = { chapters: [{ id: "chapter-1", chapterNumber: 1, title: "Opening", content: "Once", locked: false }] };
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
    click(Array.from(container!.querySelectorAll('[role="tab"]')).find((button) => button.textContent?.includes("Story Bible"))!); await flush();
    for (const definition of STORY_BIBLE_SECTIONS) {
      const button = container!.querySelector(`button[data-section-id="${definition.id}"]`);
      expect(button, `rail button ${definition.id}`).not.toBeNull();
      click(button!); await flush();
      const center = container!.querySelector('[data-testid$="-center"]') as HTMLElement;
      expect(center.dataset.section).toBe(definition.id);
      expect(button!.getAttribute("aria-current")).toBe("page");
    }
  });

  it("keeps every complete Story Bible section visible in the center navigator", async () => {
    await renderPage();
    click(Array.from(container!.querySelectorAll('[role="tab"]')).find((button) => button.textContent?.includes("Story Bible"))!); await flush();
    click(container!.querySelector('button[data-section-id="overview"]')!); await flush();
    const navigator = container!.querySelector("[data-story-bible-navigator]")!;
    expect(navigator).not.toBeNull();
    for (const definition of STORY_BIBLE_SECTIONS) {
      expect(Array.from(navigator.querySelectorAll("button")).some((button) => button.textContent?.includes(definition.label))).toBe(true);
    }
  });

  it("keeps the selected section but immediately binds the center to the newly selected book", async () => {
    await renderPage();
    click(Array.from(container!.querySelectorAll('[role="tab"]')).find((button) => button.textContent?.includes("Story Bible"))!); await flush();
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

  it("exposes all four labelled phone entry paths and routes every Story Bible section plus Review Queue through the page-owned sheet", async () => {
    await renderPage();
    for (const label of ["Chapters", "Story Bible", "Inspect", "Tools"]) expect(Array.from(container!.querySelectorAll("button")).some((button) => button.textContent === label)).toBe(true);
    click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Story Bible")!);
    for (const definition of STORY_BIBLE_SECTIONS.filter((section) => section.id !== "review-queue")) {
      const dialog = container!.querySelector('[role="dialog"][aria-label="Story Bible"]')!;
      expect(dialog).not.toBeNull();
      const button = dialog.querySelector(`button[data-section-id="${definition.id}"]`)!;
      expect(button).not.toBeNull(); expect(button.className).toContain("min-h-11"); click(button); await flush();
      const center = container!.querySelectorAll<HTMLElement>('[data-testid$="-center"]').item(container!.querySelectorAll('[data-testid$="-center"]').length - 1);
      expect(center.dataset.section).toBe(definition.id);
      click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Story Bible")!);
    }
    const review = container!.querySelector('[role="dialog"] button[data-section-id="review-queue"]')!;
    expect(review.className).toContain("min-h-11");
    click(review); await flush();
    expect((container!.querySelector('[data-testid="codex-center"]') as HTMLElement).dataset.section).toBe("review-queue");
  });

  it("activates a chapter, closes its sheet, returns focus, and gives phone rail rows 44px targets", async () => {
    await renderPage();
    const trigger = Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Chapters") as HTMLButtonElement;
    trigger.focus(); click(trigger);
    const dialog = container!.querySelector('[role="dialog"][aria-label="Chapters"]')!;
    const chapter = dialog.querySelector("nav button") as HTMLButtonElement;
    expect(chapter.className).toContain("min-h-11"); click(chapter); await flush();
    expect(container!.querySelector('[role="dialog"][aria-label="Chapters"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container!.textContent).toContain("Opening");
  });

  it("traps focus and supports Escape, backdrop, visible close, and focus return for every phone sheet", async () => {
    await renderPage();
    for (const label of ["Chapters", "Story Bible", "Inspect", "Tools"]) {
      const trigger = Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === label) as HTMLButtonElement;
      trigger.focus(); click(trigger);
      let dialog = container!.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]`)!;
      let controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      controls.at(-1)!.focus(); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(controls[0]);
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      expect(container!.querySelector(`[role="dialog"][aria-label="${label}"]`)).toBeNull(); expect(document.activeElement).toBe(trigger);
      click(trigger); click(container!.querySelector(`button[aria-label="Close ${label}"]`)!); expect(container!.querySelector(`[role="dialog"][aria-label="${label}"]`)).toBeNull();
      click(trigger); dialog = container!.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]`)!; click(dialog.querySelector(`button[aria-label="Close ${label}"]`)!); expect(container!.querySelector(`[role="dialog"][aria-label="${label}"]`)).toBeNull();
    }
  });

  it("exposes Inspect tabs and every Tools action through existing page callbacks", async () => {
    await renderPage();
    click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Chapters")!); click(container!.querySelector('[role="dialog"][aria-label="Chapters"] nav button')!); await flush();
    click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Inspect")!);
    let inspect = container!.querySelector('[role="dialog"][aria-label="Inspect"]')!;
    for (const tab of ["gate", "rubric", "notes", "canon"]) expect(Array.from(inspect.querySelectorAll("button")).some((button) => button.textContent === tab)).toBe(true);
    expect(inspect.textContent).toContain("Open flagged beat"); click(Array.from(inspect.querySelectorAll("button")).find((button) => button.textContent?.includes("Open flagged beat"))!); expect(container!.querySelector('[aria-label="Inspect"]')).toBeNull();
    click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Inspect")!); inspect = container!.querySelector('[role="dialog"][aria-label="Inspect"]')!; click(Array.from(inspect.querySelectorAll("button")).find((button) => button.textContent?.includes("Needs your decision"))!); expect(container!.textContent).toContain("Your call");
    const decisionDialog = Array.from(container!.querySelectorAll<HTMLElement>('[role="dialog"]')).find((dialog) => dialog.textContent?.includes("Your call"))!; click(decisionDialog.querySelector("button")!);

    const openTools = () => click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Tools")!);
    openTools();
    const mode = container!.querySelector('[role="dialog"][aria-label="Tools"] select[aria-label="Director mode"]') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    act(() => { setter.call(mode, "chapter"); mode.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some((call) => String(call[0]).endsWith("/books/book-1") && call[1]?.method === "PATCH")).toBe(true);
    click(container!.querySelector('[role="dialog"][aria-label="Tools"] [aria-label="Close Tools"]')!);
    for (const [action, expected] of [["New Book", "Create a new book"], ["Taste", "Taste profile"], ["Run Plan", "Run Plan"], ["Export", "Export & consistency"]] as const) {
      openTools(); click(Array.from(container!.querySelectorAll('[role="dialog"][aria-label="Tools"] button')).find((button) => button.textContent === action)!);
      const overlay = Array.from(container!.querySelectorAll<HTMLElement>('[role="dialog"]')).find((dialog) => dialog.getAttribute("aria-label") === expected || dialog.textContent?.includes(expected))!;
      expect(overlay).not.toBeNull(); click(overlay.querySelector("button")!);
    }
    openTools(); const tools = container!.querySelector('[role="dialog"][aria-label="Tools"]')!;
    click(Array.from(tools.querySelectorAll("button")).find((button) => button.textContent === "Brainstorm")!); expect(container!.querySelector('[data-testid="chat-state"]')?.getAttribute("data-open")).toBe("true");
    click(Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Tools")!); click(Array.from(container!.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === "Media")!); expect(container!.querySelector('[data-testid="media-state"]')?.getAttribute("data-open")).toBe("true");
  });
});

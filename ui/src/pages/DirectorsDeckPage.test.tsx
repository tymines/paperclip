// @vitest-environment jsdom
//
// "+ NEW BOOK" wiring (Book-tab fix): the DeckTopBar button used to fire a
// no-op stub. Now it opens a real modal; submitting POSTs to the book-studio
// books endpoint, unwraps the { book } response, prepends the book to the
// switcher, and selects it. API failures surface inside the modal.
// All network is stubbed — zero packets anywhere.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// CompanyContext: bare render, no provider — stub the hook.
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "acme" }),
}));

// Heavy provider-dependent leaf panels are irrelevant to this wiring test.
vi.mock("@/components/book-studio/BookMediaPanel", () => ({
  BookMediaPanel: () => null,
}));
vi.mock("@/components/book-studio/ChatDrawer", () => ({
  ChatDrawer: () => null,
}));

import { DirectorsDeckPage } from "./DirectorsDeckPage";

const NEW_BOOK = { id: "book-new", slug: "my-new-book", title: "My New Book", metadata: {} };

interface FetchCall { url: string; method: string; body?: unknown }

function stubFetch(postResponder: () => { ok: boolean; status: number; payload: unknown }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    const method = options?.method ?? "GET";
    calls.push({ url, method, body: options?.body ? JSON.parse(String(options.body)) : undefined });

    if (method === "POST" && url.endsWith("/book-studio/books")) {
      const r = postResponder();
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.payload,
        text: async () => JSON.stringify(r.payload),
      } as Response;
    }
    let payload: unknown = {};
    if (url.endsWith("/book-studio/books")) payload = { books: [] };
    else if (url.includes("/outline")) payload = { outline: [] };
    else if (url.includes("/chapters")) payload = { chapters: [] };
    else if (url.includes("/characters")) payload = { characters: [] };
    else if (url.includes("/world-locations")) payload = { "world-locations": [] };
    else if (url.includes("/style")) payload = { style: [] };
    else if (url.includes("/bible-review-queue")) payload = { pendingCount: 0 };
    else if (url.includes("/codex-relationships")) payload = { available: false, relationships: [] };
    else if (url.includes("/codex-facts")) payload = { available: false, known: [] };
    else if (url.includes("/codex/")) payload = { available: false, entities: [] };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }));
  return calls;
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(<DirectorsDeckPage />); });
  return { container, root };
}

function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DirectorsDeckPage — + NEW BOOK create flow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = null;
    root = null;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function newBookButton(): HTMLButtonElement {
    const btn = Array.from(container!.querySelectorAll("button"))
      .find((b) => b.textContent === "+ New Book");
    expect(btn, "top-bar + New Book button").toBeDefined();
    return btn!;
  }

  it("clicking + NEW BOOK opens the create-book modal", async () => {
    stubFetch(() => ({ ok: true, status: 200, payload: { book: NEW_BOOK } }));
    const r = renderPage();
    container = r.container; root = r.root;
    await flush();

    expect(container!.querySelector('[role="dialog"]')).toBeNull();
    click(newBookButton());
    await flush();

    const dialog = container!.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("New book");
  });

  it("submitting creates the book via POST, closes the modal, and selects the new book", async () => {
    const calls = stubFetch(() => ({ ok: true, status: 200, payload: { book: NEW_BOOK } }));
    const r = renderPage();
    container = r.container; root = r.root;
    await flush();

    click(newBookButton());
    await flush();

    const input = container!.querySelector('[role="dialog"] input') as HTMLInputElement;
    setInputValue(input, "My New Book");

    const form = container!.querySelector('[role="dialog"] form')!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    // Real POST to the book-studio books endpoint.
    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    expect(post!.url).toBe("/api/companies/acme/book-studio/books");
    expect(post!.body).toEqual({ title: "My New Book" });

    // Modal closed; new book is in the switcher and selected.
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
    const select = container!.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("book-new");
    const titles = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(titles).toContain("My New Book");
  });

  it("an API failure surfaces the error inside the modal and keeps it open", async () => {
    stubFetch(() => ({ ok: false, status: 500, payload: { error: "disk on fire" } }));
    const r = renderPage();
    container = r.container; root = r.root;
    await flush();

    click(newBookButton());
    await flush();

    const input = container!.querySelector('[role="dialog"] input') as HTMLInputElement;
    setInputValue(input, "Doomed Book");

    const form = container!.querySelector('[role="dialog"] form')!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    const dialog = container!.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("disk on fire");
  });

  it("Create stays disabled for an empty title", async () => {
    stubFetch(() => ({ ok: true, status: 200, payload: { book: NEW_BOOK } }));
    const r = renderPage();
    container = r.container; root = r.root;
    await flush();

    click(newBookButton());
    await flush();

    const submit = container!.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("shows a manuscript-only chapter even when the outline has no matching row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown = {};
      if (url.endsWith("/book-studio/books")) payload = { books: [{ id: "book-1", slug: "orphan", title: "Orphan Chapter", metadata: {} }] };
      else if (url.endsWith("/outline")) payload = { outline: [] };
      else if (url.endsWith("/chapters")) payload = { chapters: [{ id: "ch-1", chapterNumber: 3, title: "Recovered Chapter", content: "Existing manuscript prose.", locked: false }] };
      else if (url.includes("/characters")) payload = { characters: [] };
      else if (url.includes("/world-locations")) payload = { "world-locations": [] };
      else if (url.includes("/style")) payload = { style: [] };
      else if (url.includes("/bible-review-queue")) payload = { pendingCount: 0 };
      else if (url.includes("/codex-relationships")) payload = { available: true, relationships: [] };
      else if (url.includes("/codex-facts")) payload = { available: true, known: [] };
      else if (url.includes("/codex/")) payload = { available: true, entities: [] };
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
    }));
    const r = renderPage(); container = r.container; root = r.root;
    await flush();
    await flush();

    expect(container!.textContent).toContain("Recovered Chapter");
    expect(container!.textContent).toContain("1ready");
  });

  it("uses deck container width for the compact, laptop, and wide-desktop panes", async () => {
    stubFetch(() => ({ ok: true, status: 200, payload: { book: NEW_BOOK } }));
    const r = renderPage(); container = r.container; root = r.root;
    await flush();

    const page = container!.firstElementChild as HTMLElement;
    expect(page.className).toContain("@container/deck");
    expect(page.className).toContain("overflow-x-hidden");

    const workspaceGrid = container!.querySelector("main")!.parentElement!;
    expect(workspaceGrid.className).toContain("grid-cols-1");
    expect(workspaceGrid.className).toContain("@min-[760px]/deck:grid-cols-[240px_minmax(0,1fr)]");
    expect(workspaceGrid.className).toContain("@min-[1100px]/deck:grid-cols-[272px_minmax(0,1fr)_322px]");
    expect(container!.querySelector('nav[aria-label="Book tools"]')!.className).toContain("@min-[1320px]/deck:hidden");
  });
});

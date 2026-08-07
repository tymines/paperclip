// @vitest-environment jsdom
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckTopBar } from "./DeckTopBar";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function renderTopBar(overrides: Partial<ComponentProps<typeof DeckTopBar>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onRenameBook = vi.fn(async () => {});
  const props: ComponentProps<typeof DeckTopBar> = {
    books: [{ id: "book-1", slug: "book-one", title: "Book One" }], activeBookId: "book-1",
    onSelectBook: vi.fn(), onRenameBook, onNewBook: vi.fn(), status: null, mode: "co", onModeChange: vi.fn(),
    onTaste: vi.fn(), onRunPlan: vi.fn(), onBrainstorm: vi.fn(), onMedia: vi.fn(), onExport: vi.fn(), ...overrides,
  };
  act(() => root.render(<DeckTopBar {...props} />));
  return { container, root, onRenameBook };
}

function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe("DeckTopBar", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; container = null; });

  it("renders both brand words white and a readable opaque selector with focus styling", () => {
    const rendered = renderTopBar(); root = rendered.root; container = rendered.container;
    const brand = Array.from(container.querySelectorAll("div")).find((node) => node.textContent === "Book Studio")!;
    expect(brand.className).toContain("text-white");
    expect(brand.querySelector("em")!.className).toContain("text-white");
    expect(brand.querySelector("em")!.className).not.toContain("text-[#e0955a]");
    const select = container.querySelector("select")!;
    expect(select.className).toContain("bg-[#171b24]");
    expect(select.className).toContain("text-white");
    expect(select.className).toContain("focus:ring-2");
    expect(select.querySelector("option")!.className).toContain("bg-[#171b24]");
  });

  it("shows distinct loading and empty selector states", () => {
    const rendered = renderTopBar({ books: [], activeBookId: null, booksLoading: true }); root = rendered.root; container = rendered.container;
    let select = container.querySelector("select")!;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain("Loading books");
    act(() => root!.render(<DeckTopBar books={[]} activeBookId={null} booksLoading={false} onSelectBook={vi.fn()} onRenameBook={vi.fn()} onNewBook={vi.fn()} status={null} mode="co" onModeChange={vi.fn()} onTaste={vi.fn()} onRunPlan={vi.fn()} onBrainstorm={vi.fn()} onMedia={vi.fn()} onExport={vi.fn()} />));
    select = container.querySelector("select")!;
    expect(select.textContent).toContain("No books yet");
  });

  it("keeps the active book selector and exposes 44px phone-safe Brainstorm and Media controls", () => {
    const rendered = renderTopBar(); root = rendered.root; container = rendered.container;
    expect(container.querySelector('[aria-label="Active book"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Brainstorm"]')?.className).toContain("w-11");
    expect(container.querySelector('[aria-label="Media"]')?.className).toContain("h-11");
  });

  it("bounds book identity and defers dense controls until the deck is wide enough", () => {
    const rendered = renderTopBar({ status: { ready: 10, working: 1, exception: 0 } }); root = rendered.root; container = rendered.container;
    const select = container.querySelector('[aria-label="Active book"]')!;
    expect(select.className).toContain("min-w-0");
    expect(select.className).toContain("flex-1");
    expect(select.className).toContain("truncate");
    const newBook = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "+ New Book")!;
    expect(newBook.className).toContain("@min-[1100px]/deck:inline-flex");
    expect(container.querySelector('[aria-label="Brainstorm"]')?.className).toContain("@min-[1100px]/deck:w-[30px]");
  });

  it("prefills rename, rejects whitespace, and submits the trimmed display title", async () => {
    const rendered = renderTopBar(); root = rendered.root; container = rendered.container;
    click(container.querySelector('[aria-label="Rename active book"]')!);
    const title = container.querySelector("#rename-book-input") as HTMLInputElement;
    expect(title.value).toBe("Book One");
    input(title, "   ");
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    input(title, "  Better Book  ");
    act(() => container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(rendered.onRenameBook).toHaveBeenCalledWith("Better Book");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog and old title when the server rejects rename", async () => {
    const onRenameBook = vi.fn(async () => { throw new Error("rename denied"); });
    const rendered = renderTopBar({ onRenameBook }); root = rendered.root; container = rendered.container;
    click(container.querySelector('[aria-label="Rename active book"]')!);
    input(container.querySelector("#rename-book-input") as HTMLInputElement, "Rejected Title");
    act(() => container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("rename denied");
    expect((container.querySelector('select option') as HTMLOptionElement).textContent).toBe("Book One");
  });
});

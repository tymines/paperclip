// @vitest-environment jsdom
//
// Beat delete control (Book-tab fix): each beat gets a ✕ control next to
// ↑/↓. Deleting splices the beat out of local state AND persists the full
// beats array through the EXISTING saveBeats → PATCH /outline/:id path —
// including the locked-chapter 409 refusal toast.
// All network is stubbed — zero packets anywhere.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckWorkspace, type Beat } from "./DeckWorkspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BEATS: Beat[] = [
  { kind: "Setup", description: "Alpha beat" },
  { kind: "Turn", description: "Bravo beat" },
  { kind: "Payoff", description: "Charlie beat" },
];

interface FetchCall { url: string; method: string; body?: unknown }

function stubFetch(patchResponder?: () => { ok: boolean; status: number; payload: unknown }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    const method = options?.method ?? "GET";
    calls.push({ url, method, body: options?.body ? JSON.parse(String(options.body)) : undefined });
    if (method === "PATCH" && patchResponder) {
      const r = patchResponder();
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.payload,
        text: async () => JSON.stringify(r.payload),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}",
    } as Response;
  }));
  return calls;
}

function renderWorkspace() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <DeckWorkspace
        bookId="book-1"
        bookSlug="book-one"
        companySlug="acme"
        chapterNumber={1}
        chapterTitle="Chapter 1"
        outlineEntry={{ id: "outline-1", chapterNumber: 1, title: "Chapter 1", beats: BEATS }}
        locked={false}
        chapterStatus={null}
        onLockToggle={() => {}}
        onNeedsRefresh={() => {}}
        onOpenDecisionInbox={() => {}}
      />,
    );
  });
  return { container, root };
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DeckWorkspace — beat delete control", () => {
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

  function deleteButtons(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button[title="Delete beat"]'));
  }

  it("renders one ✕ delete control per beat", async () => {
    stubFetch();
    const r = renderWorkspace();
    container = r.container; root = r.root;
    await flush();
    expect(deleteButtons()).toHaveLength(3);
  });

  it("deleting the middle beat splices index 1 and persists the remaining beats via PATCH /outline/:id", async () => {
    const calls = stubFetch();
    const r = renderWorkspace();
    container = r.container; root = r.root;
    await flush();

    click(deleteButtons()[1]);
    await flush();

    // Local state: the middle beat is gone from the DOM.
    expect(container!.textContent).toContain("Alpha beat");
    expect(container!.textContent).not.toContain("Bravo beat");
    expect(container!.textContent).toContain("Charlie beat");

    // Persisted through the existing saveBeats → PATCH outline path.
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch!.url).toBe("/api/companies/acme/book-studio/books/book-1/outline/outline-1");
    const body = patch!.body as { beats: { kind: string; description: string }[] };
    expect(body.beats).toHaveLength(2);
    expect(body.beats.map((b) => b.description)).toEqual(["Alpha beat", "Charlie beat"]);
  });

  it("a 409 from the PATCH surfaces the locked-chapter refusal toast", async () => {
    stubFetch(() => ({ ok: false, status: 409, payload: { error: "locked" } }));
    const r = renderWorkspace();
    container = r.container; root = r.root;
    await flush();

    click(deleteButtons()[0]);
    await flush();

    expect(container!.textContent).toContain("Chapter locked — beats refuse edits");
  });
});

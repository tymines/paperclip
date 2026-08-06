// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateDraftPanel } from "./GenerateDraftPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GenerateDraftPanel Calliope redo", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAccept = vi.fn();
  const onDiscard = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onAccept.mockReset();
    onDiscard.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderPanel() {
    act(() => {
      root.render(
        <GenerateDraftPanel
          entityType="lore"
          bookId="book-1"
          companySlug="AUG"
          onAccept={onAccept}
          onDiscard={onDiscard}
        />,
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(match, `button ${label}`).toBeDefined();
    return match!;
  }

  async function generateFirstDraft(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const input = container.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Create the academy origin myth");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Generate").click());
    await flush();
    expect(container.textContent).toContain("First origin myth");
    expect(button("Redo with Calliope").disabled).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  }

  it("replaces only the pending draft and accepts the fresh result", async () => {
    const redoResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ draft: { title: "First origin myth" } }))
      .mockReturnValueOnce(redoResponse.promise);

    await generateFirstDraft(fetchMock);

    act(() => button("Redo with Calliope").click());
    await flush();
    expect(container.textContent).toContain("First origin myth");
    expect(button("Redoing with Calliope...").disabled).toBe(true);
    expect(button("Accept").disabled).toBe(true);
    expect(button("Discard").disabled).toBe(true);

    await act(async () => redoResponse.resolve(jsonResponse({ draft: { title: "Fresh origin myth" } })));
    await flush();

    expect(container.textContent).toContain("Fresh origin myth");
    expect(container.textContent).not.toContain("First origin myth");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/companies/AUG/book-studio/books/book-1/generate/lore",
      "/api/companies/AUG/book-studio/books/book-1/generate/lore",
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { prompt: "Create the academy origin myth" },
      { prompt: "Create the academy origin myth" },
    ]);
    expect(onAccept).not.toHaveBeenCalled();

    act(() => button("Accept").click());
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith({ title: "Fresh origin myth" });
  });

  it("keeps the current draft when a redo request fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ draft: { title: "First origin myth" } }))
      .mockResolvedValueOnce(jsonResponse({ error: "Calliope is temporarily unavailable" }, 400));

    await generateFirstDraft(fetchMock);
    await act(async () => button("Redo with Calliope").click());
    await flush();

    expect(container.textContent).toContain("First origin myth");
    expect(container.textContent).toContain("Calliope is temporarily unavailable");
    expect(button("Redo with Calliope").disabled).toBe(false);
    expect(button("Accept").disabled).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

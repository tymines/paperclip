// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManuscriptEditor } from "./ManuscriptEditor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("ManuscriptEditor responsive toolbar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("bounds chapter identity and keeps actions in a local scroller until the editor is wide", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/locks")
        ? { locked: false, passageLocks: [], available: true }
        : { chapters: [{ chapterNumber: 1, title: "A very long chapter title", content: "Draft prose" }] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <ManuscriptEditor
        bookId="book-1"
        companySlug="acme"
        outlineEntries={[{ id: "outline-1", chapterNumber: 1, title: "A very long chapter title", beats: [] }]}
        focusMode={false}
        onToggleFocus={() => {}}
      />,
    ));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const editor = container.firstElementChild as HTMLElement;
    expect(editor.className).toContain("@container/manuscript");
    expect(editor.className).toContain("min-w-0");
    const selector = container.querySelector("select")!;
    expect(selector.className).toContain("min-w-0");
    expect(selector.className).toContain("max-w-[55%]");
    expect(selector.className).toContain("truncate");
    const actions = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Redraft"))!.parentElement!;
    expect(actions.className).toContain("overflow-x-auto");
    expect(actions.className).toContain("@min-[760px]/manuscript:overflow-visible");
    const manuscriptBody = container.querySelector("[data-manuscript-body]")!;
    expect(manuscriptBody.className).toContain("min-h-72");
    expect(manuscriptBody.className).toContain("sm:min-h-[clamp(18rem,50dvh,36rem)]");
  });
});

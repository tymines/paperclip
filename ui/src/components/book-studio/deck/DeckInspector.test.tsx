// @vitest-environment jsdom
//
// PR #30 r7 — DeckInspector honest gate labels:
//  · an "exception" chapter status is NOT automatically a FAIL — a degraded
//    Hades NO_VERDICT renders as NO_VERDICT/degraded, distinctly from FAIL;
//  · a review run without model/provenance renders as UNKNOWN — never the
//    fabricated default "hades (live lane)".
// All network is stubbed — zero packets anywhere.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckInspector } from "./DeckInspector";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface RunFixture {
  id: string;
  chapterNumber: number;
  summary?: string;
  model?: string;
  createdAt: string;
}

function stubFetch(runs: RunFixture[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes("/annotations")
      ? { available: true, annotations: [], reviewRuns: runs }
      : url.includes("/codex-relationships")
        ? { relationships: [] }
        : {};
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }));
}

function renderInspector(chapterStatus: string | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <DeckInspector
        bookId="book-1"
        companySlug="co-1"
        chapterNumber={1}
        chapterStatus={chapterStatus}
        onJumpToBeats={() => {}}
        onOpenDecisionInbox={() => {}}
        onSelectChapter={() => {}}
        onHighlightOffset={() => {}}
        onRevisionAccepted={() => {}}
      />,
    );
  });
  return { container, root };
}

const RUN_BASE = { id: "run-abcdef123456", chapterNumber: 1, createdAt: "2026-07-31T00:00:00Z" };

describe("DeckInspector — honest gate labels (PR #30 r7)", () => {
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

  async function renderAndSettle(chapterStatus: string | null, runs: RunFixture[]) {
    stubFetch(runs);
    const rendered = renderInspector(chapterStatus);
    container = rendered.container;
    root = rendered.root;
    // Flush the useEffect fetch promises.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return container!;
  }

  it("a degraded Hades NO_VERDICT renders as NO_VERDICT — never as FAIL", async () => {
    const el = await renderAndSettle("exception", [
      { ...RUN_BASE, summary: "[NO_VERDICT] Hades (live critic) could not review this chapter: peer unreachable", model: "hades (degraded — live lane unavailable)" },
    ]);
    expect(el.textContent).toContain("NO_VERDICT");
    // The big gate verdict must not claim FAIL.
    const gate = el.querySelector("b.font-serif");
    expect(gate?.textContent).toBe("NO_VERDICT");
    expect(gate?.className).toContain("text-amber-400");
    expect(gate?.className).not.toContain("text-red-400");
  });

  it("a genuine FAIL verdict still renders as FAIL", async () => {
    const el = await renderAndSettle("exception", [
      { ...RUN_BASE, summary: "[FAIL] Pacing sags badly.", model: "hades (live lane) · kimi-k3" },
    ]);
    const gate = el.querySelector("b.font-serif");
    expect(gate?.textContent).toBe("FAIL");
    expect(gate?.className).toContain("text-red-400");
  });

  it("an exception with NO review-run evidence renders as an unresolved exception — never an evidence-free FAIL", async () => {
    const el = await renderAndSettle("exception", []);
    const gate = el.querySelector("b.font-serif");
    expect(gate?.textContent).not.toBe("FAIL");
    expect(gate?.textContent).toBe("EXCEPTION");
  });

  it("a run WITHOUT model provenance renders as unknown — never the fabricated \"hades (live lane)\" default", async () => {
    const el = await renderAndSettle("exception", [
      { ...RUN_BASE, summary: "[FAIL] Pacing sags badly." },
    ]);
    expect(el.textContent).not.toContain("hades (live lane)");
    expect(el.textContent).toContain("unknown");
  });

  it("a run WITH model provenance renders it verbatim", async () => {
    const el = await renderAndSettle("exception", [
      { ...RUN_BASE, summary: "[FAIL] Pacing sags badly.", model: "hades (live lane) · kimi-k3" },
    ]);
    expect(el.textContent).toContain("hades (live lane) · kimi-k3");
  });
});

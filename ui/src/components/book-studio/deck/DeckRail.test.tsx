// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DeckRail, type DeckChapter } from "./DeckRail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

function renderRail(chapters: DeckChapter[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<DeckRail chapters={chapters} activeChapter={null} onSelectChapter={noop} onUnlockChapter={noop}
    sections={[]} activeSection={null} onSelectSection={noop} reviewCount={0} onOpenReviewQueue={noop} />));
  return { container, root };
}

describe("DeckRail manuscript queue summary", () => {
  const mounted: ReturnType<typeof renderRail>[] = [];
  afterEach(() => {
    for (const item of mounted.splice(0)) {
      act(() => item.root.unmount());
      item.container.remove();
    }
  });

  it("explains a genuinely empty queue instead of presenting three unexplained zeros", () => {
    const item = renderRail([]); mounted.push(item);
    expect(item.container.textContent).toContain("No chapters yet. Add an outline or manuscript chapter to begin.");
    expect(item.container.textContent).not.toContain("0ready");
  });

  it("reports planned chapters alongside ready, working, and exceptions", () => {
    const item = renderRail([
      { chapterNumber: 1, title: "Planned", state: "idle", meta: "Planned", score: null, locked: false },
      { chapterNumber: 2, title: "Ready", state: "pass", meta: "Ready", score: null, locked: false },
    ]); mounted.push(item);
    expect(item.container.textContent).toContain("1planned");
    expect(item.container.textContent).toContain("1ready");
  });
});

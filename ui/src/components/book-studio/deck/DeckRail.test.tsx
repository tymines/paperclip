// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckRail, type DeckBibleSection, type DeckChapter } from "./DeckRail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

function renderRail(chapters: DeckChapter[], viewMode: "chapters" | "bible" = "chapters", onViewModeChange = noop, sections: DeckBibleSection[] = []) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<DeckRail chapters={chapters} activeChapter={null} onSelectChapter={noop} onUnlockChapter={noop}
    sections={sections} activeSection={null} onSelectSection={noop} reviewCount={0} onOpenReviewQueue={noop}
    viewMode={viewMode} onViewModeChange={onViewModeChange} />));
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

  it("uses separate Chapters and Story Bible rail modes instead of stacking both long lists", () => {
    const chapters: DeckChapter[] = [
      { chapterNumber: 1, title: "Opening", state: "pass", meta: "Ready", score: null, locked: false },
    ];
    const sections: DeckBibleSection[] = [
      { id: "overview", icon: "O", label: "Overview", count: 1, ready: "ok" },
      { id: "characters", icon: "C", label: "Characters", count: 2, ready: "ok" },
    ];
    const onViewModeChange = vi.fn();
    const chaptersView = renderRail(chapters, "chapters", onViewModeChange, sections); mounted.push(chaptersView);
    expect(chaptersView.container.textContent).toContain("Opening");
    expect(chaptersView.container.textContent).not.toContain("Bible + overview");
    const storyBibleTab = Array.from(chaptersView.container.querySelectorAll('[role="tab"]')).find((button) => button.textContent?.includes("Story Bible"))!;
    act(() => storyBibleTab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onViewModeChange).toHaveBeenCalledWith("bible");

    const bibleView = renderRail(chapters, "bible", noop, sections); mounted.push(bibleView);
    expect(bibleView.container.textContent).toContain("Bible + overview");
    expect(bibleView.container.textContent).toContain("Characters");
    expect(bibleView.container.textContent).not.toContain("Opening");
  });
});

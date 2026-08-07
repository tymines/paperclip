import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const cssFile = fs.readdirSync(path.resolve("ui/dist/assets"))
  .find((name) => /^index-.*\.css$/.test(name));
if (!cssFile) throw new Error("Built UI stylesheet not found; run the UI build first.");

const sections = [
  "Overview", "Characters", "Locations", "Style", "Lore", "Factions", "Objects", "Systems",
  "Timeline", "Threads", "Themes", "Glossary", "Relationships", "Facts", "Review Queue",
];
const cases = [
  { width: 1280, height: 800, sidebar: 0 },
  { width: 1366, height: 768, sidebar: 208 },
  { width: 1440, height: 900, sidebar: 240 },
  { width: 1093, height: 614, sidebar: 208 },
  { width: 430, height: 932, sidebar: 0 },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const testCase of cases) {
    const page = await browser.newPage({ viewport: { width: testCase.width, height: testCase.height } });
    await page.setContent(`<!doctype html><html><body style="margin:0;overflow:hidden;background:#05070b;color:#eee">
      <div style="display:grid;grid-template-columns:${testCase.sidebar}px minmax(0,1fr);height:100vh;width:100vw">
        <aside></aside>
        <section id="deck" class="@container/deck flex h-full min-w-0 flex-col overflow-x-hidden bg-[#0a0c10]">
          <header id="topbar" class="flex min-h-[52px] min-w-0 shrink-0 flex-wrap items-center gap-2 overflow-visible border-b border-white/5 px-2 py-2 @min-[1320px]/deck:flex-nowrap">
            <strong class="shrink-0 whitespace-nowrap font-serif text-[15px]">Book Studio</strong><span>/</span><span class="h-[23px] w-4 shrink-0"></span>
            <select class="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs @min-[1320px]/deck:max-w-[170px] @min-[1320px]/deck:flex-none"><option>A long active book title</option></select><button class="h-[28px] w-[28px] shrink-0">R</button>
            <button id="new-book" class="hidden shrink-0 px-3 py-1.5 text-[11px] @min-[980px]/deck:inline-flex">+ New Book</button><div class="flex-1"></div>
            <span id="status" class="hidden shrink-0 whitespace-nowrap text-[11.5px] @min-[980px]/deck:flex">10 ready · 0 working · 0 exception</span>
            <div id="mode" class="hidden shrink-0 @min-[980px]/deck:flex"><button class="shrink-0 px-3 py-1.5 text-[10.5px]">Co-writer ·1</button><button class="shrink-0 px-3 py-1.5 text-[10.5px]">Chapter ·2</button><button class="shrink-0 px-3 py-1.5 text-[10.5px]">Act ·3</button></div>
            <button class="hidden shrink-0 px-3 py-1.5 text-[11px] @min-[980px]/deck:inline-flex">Taste</button>
            <button id="run-plan" class="hidden shrink-0 px-3 py-1.5 text-[11px] @min-[980px]/deck:inline-flex">Run Plan</button>
            <button id="review" class="hidden shrink-0 px-3 py-1.5 text-[11px] @min-[980px]/deck:inline-flex">Review</button>
            <button class="h-11 w-11 shrink-0 @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]">C</button>
            <button class="h-11 w-11 shrink-0 @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]">M</button>
            <button class="hidden shrink-0 px-3 py-1.5 text-[11px] @min-[980px]/deck:inline-flex">Export</button>
          </header>
          <nav id="compact-tools" class="grid min-h-11 shrink-0 grid-cols-4 @min-[980px]/deck:hidden"><button>Chapters</button><button>Story Bible</button><button>Inspect</button><button>Tools</button></nav>
          <div class="grid min-h-0 min-w-0 flex-1 grid-cols-1 @min-[760px]/deck:grid-cols-[240px_minmax(0,1fr)] @min-[1100px]/deck:grid-cols-[272px_minmax(0,1fr)_322px]">
            <div id="rail-shell" class="hidden min-h-0 @min-[760px]/deck:block"><aside id="rail" class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
              <div class="grid shrink-0 grid-cols-2 p-1" role="tablist"><button id="chapters-tab">Chapters 10</button><button id="bible-tab">Story Bible 15</button></div>
              <section id="chapter-panel" class="min-h-0 flex-1 overflow-y-auto">${Array.from({ length: 10 }, (_, i) => `<button class="block min-h-9 w-full">Chapter ${i + 1}</button>`).join("")}</section>
              <section id="bible-panel" class="min-h-0 flex-1 overflow-y-auto" hidden>${sections.map((label) => `<button class="block min-h-8 w-full">${label}</button>`).join("")}</section>
            </aside></div>
            <main id="center" class="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <div class="flex min-h-0 flex-1 flex-col">
                <header class="shrink-0 p-3"><h1 class="m-0">Chapter 1</h1><div>Locked · Beat plan</div></header>
                <div class="flex shrink-0 gap-4 overflow-x-auto p-2">Compile Draft Critique Revise De-AI Canon</div>
                <div class="flex shrink-0 gap-4 p-2"><button>Beats</button><button>Prose</button><button>Context</button><button>Bible</button></div>
                <div id="view-scroll" class="flex min-h-0 flex-1 overflow-hidden px-3 py-4 sm:px-5">
                  <div id="manuscript" class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    <div class="flex shrink-0 flex-wrap gap-2 border-b p-3"><select><option>Chapter 1</option></select><strong>Chapter title</strong><button>Redraft</button><button>Annotations</button><button>Preview</button><button>Focus</button></div>
                    <div id="manuscript-body" class="flex min-h-0 flex-1 overflow-hidden"><textarea id="editor" class="h-full w-full resize-none p-4">${Array.from({ length: 100 }, (_, i) => `Manuscript line ${i + 1}`).join("\n")}</textarea></div>
                    <div class="shrink-0 border-t p-2">1,789 words · Saved</div>
                  </div>
                </div>
                <footer class="flex shrink-0 gap-2 p-3"><button>Your call</button><button>Draft</button><button>Re-run gate</button></footer>
              </div>
            </main>
            <aside id="inspector" class="hidden @min-[1100px]/deck:block"></aside>
          </div>
        </section>
      </div>
    </body></html>`);
    await page.addStyleTag({ path: path.resolve("ui/dist/assets", cssFile) });
    await page.evaluate(() => {
      document.querySelector("#chapter-panel").hidden = true;
      document.querySelector("#bible-panel").hidden = false;
    });

    const geometry = await page.evaluate(({ viewportWidth }) => {
      const byId = (id) => document.getElementById(id);
      const deckWidth = byId("deck").getBoundingClientRect().width;
      const topbar = byId("topbar").getBoundingClientRect();
      const visibleTopbarControls = [...byId("topbar").children].filter((node) => getComputedStyle(node).display !== "none");
      const centerScrollOwners = [...byId("center").querySelectorAll("*")].filter((node) => {
        const style = getComputedStyle(node);
        return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      }).map((node) => node.id || node.tagName.toLowerCase());
      const bibleLabels = [...byId("bible-panel").querySelectorAll("button")].map((button) => button.textContent);
      return {
        deckWidth,
        deckHeight: byId("deck").getBoundingClientRect().height,
        documentOverflow: document.documentElement.scrollWidth > viewportWidth,
        topbarHeight: topbar.height,
        topbarEscape: visibleTopbarControls.some((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < topbar.left - 0.5 || rect.right > topbar.right + 0.5 || rect.top < topbar.top - 0.5 || rect.bottom > topbar.bottom + 0.5;
        }),
        denseControlsVisible: getComputedStyle(byId("run-plan")).display !== "none" && getComputedStyle(byId("review")).display !== "none",
        compactToolsVisible: getComputedStyle(byId("compact-tools")).display !== "none",
        railVisible: getComputedStyle(byId("rail-shell")).display !== "none",
        chaptersHidden: byId("chapter-panel").hidden,
        bibleVisible: !byId("bible-panel").hidden,
        bibleLabels,
        manuscriptBodyHeight: byId("manuscript-body").getBoundingClientRect().height,
        centerHeight: byId("center").getBoundingClientRect().height,
        viewHeight: byId("view-scroll").getBoundingClientRect().height,
        manuscriptHeight: byId("manuscript").getBoundingClientRect().height,
        outerEditorOverflow: getComputedStyle(byId("view-scroll")).overflowY,
        centerScrollOwners,
      };
    }, { viewportWidth: testCase.width });

    const failures = [];
    const denseExpected = geometry.deckWidth >= 980;
    if (geometry.documentOverflow) failures.push("document overflow");
    if (geometry.topbarEscape) failures.push("topbar controls clipped or escaped");
    if (geometry.denseControlsVisible !== denseExpected) failures.push("Run/Review breakpoint mismatch");
    if (geometry.compactToolsVisible === denseExpected) failures.push("compact tools breakpoint mismatch");
    if (geometry.railVisible !== (geometry.deckWidth >= 760)) failures.push("rail breakpoint mismatch");
    if (geometry.railVisible && (!geometry.chaptersHidden || !geometry.bibleVisible)) failures.push("rail modes are still stacked");
    if (geometry.railVisible && sections.some((label) => !geometry.bibleLabels.includes(label))) failures.push("complete Story Bible is missing sections");
    if (geometry.outerEditorOverflow !== "hidden") failures.push("outer prose container can scroll");
    if (!geometry.centerScrollOwners.includes("editor") || geometry.centerScrollOwners.length !== 1) failures.push(`expected editor-only scroll owner, got ${geometry.centerScrollOwners.join(", ")}`);
    if (geometry.manuscriptBodyHeight < 180) failures.push(`manuscript body too short: ${geometry.manuscriptBodyHeight}px`);
    results.push({ ...testCase, ...geometry, failures });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.failures.length)) process.exitCode = 1;

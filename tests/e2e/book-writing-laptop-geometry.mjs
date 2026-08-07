import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const cssFile = fs.readdirSync(path.resolve("ui/dist/assets"))
  .find((name) => /^index-.*\.css$/.test(name));
if (!cssFile) throw new Error("Built UI stylesheet not found; run the UI build first.");

const cases = [
  { width: 1366, height: 768, sidebars: [208, 240, 420] },
  { width: 1093, height: 614, sidebars: [208, 240, 420] },
  { width: 911, height: 512, sidebars: [208, 240, 420] },
  { width: 1440, height: 900, sidebars: [208, 240, 420] },
  { width: 430, height: 932, sidebars: [0] },
  { width: 375, height: 812, sidebars: [0] },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const testCase of cases) {
    for (const sidebar of testCase.sidebars) {
      const page = await browser.newPage({ viewport: { width: testCase.width, height: testCase.height } });
      await page.setContent(`<!doctype html><html><body style="margin:0;overflow:hidden;background:#05070b">
        <div id="shell" style="display:grid;grid-template-columns:${sidebar}px minmax(0,1fr);width:100vw;height:100vh">
          <aside></aside>
          <section id="deck" class="@container/deck grid h-full min-w-0 grid-rows-[52px_auto_minmax(0,1fr)] overflow-x-hidden">
            <header id="topbar" class="flex h-[52px] min-w-0 items-center gap-2 overflow-hidden px-2 @min-[1100px]/deck:gap-3.5 @min-[1100px]/deck:px-4">
              <div class="whitespace-nowrap">Book Studio</div><span>/</span><span class="h-[23px] w-4 shrink-0"></span>
              <select class="min-w-0 flex-1 truncate @min-[1100px]/deck:max-w-[170px] @min-[1100px]/deck:flex-none"><option>A very long active book title that must truncate</option></select>
              <button class="h-[28px] w-[28px] shrink-0">R</button><button class="hidden @min-[1100px]/deck:inline-flex">New Book</button><div class="flex-1"></div>
              <div class="hidden whitespace-nowrap @min-[1100px]/deck:flex">10 ready · 0 working · 0 exception</div>
              <div class="hidden @min-[1100px]/deck:flex"><button>Co-writer</button><button>Chapter</button><button>Act</button></div>
              <button class="hidden @min-[1100px]/deck:inline-flex">Taste</button><button class="hidden @min-[1100px]/deck:inline-flex">Run Plan</button>
              <button class="h-11 w-11 shrink-0 @min-[1100px]/deck:h-[30px] @min-[1100px]/deck:w-[30px]">B</button><button class="h-11 w-11 shrink-0 @min-[1100px]/deck:h-[30px] @min-[1100px]/deck:w-[30px]">M</button>
              <button class="hidden @min-[1100px]/deck:inline-flex">Export</button>
            </header>
            <nav id="tools" class="grid grid-cols-4 @min-[1100px]/deck:hidden"><button>Chapters</button><button>Story Bible</button><button>Inspect</button><button>Tools</button></nav>
            <div id="panes" class="grid min-h-0 min-w-0 grid-cols-1 @min-[760px]/deck:grid-cols-[240px_minmax(0,1fr)] @min-[1100px]/deck:grid-cols-[272px_minmax(0,1fr)_322px]">
              <aside id="rail" class="hidden min-h-0 @min-[760px]/deck:block"></aside>
              <main id="center" class="min-w-0 overflow-hidden">
                <div id="stages" class="flex min-w-0 items-center gap-2 overflow-x-auto">${["Compile", "Draft", "Critique", "Revise", "Deep AI", "Canon", "Release"].map((label, index) => `${index ? '<i class="mx-2 h-px w-4 shrink-0"></i>' : ""}<span class="flex shrink-0 whitespace-nowrap">${label}</span>`).join("")}</div>
                <div id="manuscript" class="@container/manuscript min-w-0">
                  <div id="editor-toolbar" class="flex flex-col gap-2 px-3 @min-[760px]/manuscript:flex-row @min-[760px]/manuscript:justify-between">
                    <div class="flex min-w-0 flex-1"><select class="min-w-0 max-w-[55%] flex-1 truncate"><option>Ch. 1: A very long chapter selector</option></select><div class="min-w-0 flex-1">Chapter identity</div><button>Lock</button></div>
                    <div id="actions" class="flex w-full min-w-0 gap-2 overflow-x-auto @min-[760px]/manuscript:w-auto @min-[760px]/manuscript:flex-wrap @min-[760px]/manuscript:overflow-visible">${["Redraft", "Mark Done", "Annotations", "Preview", "Focus"].map((label) => `<button class="shrink-0 whitespace-nowrap">${label}</button>`).join("")}</div>
                  </div>
                </div>
              </main>
              <aside id="inspector" class="hidden min-h-0 @min-[1100px]/deck:block"></aside>
            </div>
          </section>
        </div></body></html>`);
      await page.addStyleTag({ path: path.resolve("ui/dist/assets", cssFile) });

      const geometry = await page.evaluate(({ viewportWidth, sidebarWidth }) => {
        const byId = (id) => document.getElementById(id);
        const deck = byId("deck");
        const rail = byId("rail");
        const center = byId("center");
        const inspector = byId("inspector");
        const panes = [rail, center, inspector].filter((node) => getComputedStyle(node).display !== "none");
        const rects = panes.map((node) => ({ id: node.id, ...node.getBoundingClientRect().toJSON() }));
        const intersections = rects.some((rect, index) => index > 0 && rect.left < rects[index - 1].right - 0.5);
        const topbar = byId("topbar").getBoundingClientRect();
        const visibleTopbarControls = [...byId("topbar").children].filter((node) => getComputedStyle(node).display !== "none");
        const topbarOutside = visibleTopbarControls.some((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < topbar.left - 0.5 || rect.right > topbar.right + 0.5;
        });
        const deckWidth = deck.getBoundingClientRect().width;
        const expectedPanes = deckWidth >= 1100 ? 3 : deckWidth >= 760 ? 2 : 1;
        return {
          viewportWidth,
          sidebarWidth,
          deckWidth,
          panes: rects.map((rect) => rect.id),
          expectedPanes,
          documentOverflow: document.documentElement.scrollWidth > viewportWidth,
          intersections,
          topbarOutside,
          stageLocallyScrollable: byId("stages").scrollWidth >= byId("stages").clientWidth,
          stageWraps: [...byId("stages").querySelectorAll("span")].some((node) => getComputedStyle(node).whiteSpace !== "nowrap"),
          actionsOutsideToolbar: byId("actions").getBoundingClientRect().right > byId("editor-toolbar").getBoundingClientRect().right + 0.5,
        };
      }, { viewportWidth: testCase.width, sidebarWidth: sidebar });
      const failures = [];
      if (geometry.panes.length !== geometry.expectedPanes) failures.push(`expected ${geometry.expectedPanes} panes, got ${geometry.panes.length}`);
      if (geometry.documentOverflow) failures.push("document overflow");
      if (geometry.intersections) failures.push("pane intersection");
      if (geometry.topbarOutside) failures.push("topbar control outside header");
      if (geometry.stageWraps) failures.push("stage label wrapped");
      if (geometry.actionsOutsideToolbar) failures.push("actions outside toolbar");
      results.push({ ...geometry, failures });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.failures.length)) process.exitCode = 1;

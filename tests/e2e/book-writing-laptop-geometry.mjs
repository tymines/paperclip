import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const cssFile = fs.readdirSync(path.resolve("ui/dist/assets"))
  .find((name) => /^index-.*\.css$/.test(name));
if (!cssFile) throw new Error("Built UI stylesheet not found; run the UI build first.");

const cases = [
  { width: 1100, height: 768, sidebars: [0] },
  { width: 1280, height: 800, sidebars: [0] },
  { width: 1320, height: 800, sidebars: [0] },
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
            <header id="topbar" class="flex h-[52px] min-w-0 items-center gap-2 overflow-hidden border-b border-white/5 bg-[#0a0c10] px-2 @min-[1320px]/deck:gap-3.5 @min-[1320px]/deck:px-4">
              <div class="font-serif text-[15px] whitespace-nowrap text-white">Book <em class="not-italic text-white">Studio</em></div><span class="text-gray-600">/</span><span class="h-[23px] w-4 shrink-0 self-center rounded-sm border border-white/15"></span>
              <select class="min-w-0 flex-1 truncate rounded-md border border-white/20 px-2 py-1 text-xs @min-[1320px]/deck:max-w-[170px] @min-[1320px]/deck:flex-none"><option>A very long active book title that must truncate</option></select>
              <button class="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-md border">R</button><button id="new-book" class="hidden shrink-0 items-center whitespace-nowrap rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide @min-[1320px]/deck:inline-flex">+ New Book</button><div class="flex-1"></div>
              <div id="status" class="hidden shrink-0 items-center gap-2 whitespace-nowrap text-[11.5px] tabular-nums @min-[1320px]/deck:flex"><span class="h-1.5 w-1.5"></span><span>10 ready · 0 working · 0 exception</span></div>
              <div id="director-mode" class="hidden shrink-0 overflow-hidden rounded-md border @min-[1320px]/deck:flex">${["Co-writer ·1", "Chapter ·2", "Act ·3"].map((label) => `<button class="shrink-0 whitespace-nowrap border-r px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide">${label}</button>`).join("")}</div>
              <button class="hidden shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide @min-[1320px]/deck:inline-flex">Taste</button><button class="hidden shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide @min-[1320px]/deck:inline-flex">Run Plan</button>
              <button class="grid h-11 w-11 shrink-0 place-items-center rounded-md border @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]">B</button><button class="grid h-11 w-11 shrink-0 place-items-center rounded-md border @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]">M</button>
              <button class="hidden shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide @min-[1320px]/deck:inline-flex">Export</button>
            </header>
            <nav id="tools" class="grid grid-cols-4 @min-[1320px]/deck:hidden"><button>Chapters</button><button>Story Bible</button><button>Inspect</button><button>Tools</button></nav>
            <div id="panes" class="grid min-h-0 min-w-0 grid-cols-1 @min-[760px]/deck:grid-cols-[240px_minmax(0,1fr)] @min-[1100px]/deck:grid-cols-[272px_minmax(0,1fr)_322px]">
              <aside id="rail" class="hidden min-h-0 @min-[760px]/deck:block"></aside>
              <main id="center" class="min-w-0 overflow-hidden">
                <div id="stages" class="flex min-w-0 items-center gap-2 overflow-x-auto">${["Compile", "Draft", "Critique", "Revise", "Deep AI", "Canon", "Release"].map((label, index) => `${index ? '<i class="mx-2 h-px w-4 shrink-0"></i>' : ""}<span class="flex shrink-0 whitespace-nowrap">${label}</span>`).join("")}</div>
                <div id="manuscript" class="@container/manuscript min-w-0">
                  <div id="editor-toolbar" class="flex flex-col gap-2 px-3 @min-[760px]/manuscript:flex-row @min-[760px]/manuscript:justify-between">
                    <div class="flex min-w-0 flex-1"><select class="min-w-0 max-w-[55%] flex-1 truncate"><option>Ch. 1: A very long chapter selector</option></select><div class="min-w-0 flex-1">Chapter identity</div><button>Lock</button></div>
                    <div id="actions" class="flex w-full min-w-0 gap-2 overflow-x-auto @min-[760px]/manuscript:w-auto @min-[760px]/manuscript:flex-wrap @min-[760px]/manuscript:overflow-visible">${["Redraft", "Mark Done", "Annotations", "Preview", "Focus"].map((label) => `<button class="shrink-0 whitespace-nowrap">${label}</button>`).join("")}</div>
                  </div>
                  <div id="manuscript-body" class="flex min-h-72 flex-1 overflow-hidden sm:min-h-[clamp(18rem,50dvh,36rem)]"><textarea class="h-full w-full"></textarea></div>
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
        const topbarVerticalEscape = visibleTopbarControls.some((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top < topbar.top - 0.5 || rect.bottom > topbar.bottom + 0.5;
        });
        const deckWidth = deck.getBoundingClientRect().width;
        const expectedPanes = deckWidth >= 1100 ? 3 : deckWidth >= 760 ? 2 : 1;
        const denseToolbarExpected = deckWidth >= 1320;
        const directorMode = byId("director-mode");
        return {
          viewportWidth,
          sidebarWidth,
          deckWidth,
          panes: rects.map((rect) => rect.id),
          expectedPanes,
          documentOverflow: document.documentElement.scrollWidth > viewportWidth,
          intersections,
          topbarOutside,
          topbarVerticalEscape,
          denseToolbarExpected,
          denseToolbarVisible: getComputedStyle(byId("new-book")).display !== "none",
          toolsVisible: getComputedStyle(byId("tools")).display !== "none",
          directorModeWraps: getComputedStyle(directorMode).display !== "none" && (
            directorMode.scrollWidth > directorMode.clientWidth + 0.5
            || [...directorMode.querySelectorAll("button")].some((button) => button.scrollWidth > button.clientWidth + 0.5 || getComputedStyle(button).whiteSpace !== "nowrap")
          ),
          stageLocallyScrollable: byId("stages").scrollWidth >= byId("stages").clientWidth,
          stageWraps: [...byId("stages").querySelectorAll("span")].some((node) => getComputedStyle(node).whiteSpace !== "nowrap"),
          actionsOutsideToolbar: byId("actions").getBoundingClientRect().right > byId("editor-toolbar").getBoundingClientRect().right + 0.5,
          manuscriptBodyHeight: byId("manuscript-body").getBoundingClientRect().height,
        };
      }, { viewportWidth: testCase.width, sidebarWidth: sidebar });
      const failures = [];
      if (geometry.panes.length !== geometry.expectedPanes) failures.push(`expected ${geometry.expectedPanes} panes, got ${geometry.panes.length}`);
      if (geometry.documentOverflow) failures.push("document overflow");
      if (geometry.intersections) failures.push("pane intersection");
      if (geometry.topbarOutside) failures.push("topbar control outside header");
      if (geometry.topbarVerticalEscape) failures.push("topbar control outside 52px vertical bounds");
      if (geometry.denseToolbarVisible !== geometry.denseToolbarExpected) failures.push("dense toolbar visibility threshold mismatch");
      if (geometry.toolsVisible === geometry.denseToolbarExpected) failures.push("Tools sheet trigger visibility mismatch");
      if (geometry.directorModeWraps) failures.push("Director Mode shrank or wrapped");
      if (geometry.stageWraps) failures.push("stage label wrapped");
      if (geometry.actionsOutsideToolbar) failures.push("actions outside toolbar");
      if (geometry.manuscriptBodyHeight < 287.5) failures.push(`manuscript body too short: ${geometry.manuscriptBodyHeight}px`);
      results.push({ ...geometry, failures });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.failures.length)) process.exitCode = 1;

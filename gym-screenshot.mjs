import { chromium } from "playwright";
import fs from "fs";

const apiKey = fs.readFileSync("C:\\Users\\Augi-T1\\AppData\\Local\\Temp\\gym-test-key.txt", "utf8").trim();
const outPath = "C:\\Users\\Augi-T1\\AppData\\Local\\Temp\\gym-screenshot.png";
const CID = "7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4";
const BASE = "http://localhost:3100/api";

// Fetch data in Node first
const authHeader = "Bearer " + apiKey;
async function fetchAPI(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: authHeader } });
  return res.json();
}
const [runs, agents, stats] = await Promise.all([
  fetchAPI("/companies/" + CID + "/gym/evolution-runs"),
  fetchAPI("/companies/" + CID + "/gym/agents"),
  fetchAPI("/companies/" + CID + "/gym/skills-stats"),
]);
console.log("Runs:", runs.length, "Agents:", agents.length, "Stats:", stats.length);

// Build HTML
const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head><meta charset="UTF-8"><title>Paperclip Gym</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#d4d4d8;font-family:system-ui,sans-serif;padding:24px}
h1{font-size:20px;font-weight:600;color:#e4e4e7;margin-bottom:4px}
.subhead{font-size:13px;color:#a1a1aa;margin-bottom:24px}
.card{border:1px solid #27272a;border-radius:8px;background:#0a0a0b;overflow:hidden;margin-bottom:20px}
.card-header{border-bottom:1px solid #27272a;padding:12px 16px;font-size:13px;font-weight:500;color:#d4d4d8}
.feed-item{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid #27272a40;transition:background .15s}
.feed-item:hover{background:#18181b30}
.feed-icon{font-size:16px;flex-shrink:0;margin-top:1px}
.feed-body{flex:1;min-width:0}
.feed-title{font-size:14px;font-weight:500;color:#e4e4e7}
.feed-badge{font-size:11px;color:#71717a;margin-left:8px}
.feed-works{font-size:12px;color:#4ade8090;margin-top:4px;line-height:1.45}
.feed-works span{color:#4ade80;font-weight:500}
.feed-failed{font-size:12px;color:#f8717190;margin-top:2px;line-height:1.45}
.feed-failed span{color:#f87171;font-weight:500}
.feed-rationale{font-size:12px;color:#a1a1aa;margin-top:2px;font-style:italic}
.feed-score{display:flex;align-items:center;gap:6px;font-size:11px;margin-top:4px}
.agents-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.agent-card{border:1px solid #27272a;border-radius:8px;background:#0a0a0b;padding:14px}
.agent-status{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-right:8px}
.agent-name{font-size:13px;font-weight:500;color:#d4d4d8}
.agent-meta{display:flex;justify-content:space-between;font-size:11px;color:#71717a;margin-top:6px}
.stats-table{width:100%;border-collapse:collapse}
.stats-table th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#a1a1aa;text-align:left;padding:8px 12px;border-bottom:1px solid #27272a;background:#18181b30}
.stats-table td{font-size:13px;padding:10px 12px;border-bottom:1px solid #27272a40}
.stats-table tr:hover{background:#18181b30}
.empty{text-align:center;padding:32px;color:#71717a;font-size:13px}
.section-label{font-size:13px;font-weight:500;color:#d4d4d8;margin:20px 0 10px}
</style></head>
<body>
<h1>Gym</h1>
<p class="subhead">Agent self-improvement dashboard</p>

<div id="feed"></div>
<div class="section-label">Per-Agent Cards</div>
<div id="agents" class="agents-grid"></div>
<div class="section-label">Skill Scoreboard</div>
<div id="stats"></div>
<script>
window.__DATA = __PLACEHOLDER__;
</script>
</body></html>`;

// Inject data
const dataScript = `window.__DATA = ${JSON.stringify({ runs, agents, stats })};\n` +
`function icon(a) {
  if(a==="skill.created") return "\\u{1F331}";
  if(a==="skill.evolution_proposed") return "\\u{1F4A1}";
  if(a==="skill.evolution_accepted") return "\\u2705";
  if(a==="skill.evolution_rejected") return "\\u274C";
  return "\\u{1F4CC}";
}
function label(a) {
  if(a==="skill.created") return "created";
  if(a.includes("accepted")) return "approved evolution";
  if(a.includes("rejected")) return "rejected evolution";
  if(a.includes("proposed")) return "proposed evolution";
  return a;
}
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
const {runs, agents, stats} = window.__DATA;
document.getElementById("feed").innerHTML = '<div class="card"><div class="card-header">Live Self-Improvement Feed</div>' +
  (runs.length === 0 ? '<div class="empty">No events yet</div>' :
  runs.slice(0, 15).map(r => {
    const d = r.details || {};
    const ds = r.delta > 0 ? "color:#4ade80" : r.delta < 0 ? "color:#f87171" : "color:#71717a";
    return '<div class="feed-item"><div class="feed-icon">' + icon(r.status) + '</div><div class="feed-body">' +
      '<div><span class="feed-title">' + esc(r.targetSkill) + '</span><span class="feed-badge">' + label(r.status) + '</span></div>' +
      (d.whatWorks ? '<div class="feed-works"><span>Works:</span> ' + esc(d.whatWorks) + '</div>' : '') +
      (d.whatFailed ? '<div class="feed-failed"><span>Failed:</span> ' + esc(d.whatFailed) + '</div>' : '') +
      (d.rationale ? '<div class="feed-rationale">' + esc(d.rationale) + '</div>' : '') +
      (d.beforeScore != null && d.afterScore != null ? '<div class="feed-score"><span style="color:#71717a">' + d.beforeScore + '</span><span style="color:#52525b"> \u2192 </span><span style="' + ds + '">' + d.afterScore + '</span><span style="' + ds + ';font-weight:500"> (' + (r.delta > 0 ? "+" : "") + r.delta + ')</span></div>' : '') +
      '</div></div>';
  }).join("")) + '</div>';
document.getElementById("agents").innerHTML = agents.map(a =>
  '<div class="agent-card"><div><span class="agent-status"></span><span class="agent-name">' + esc(a.name) + '</span></div>' +
  '<div class="agent-meta"><span>' + a.status + '</span><span>' + a.skillCount + ' skills</span></div></div>'
).join("");
document.getElementById("stats").innerHTML = '<div class="card"><div class="card-header">Skill Scoreboard</div>' +
  (stats.length === 0 ? '<div class="empty">No skills scored yet</div>' :
  '<table class="stats-table"><thead><tr><th>Skill</th><th>Score</th><th>Last Improved</th></tr></thead><tbody>' +
  stats.map(s => '<tr><td>' + esc(s.skill) + '</td><td>' + s.score + '</td><td style="color:#71717a">' + new Date(s.lastImproved).toLocaleString() + '</td></tr>').join("") +
  '</tbody></table>') + '</div>';`;

const finalHtml = html.replace("__PLACEHOLDER__", dataScript);
const htmlPath = "C:\\Users\\Augi-T1\\AppData\\Local\\Temp\\gym-standalone.html";
fs.writeFileSync(htmlPath, finalHtml);
console.log("HTML written:", finalHtml.length, "bytes");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "load", timeout: 10000 });
await page.waitForTimeout(1000);

const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
console.log("Rendered:", text);

await page.screenshot({ path: outPath, fullPage: true });
console.log("Saved:", outPath);
await browser.close();

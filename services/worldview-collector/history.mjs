import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const DAY = 86_400_000;
const RETENTION = 7 * DAY;
const FEEDS = ["quakes", "firms", "eonet", "news"];

export async function createHistoryStore(options = {}) {
  const dir = options.dir || process.env.WORLDVIEW_HISTORY_DIR || join(process.cwd(), ".history");
  const now = options.now || Date.now;
  const snapshots = new Map(FEEDS.map((feed) => [feed, []]));
  await mkdir(dir, { recursive: true });

  for (const name of await readdir(dir).catch(() => [])) {
    const match = name.match(/^(quakes|firms|eonet|news)-(\d+)\.json\.gz$/);
    if (!match) continue;
    const at = Number(match[2]);
    if (!Number.isFinite(at) || now() - at > RETENTION) { await rm(join(dir, name), { force: true }); continue; }
    try {
      const payload = JSON.parse((await unzip(await readFile(join(dir, name)))).toString("utf8"));
      snapshots.get(match[1]).push({ at, payload, file: name });
    } catch { await rm(join(dir, name), { force: true }); }
  }
  for (const rows of snapshots.values()) rows.sort((a, b) => a.at - b.at);

  async function prune() {
    const cutoff = now() - RETENTION;
    for (const rows of snapshots.values()) {
      while (rows.length && rows[0].at < cutoff) {
        const old = rows.shift();
        if (old?.file) await rm(join(dir, old.file), { force: true });
      }
    }
  }

  return {
    async record(feed, payload, at = now()) {
      if (!snapshots.has(feed) || !payload || !Array.isArray(payload.items)) return;
      const rows = snapshots.get(feed);
      const previous = rows[rows.length - 1];
      const digest = JSON.stringify(payload);
      if (previous?.digest === digest) return;
      const file = `${feed}-${at}.json.gz`;
      await writeFile(join(dir, file), await zip(digest));
      rows.push({ at, payload, digest, file });
      await prune();
    },
    frame(at) {
      const feeds = { flights: { status: "live_only", source: "OpenSky", items: [], note: "Flights have no fabricated history." } };
      const gaps = [];
      for (const feed of FEEDS) {
        const rows = snapshots.get(feed);
        let best = null;
        for (const row of rows) {
          if (row.at <= at && (!best || row.at > best.at)) best = row;
        }
        if (!best || at - best.at > 30 * 60_000) {
          gaps.push(feed);
          feeds[feed] = { status: "gap", source: feed, items: [], note: "No collector snapshot near this time." };
        } else feeds[feed] = { ...best.payload, snapshotAt: new Date(best.at).toISOString() };
      }
      return { at: new Date(at).toISOString(), feeds, gaps };
    },
    stats() {
      return Object.fromEntries([...snapshots].map(([feed, rows]) => [feed, { count: rows.length, oldestAt: rows[0]?.at || null, newestAt: rows[rows.length - 1]?.at || null }]));
    },
  };
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHistoryStore } from "./history.mjs";

test("history keeps real snapshots, reports gaps, and never invents flight history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wv-history-"));
  const now = Date.parse("2026-07-28T12:00:00Z");
  try {
    const history = await createHistoryStore({ dir, now: () => now });
    await history.record("quakes", { status: "live", source: "USGS", items: [{ id: "q1", time: now - 120_000 }] }, now - 120_000);
    await history.record("eonet", { status: "live", source: "EONET", items: [{ id: "e1" }] }, now - 120_000);
    const frame = history.frame(now - 90_000);
    assert.equal(frame.feeds.quakes.items[0].id, "q1");
    assert.equal(frame.feeds.eonet.items[0].id, "e1");
    assert.equal(frame.feeds.flights.status, "live_only");
    assert.ok(frame.gaps.includes("firms"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history prunes snapshots older than seven days", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wv-history-"));
  const now = Date.parse("2026-07-28T12:00:00Z");
  try {
    const history = await createHistoryStore({ dir, now: () => now });
    await history.record("news", { status: "live", source: "GDELT", items: [{ id: "old" }] }, now - 8 * 86400_000);
    await history.record("news", { status: "live", source: "GDELT", items: [{ id: "new" }] }, now);
    assert.equal(history.frame(now).feeds.news.items[0].id, "new");
    assert.equal(history.stats().news.count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRailEventsPath } from "./home-paths.js";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveRailEventsPath", () => {
  it("keeps the canonical journal under PAPERCLIP_HOME instead of the cwd", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-rail-home-"));
    tempDirs.push(home);
    process.env.PAPERCLIP_HOME = home;
    delete process.env.RAIL_EVENTS_LOG;

    expect(resolveRailEventsPath()).toBe(path.resolve(home, "rail", "rail-events.jsonl"));
  });

  it("honors an explicit runtime journal override", () => {
    const target = path.join(os.tmpdir(), "paperclip-rail-override.jsonl");
    expect(resolveRailEventsPath(target)).toBe(path.resolve(target));
  });
});

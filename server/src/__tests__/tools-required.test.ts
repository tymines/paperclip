import { describe, expect, it } from "vitest";
import {
  parseToolsRequired,
  normalizeManifest,
} from "../services/tools-required.js";

const FULL_PLAN = `FINAL PLAN (converged):

1. Add the X component (files: a.ts; change/test/verify ...)
2. Wire it up (files: b.ts; ...)

\`\`\`tools-required
{
  "version": 1,
  "servers": ["context7", "playwright"],
  "skills": ["pdf", "canvas-design"],
  "tools_allow": ["context7_search", "playwright_navigate"],
  "tools_deny": [],
  "baseline_servers": ["context7"],
  "teardown": "reset-to-baseline",
  "reason": "PDF report build needs browser capture + library docs",
  "ttl_seconds": 1800
}
\`\`\``;

describe("parseToolsRequired", () => {
  it("(a) parses a fenced tools-required block out of a plan artifact", () => {
    const m = parseToolsRequired(FULL_PLAN);
    expect(m).not.toBeNull();
    expect(m!.version).toBe(1);
    expect(m!.servers).toEqual(["context7", "playwright"]);
    expect(m!.skills).toEqual(["pdf", "canvas-design"]);
    expect(m!.tools_allow).toEqual(["context7_search", "playwright_navigate"]);
    expect(m!.teardown).toBe("reset-to-baseline");
    expect(m!.ttl_seconds).toBe(1800);
  });

  it("(e) a plan WITHOUT the block returns null (lean baseline, back-compat)", () => {
    const plain = "FINAL PLAN (window closed):\n\n1. do a thing\n2. do another";
    expect(parseToolsRequired(plain)).toBeNull();
    expect(parseToolsRequired("")).toBeNull();
    expect(parseToolsRequired(undefined)).toBeNull();
  });

  it("applies documented defaults for a minimal block", () => {
    const text = "plan...\n```tools-required\n{ \"version\": 1 }\n```";
    const m = parseToolsRequired(text);
    expect(m).not.toBeNull();
    expect(m!.servers).toEqual([]);
    expect(m!.skills).toEqual([]);
    expect(m!.baseline_servers).toEqual(["context7"]);
    expect(m!.teardown).toBe("reset-to-baseline");
    expect(m!.ttl_seconds).toBe(1800);
  });

  it("malformed JSON in the block => null (never throws, baseline)", () => {
    const text = "plan...\n```tools-required\n{ not valid json )\n```";
    expect(parseToolsRequired(text)).toBeNull();
  });

  it("missing/invalid version => null", () => {
    expect(normalizeManifest({ servers: ["x"] })).toBeNull();
    expect(normalizeManifest({ version: 0 })).toBeNull();
    expect(normalizeManifest({ version: "1" })).toBeNull();
  });

  it("coerces 'keep' teardown and drops non-string array entries", () => {
    const m = normalizeManifest({
      version: 1,
      servers: ["a", 2, null, "b"],
      teardown: "keep",
    });
    expect(m!.servers).toEqual(["a", "b"]);
    expect(m!.teardown).toBe("keep");
  });

  it("(b) result is shaped to ride delegation metadata.tools_required verbatim", () => {
    // Mirrors the route's attach: metadata gets a tools_required field only when
    // the manifest is present; absent stays absent (lean baseline).
    const m = parseToolsRequired(FULL_PLAN);
    const metadata = {
      kind: "plan-approval",
      ...(m ? { tools_required: m } : {}),
    } as Record<string, unknown>;
    expect(metadata.tools_required).toBeDefined();
    // round-trips through JSON (the transport is JSON.stringify(payload))
    const carried = JSON.parse(JSON.stringify(metadata));
    expect(carried.tools_required.servers).toEqual(["context7", "playwright"]);

    const none = parseToolsRequired("no block here");
    const baselineMeta = {
      kind: "plan-approval",
      ...(none ? { tools_required: none } : {}),
    } as Record<string, unknown>;
    expect("tools_required" in baselineMeta).toBe(false);
  });
});

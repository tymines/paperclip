import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Counts lines in lsof -p <pid> that reference filePath. Each open fd against
// the file produces one matching row. POSIX only — skipped on Windows.
function countOpenFdsFor(filePath: string): number {
  try {
    const out = execSync(`lsof -p ${process.pid}`, { encoding: "utf8" });
    return out.split("\n").filter((line) => line.includes(filePath)).length;
  } catch {
    return 0;
  }
}

describe("run-log-store fd leak", () => {
  const canRunLsof = process.platform !== "win32";

  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "paperclip-run-log-fd-"));
    originalEnv = process.env.RUN_LOG_BASE_PATH;
    // Must be set before run-log-store.ts is first imported (cachedStore reads env once).
    process.env.RUN_LOG_BASE_PATH = tmpRoot;
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.RUN_LOG_BASE_PATH;
    else process.env.RUN_LOG_BASE_PATH = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("does not leak fds when readLog is called repeatedly", async () => {
    const { getRunLogStore } = await import("../services/run-log-store.js");
    const store = getRunLogStore();

    const handle = await store.begin({
      companyId: "test-co",
      agentId: "test-agent",
      runId: "test-run",
    });

    for (let i = 0; i < 50; i++) {
      await store.append(handle, {
        stream: "stdout",
        chunk: `line ${i} `.repeat(20),
        ts: new Date().toISOString(),
      });
    }

    const absPath = path.join(tmpRoot, handle.logRef);

    // Warm up so any lazy allocations settle before we measure.
    for (let i = 0; i < 10; i++) {
      await store.read(handle, { offset: 0, limitBytes: 4096 });
    }
    await new Promise((resolve) => setImmediate(resolve));

    const baseline = canRunLsof ? countOpenFdsFor(absPath) : 0;

    // Concurrent reads — this is the real-world shape (UI polls multiple
    // active runs in parallel). With the leaky createReadStream + raw Promise
    // pattern, the open fds against the file pile up well past the concurrent
    // request count because stream cleanup races behind new opens.
    const concurrency = 200;
    const rounds = 5;
    for (let r = 0; r < rounds; r++) {
      const batch = Array.from({ length: concurrency }, () =>
        store.read(handle, { offset: 0, limitBytes: 4096 }),
      );
      await Promise.all(batch);
    }
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (canRunLsof) {
      const after = countOpenFdsFor(absPath);
      // Expect fd count to return to baseline — concurrent reads must close
      // their handles before returning, not rely on async stream cleanup.
      expect(after - baseline).toBeLessThanOrEqual(3);
    } else {
      const result = await store.read(handle, { offset: 0, limitBytes: 4096 });
      expect(typeof result.content).toBe("string");
    }
  });
});

// PR #30 r7 — hermes-peer-bridge shim resource bounds.
//
// Proves, against the REAL shim module (imported, never executed as a
// daemon) with a STUB hermes binary and LOCAL dead-sink callback servers:
//   1. per-peer concurrency cap — excess POSTs are rejected 429, never an
//      unbounded process spawn;
//   2. captured stdout/stderr are byte-capped (ring buffer) with the
//      truncation noted in the result;
//   3. the callback fetch has an explicit timeout — a hanging callback
//      server cannot leave the shim hanging.
//
// Zero packets to :18790/:18791 or any live agent: the shim listens on an
// ephemeral loopback port, HERMES_BIN is a stub script, and every callback
// URL points at a test-owned dead sink.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createBridge, type BridgeConfig } from "../../../scripts/hermes-peer-bridge.mjs";

const AUTH = { "content-type": "application/json", authorization: "Bearer tok" };

let stubDir: string;
let stubBin: string;

beforeAll(() => {
  // Stub "hermes" CLI: emits STUB_OUT_TEXT (or a short answer) on stdout,
  // sleeps STUB_SLEEP_MS, exits STUB_EXIT. Ignores all argv.
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-bridge-test-"));
  stubBin = path.join(stubDir, "stub-hermes");
  fs.writeFileSync(
    stubBin,
    [
      "#!/usr/bin/env node",
      "const out = process.env.STUB_OUT_TEXT || 'stub answer';",
      "process.stdout.write(out + '\\n');",
      "if (process.env.STUB_ERR_TEXT) process.stderr.write(process.env.STUB_ERR_TEXT);",
      "setTimeout(() => process.exit(Number(process.env.STUB_EXIT || 0)), Number(process.env.STUB_SLEEP_MS || 0));",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
});

async function startBridge(overrides: Partial<BridgeConfig> = {}) {
  const { server } = createBridge({
    PORT: 0,
    HOST: "127.0.0.1",
    TOKEN: "tok",
    HERMES_BIN: stubBin,
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Dead-sink callback server: records POSTed bodies; optionally hangs. */
async function startSink(opts: { hang?: boolean } = {}) {
  const bodies: Array<{
    status?: string;
    result?: string;
    error?: string;
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
    stdoutBytes?: number;
    stderrBytes?: number;
  }> = [];
  const closes: boolean[] = [];
  let hangingReq: http.IncomingMessage | null = null;
  const server = http.createServer((req, res) => {
    if (opts.hang) {
      hangingReq = req;
      req.on("close", () => closes.push(true));
      return; // never respond — the client must time out
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        bodies.push({});
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    bodies,
    closes,
    get hangingReq() {
      return hangingReq;
    },
  };
}

function dispatchBody(callbackUrl: string, peer = "calliope") {
  return {
    kind: "jarvis-delegation",
    agent: peer,
    delegationId: `del-${Math.random().toString(36).slice(2, 8)}`,
    task: "say hi",
    callback: { url: callbackUrl, token: "cb-tok" },
  };
}

async function postDispatch(bridgeUrl: string, body: unknown) {
  const res = await fetch(`${bridgeUrl}/jarvis/dispatch`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitFor(cond: () => boolean, timeoutMs = 5_000, stepMs = 25) {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe("hermes-peer-bridge — resource bounds (PR #30 r7)", () => {
  it("caps concurrent dispatches per peer: excess POSTs are rejected 429, never spawned", async () => {
    vi.stubEnv("STUB_SLEEP_MS", "1200");
    const bridge = await startBridge({ MAX_CONCURRENT: 2 });
    const sink = await startSink();
    try {
      const results = await Promise.all([
        postDispatch(bridge.url, dispatchBody(sink.url)),
        postDispatch(bridge.url, dispatchBody(sink.url)),
        postDispatch(bridge.url, dispatchBody(sink.url)),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([202, 202, 429]);
      const rejected = results.find((r) => r.status === 429)!;
      expect(rejected.body).toMatchObject({ maxConcurrent: 2 });
      // Only the two accepted dispatches ever call back — no third process ran.
      await waitFor(() => sink.bodies.length === 2, 8_000);
      await new Promise((r) => setTimeout(r, 300));
      expect(sink.bodies).toHaveLength(2);
      expect(sink.bodies.every((b) => b.status === "completed")).toBe(true);
    } finally {
      bridge.server.close();
      sink.server.close();
      vi.unstubAllEnvs();
    }
  }, 15_000);

  it("byte-caps captured agent output (ring buffer) and notes the truncation in the result", async () => {
    vi.stubEnv("STUB_OUT_TEXT", `HEAD-MARKER-${"x".repeat(5000)}`);
    const bridge = await startBridge({ MAX_OUTPUT_BYTES: 512 });
    const sink = await startSink();
    try {
      const { status } = await postDispatch(bridge.url, dispatchBody(sink.url));
      expect(status).toBe(202);
      await waitFor(() => sink.bodies.length === 1, 8_000);
      const result = String(sink.bodies[0]!.result ?? "");
      // Bounded: cap + a short truncation note — never the full 5KB.
      expect(result.length).toBeLessThan(512 + 160);
      expect(result).toContain("truncated");
      // Ring keeps the LAST bytes: the head of the output is gone.
      expect(result).not.toContain("HEAD-MARKER");
      // Success path carries the truncation provenance too (PR #30 r8).
      expect(sink.bodies[0]!.stdoutTruncated).toBe(true);
      expect(sink.bodies[0]!.stdoutBytes).toBeGreaterThan(512);
    } finally {
      bridge.server.close();
      sink.server.close();
      vi.unstubAllEnvs();
    }
  }, 15_000);

  it("propagates stderr truncation provenance through the FAILURE callback payload (PR #30 r8)", async () => {
    // Stub writes >cap bytes to stderr, then exits 1. r7 dropped the
    // truncation flags on this path — Poseidon's live probe got
    // {status:"failed"} with no truncation provenance on a 5KB stderr.
    vi.stubEnv("STUB_ERR_TEXT", "e".repeat(5000));
    vi.stubEnv("STUB_EXIT", "1");
    const bridge = await startBridge({ MAX_OUTPUT_BYTES: 512 });
    const sink = await startSink();
    try {
      const { status } = await postDispatch(bridge.url, dispatchBody(sink.url));
      expect(status).toBe(202);
      await waitFor(() => sink.bodies.length === 1, 8_000);
      const payload = sink.bodies[0]!;
      expect(payload.status).toBe("failed");
      expect(payload.stderrTruncated).toBe(true);
      expect(payload.stderrBytes).toBeGreaterThan(512);
      // stdout was tiny — its flag stays false (provenance is per-stream).
      expect(payload.stdoutTruncated).toBe(false);
    } finally {
      bridge.server.close();
      sink.server.close();
      vi.unstubAllEnvs();
    }
  }, 15_000);

  it("times out a hanging callback fetch instead of hanging forever, and stays alive", async () => {
    const bridge = await startBridge({ CALLBACK_TIMEOUT_MS: 200 });
    const sink = await startSink({ hang: true });
    try {
      const { status } = await postDispatch(bridge.url, dispatchBody(sink.url));
      expect(status).toBe(202);
      // The shim must abort the hanging callback (~200ms), observed by the
      // sink as the request socket closing WITHOUT a response.
      await waitFor(() => sink.closes.length === 1, 5_000);
      // Terminal error handling: the shim itself is still healthy.
      const health = await fetch(`${bridge.url}/health`, { headers: AUTH });
      expect(health.status).toBe(200);
    } finally {
      bridge.server.close();
      sink.server.close();
      vi.unstubAllEnvs();
    }
  }, 15_000);
});

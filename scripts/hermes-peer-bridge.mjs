#!/usr/bin/env node
/**
 * hermes-peer-bridge — minimal additive dispatch surface for Hermes-profile
 * fleet peers (PR #30: Book Studio live agents Calliope + Hades).
 *
 * WHY THIS EXISTS: Paperclip's jarvis delegation contract needs an HTTP
 * endpoint per peer (dispatch → result post-back). The OpenClaw bridge
 * daemon (:18790) only serves identities august/ares, and its
 * /jarvis/dispatch handler is a wire-up NOOP that always answers as "ares"
 * — pointing Calliope/Hades at it would fabricate agent results (Tyler's
 * law violation). This shim serves the REAL peers by invoking their Hermes
 * gateway profiles:
 *
 *   POST /jarvis/dispatch  → 202 ack → `hermes --profile <name> chat -q <task>`
 *                          → POST result back to the delegation callback URL
 *   GET  /health           → { status: "ok", agents: [...] }
 *
 * CONFIG (env, operator-set — nothing secret in this file):
 *   HERMES_PEER_BRIDGE_PORT     listen port (default 18791)
 *   HERMES_PEER_BRIDGE_HOST     listen host (default 127.0.0.1)
 *   HERMES_PEER_BRIDGE_TOKEN    shared bearer; MUST equal JARVIS_PEER_CALLIOPE_TOKEN
 *                               / JARVIS_PEER_HADES_TOKEN on the Paperclip side.
 *                               If unset, auth is DISABLED (dev only — a warning
 *                               is printed on every request).
 *   HERMES_BIN                  path to the hermes CLI (default: "hermes" on PATH)
 *   HERMES_VENV                 optional VIRTUAL_ENV to prepend to PATH for the spawn
 *   HERMES_PEER_PROFILE_CALLIOPE  Hermes profile for the calliope peer (default "calliope")
 *   HERMES_PEER_PROFILE_HADES     Hermes profile for the hades peer (default "hades")
 *   PEER_TURN_TIMEOUT_MS        per-dispatch agent turn timeout (default 600000 = 10 min)
 *
 * RESOURCE BOUNDS (PR #30 r7 — a caller must not be able to exhaust
 * processes/memory or leave callbacks hanging):
 *   HERMES_PEER_MAX_CONCURRENT      max concurrent agent processes PER PEER
 *                                   (default 2); excess POSTs are rejected
 *                                   429 — never silently spawned.
 *   HERMES_PEER_MAX_OUTPUT_BYTES    byte cap on captured stdout/stderr per
 *                                   process (default 1000000); a ring buffer
 *                                   keeps the LAST bytes and the truncation
 *                                   is noted in the result text.
 *   HERMES_PEER_CALLBACK_TIMEOUT_MS explicit timeout on the callback fetch
 *                                   (default 15000); a hanging callback
 *                                   server is a terminal logged error, never
 *                                   an indefinitely hanging request.
 *
 * Paperclip side (server env):
 *   JARVIS_PEER_CALLIOPE_URL=http://127.0.0.1:18791   JARVIS_PEER_CALLIOPE_TOKEN=<same bearer>
 *   JARVIS_PEER_HADES_URL=http://127.0.0.1:18791      JARVIS_PEER_HADES_TOKEN=<same bearer>
 *   JARVIS_PEER_CALLIOPE_MODEL=sol      JARVIS_PEER_HADES_MODEL=kimi-k3   (provenance labels)
 *
 * See doc/BOOK-STUDIO-LIVE-AGENTS.md for the full operator runbook.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function intEnv(env, key, fallback) {
  const parsed = Number.parseInt(env[key] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Env-driven config; `createBridge` overrides make every limit testable. */
export function loadConfig(env = process.env) {
  return {
    PORT: intEnv(env, "HERMES_PEER_BRIDGE_PORT", 18791),
    HOST: env.HERMES_PEER_BRIDGE_HOST || "127.0.0.1",
    TOKEN: env.HERMES_PEER_BRIDGE_TOKEN || "",
    HERMES_BIN: env.HERMES_BIN || "hermes",
    HERMES_VENV: env.HERMES_VENV || "",
    TURN_TIMEOUT_MS: intEnv(env, "PEER_TURN_TIMEOUT_MS", 600_000),
    MAX_CONCURRENT: intEnv(env, "HERMES_PEER_MAX_CONCURRENT", 2),
    MAX_OUTPUT_BYTES: intEnv(env, "HERMES_PEER_MAX_OUTPUT_BYTES", 1_000_000),
    CALLBACK_TIMEOUT_MS: intEnv(env, "HERMES_PEER_CALLBACK_TIMEOUT_MS", 15_000),
  };
}

// Peer identity → Hermes profile. Additive: new peers are new env vars, not
// code changes, when they follow the NAME convention.
function loadPeers(env = process.env) {
  return {
    calliope: env.HERMES_PEER_PROFILE_CALLIOPE || "calliope",
    hades: env.HERMES_PEER_PROFILE_HADES || "hades",
  };
}

const IDENTITY_PREFIX = {
  calliope:
    "# Calliope — the creative Muse (Book Studio brainstorm/co-writer).\n" +
    "You ARE Calliope. Answer as her: warm, inventive, concrete. The brief " +
    "below contains the story-bible context and the conversation. Reply " +
    "directly to the author's latest message.\n\n",
  hades:
    "# Hades — the critic/reviewer (Book Studio baseline review).\n" +
    "You ARE Hades, the reviewer. Score and annotate ONLY — never rewrite. " +
    "Return ONLY the JSON object the brief demands.\n\n",
};

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

const MAX_BODY_BYTES = 2_000_000; // briefs are < 100KB

class PayloadTooLargeError extends Error {
  constructor(limit) {
    super(`request body exceeded ${limit} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/** Byte-accurate body reader — rejects with PayloadTooLargeError past the cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (c) => {
      if (settled) return;
      bytes += c.length; // Buffer.byteLength — actual received bytes, not UTF-16 units
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        // Pause (don't destroy) so the handler can flush a clean 413 first.
        req.pause();
        reject(new PayloadTooLargeError(MAX_BODY_BYTES));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

/**
 * Byte-capped ring buffer for process output: keeps the LAST `cap` bytes so
 * a runaway agent can never grow resident memory without bound. `truncated`
 * records whether anything was dropped.
 */
class ByteRing {
  constructor(cap) {
    this.cap = cap;
    this.chunks = [];
    this.size = 0;
    this.truncated = false;
  }

  push(buf) {
    if (buf.length >= this.cap) {
      this.chunks = [buf.subarray(buf.length - this.cap)];
      this.size = this.cap;
      this.truncated = true;
      return;
    }
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size > this.cap) {
      this.truncated = true;
      const excess = this.size - this.cap;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
    }
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/** Strip hermes banner/noise lines (╔═ / ══ / ⚠ / model-normalization) from stdout. */
function cleanOutput(raw) {
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (t.startsWith("╔") || t.startsWith("═") || t.startsWith("╚") || t.startsWith("║")) return false;
      if (t.startsWith("⚠")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Build the bridge HTTP server. Pure factory — callers (tests) choose the
 * port and every resource limit; the CLI wrapper at the bottom loads env,
 * applies the startup safety checks, and listens.
 */
export function createBridge(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const peers = loadPeers();
  /** In-flight agent processes per peer — the concurrency cap's ledger. */
  const activeByPeer = new Map();

  function authorized(req) {
    if (!config.TOKEN) return true; // dev mode — warned at startup
    return req.headers.authorization === `Bearer ${config.TOKEN}`;
  }

  function runAgent(peer, task) {
    const profile = peers[peer];
    const prompt = (IDENTITY_PREFIX[peer] || "") + task;
    const args = ["--profile", profile, "chat", "-q", prompt, "--quiet"];
    const env = { ...process.env };
    if (config.HERMES_VENV) {
      env.VIRTUAL_ENV = config.HERMES_VENV;
      env.PATH = `${path.join(config.HERMES_VENV, "bin")}:${env.PATH || "/usr/bin:/bin"}`;
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(config.HERMES_BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      const out = new ByteRing(config.MAX_OUTPUT_BYTES);
      const err = new ByteRing(config.MAX_OUTPUT_BYTES);
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`agent turn timed out after ${config.TURN_TIMEOUT_MS}ms`));
      }, config.TURN_TIMEOUT_MS);
      proc.stdout.on("data", (d) => out.push(d));
      proc.stderr.on("data", (d) => err.push(d));
      proc.on("error", (e) => { clearTimeout(timer); reject(e); });
      proc.on("close", (code) => {
        clearTimeout(timer);
        let text = cleanOutput(out.text());
        if (out.truncated) {
          text += `\n\n[output truncated — kept the last ${config.MAX_OUTPUT_BYTES} bytes of agent stdout]`;
        }
        if (code === 0 && text.trim()) return resolve(text.trim());
        reject(new Error(`hermes exited ${code}: ${(err.text() || out.text() || "no output").slice(0, 300)}`));
      });
    });
  }

  /** Callback POST with an explicit timeout — never an indefinitely hanging fetch. */
  async function postCallback(callback, body, tag) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.CALLBACK_TIMEOUT_MS);
    try {
      const r = await fetch(callback.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${callback.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      console.log(`${tag} callback rc=${r.status}`);
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (!authorized(req)) {
      return json(res, 401, { error: "unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        status: "ok",
        service: "hermes-peer-bridge",
        agents: Object.keys(peers),
        limits: {
          maxConcurrentPerPeer: config.MAX_CONCURRENT,
          maxOutputBytes: config.MAX_OUTPUT_BYTES,
          callbackTimeoutMs: config.CALLBACK_TIMEOUT_MS,
        },
      });
    }

    // Jarvis delegation dispatch receiver (any path — the server default is
    // /jarvis/dispatch; accept others so JARVIS_PEER_<NAME>_DISPATCH_PATH
    // misconfigurations fail visibly here rather than silently 404ing).
    if (req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        if (e instanceof PayloadTooLargeError) {
          if (!res.writableEnded && !res.destroyed) {
            res.on("finish", () => req.socket.destroy());
            return json(res, 413, { error: "payload too large (max 2000000 bytes)" });
          }
          return;
        }
        if (!res.writableEnded && !res.destroyed) {
          return json(res, 400, { error: "invalid json body" });
        }
        return;
      }
      if (!body || body.kind !== "jarvis-delegation") {
        return json(res, 400, { error: 'expected kind "jarvis-delegation"' });
      }
      const peer = String(body.agent || body.identityId || "").toLowerCase();
      if (!peers[peer]) {
        return json(res, 400, {
          error: `unknown agent "${peer}". Valid: ${Object.keys(peers).join(", ")}`,
        });
      }
      const delegationId = body.delegationId || "unknown";
      const callback = body.callback || {};
      const task = String(body.task || "");

      // Concurrency cap (r7): reject excess dispatches 429 — an unbounded
      // spawn per POST is a process/memory exhaustion vector. The caller's
      // delegation row stays queued and its own lane timeout abandons it;
      // no agent process is ever launched for a rejected dispatch.
      const active = activeByPeer.get(peer) ?? 0;
      if (active >= config.MAX_CONCURRENT) {
        return json(res, 429, {
          error: `peer "${peer}" busy — ${active}/${config.MAX_CONCURRENT} concurrent dispatches; retry later`,
          peer,
          maxConcurrent: config.MAX_CONCURRENT,
        });
      }
      activeByPeer.set(peer, active + 1);
      const release = () => {
        activeByPeer.set(peer, Math.max(0, (activeByPeer.get(peer) ?? 1) - 1));
      };

      // Synchronous ACK — the delegation row stays queued until the callback.
      json(res, 202, { accepted: true, delegationId, agent: peer });

      // Background: run the real agent, then post the result back. The
      // callback token NEVER enters the agent prompt.
      (async () => {
        try {
          console.log(`[${peer} ${delegationId}] dispatch received (${task.length} chars)`);
          const result = await runAgent(peer, task);
          if (callback.url && callback.token) {
            try {
              await postCallback(callback, { status: "completed", result }, `[${peer} ${delegationId}]`);
            } catch (cbErr) {
              // Terminal: log and stop. The server-side lane timeout abandons
              // the row; a retry here risks a duplicate callback, not a save.
              console.error(`[${peer} ${delegationId}] result callback failed (terminal):`, cbErr.message);
            }
          } else {
            console.error(`[${peer} ${delegationId}] missing callback config; result dropped`);
          }
        } catch (e) {
          console.error(`[${peer} ${delegationId}] failed:`, e.message);
          if (callback.url && callback.token) {
            await postCallback(callback, { status: "failed", error: e.message.slice(0, 300) }, `[${peer} ${delegationId}]`)
              .catch((cbErr) => console.error(`[${peer} ${delegationId}] failure callback failed:`, cbErr.message));
          }
        } finally {
          release();
        }
      })().catch((e) => {
        release();
        console.error(`[${peer} ${delegationId}] background crashed:`, e.message);
      });
      return;
    }

    json(res, 404, { error: "not found" });
  });

  return { server, config, peers };
}

// ── CLI entry point (skipped when imported as a module, e.g. by tests) ────
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = loadConfig();
  const { server, peers } = createBridge(config);

  // Refuse the unsafe combo: a non-loopback bind with auth disabled would
  // accept unauthenticated dispatches from the network. Fail at startup,
  // not after the first forged delegation.
  if (!config.TOKEN && !LOOPBACK_HOSTS.has(config.HOST)) {
    console.error(
      `FATAL: HERMES_PEER_BRIDGE_HOST=${config.HOST} is not loopback but HERMES_PEER_BRIDGE_TOKEN is empty — refusing to bind. Set a shared token or bind to 127.0.0.1.`,
    );
    process.exit(1);
  }

  server.listen(config.PORT, config.HOST, () => {
    console.log(`hermes-peer-bridge listening on http://${config.HOST}:${config.PORT}`);
    console.log(`  GET  /health           — health check`);
    console.log(`  POST /jarvis/dispatch  — jarvis delegation receiver`);
    console.log(`  Peers: ${Object.entries(peers).map(([p, prof]) => `${p}→hermes profile "${prof}"`).join(", ")}`);
    console.log(
      `  Limits: max ${config.MAX_CONCURRENT} concurrent/peer · ${config.MAX_OUTPUT_BYTES}B output cap · ${config.CALLBACK_TIMEOUT_MS}ms callback timeout`,
    );
    if (!config.TOKEN) {
      console.warn("  WARNING: HERMES_PEER_BRIDGE_TOKEN unset — auth DISABLED (dev only)");
    }
  });
}

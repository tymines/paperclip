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

const PORT = parseInt(process.env.HERMES_PEER_BRIDGE_PORT || "18791", 10);
const HOST = process.env.HERMES_PEER_BRIDGE_HOST || "127.0.0.1";
const TOKEN = process.env.HERMES_PEER_BRIDGE_TOKEN || "";
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const HERMES_VENV = process.env.HERMES_VENV || "";
const TURN_TIMEOUT_MS = parseInt(process.env.PEER_TURN_TIMEOUT_MS || "600000", 10);

// Peer identity → Hermes profile. Additive: new peers are new env vars, not
// code changes, when they follow the NAME convention.
const PEERS = {
  calliope: process.env.HERMES_PEER_PROFILE_CALLIOPE || "calliope",
  hades: process.env.HERMES_PEER_PROFILE_HADES || "hades",
};

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 2_000_000) req.destroy(); // 2MB cap — briefs are < 100KB
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!TOKEN) return true; // dev mode — warned at startup
  return req.headers.authorization === `Bearer ${TOKEN}`;
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

function runAgent(peer, task) {
  const profile = PEERS[peer];
  const prompt = (IDENTITY_PREFIX[peer] || "") + task;
  const args = ["--profile", profile, "chat", "-q", prompt, "--quiet"];
  const env = { ...process.env };
  if (HERMES_VENV) {
    env.VIRTUAL_ENV = HERMES_VENV;
    env.PATH = `${path.join(HERMES_VENV, "bin")}:${env.PATH || "/usr/bin:/bin"}`;
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`agent turn timed out after ${TURN_TIMEOUT_MS}ms`));
    }, TURN_TIMEOUT_MS);
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const text = cleanOutput(out);
      if (code === 0 && text) return resolve(text);
      reject(new Error(`hermes exited ${code}: ${(err || out || "no output").slice(0, 300)}`));
    });
  });
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
      agents: Object.keys(PEERS),
    });
  }

  // Jarvis delegation dispatch receiver (any path — the server default is
  // /jarvis/dispatch; accept others so JARVIS_PEER_<NAME>_DISPATCH_PATH
  // misconfigurations fail visibly here rather than silently 404ing).
  if (req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "invalid json body" });
    }
    if (!body || body.kind !== "jarvis-delegation") {
      return json(res, 400, { error: 'expected kind "jarvis-delegation"' });
    }
    const peer = String(body.agent || body.identityId || "").toLowerCase();
    if (!PEERS[peer]) {
      return json(res, 400, {
        error: `unknown agent "${peer}". Valid: ${Object.keys(PEERS).join(", ")}`,
      });
    }
    const delegationId = body.delegationId || "unknown";
    const callback = body.callback || {};
    const task = String(body.task || "");

    // Synchronous ACK — the delegation row stays queued until the callback.
    json(res, 202, { accepted: true, delegationId, agent: peer });

    // Background: run the real agent, then post the result back. The
    // callback token NEVER enters the agent prompt.
    (async () => {
      try {
        console.log(`[${peer} ${delegationId}] dispatch received (${task.length} chars)`);
        const result = await runAgent(peer, task);
        if (callback.url && callback.token) {
          const r = await fetch(callback.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${callback.token}`,
            },
            body: JSON.stringify({ status: "completed", result }),
          });
          console.log(`[${peer} ${delegationId}] callback rc=${r.status}`);
        } else {
          console.error(`[${peer} ${delegationId}] missing callback config; result dropped`);
        }
      } catch (e) {
        console.error(`[${peer} ${delegationId}] failed:`, e.message);
        if (callback.url && callback.token) {
          await fetch(callback.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${callback.token}`,
            },
            body: JSON.stringify({ status: "failed", error: e.message.slice(0, 300) }),
          }).catch((cbErr) => console.error(`[${peer} ${delegationId}] failure callback failed:`, cbErr.message));
        }
      }
    })().catch((e) => console.error(`[${peer} ${delegationId}] background crashed:`, e.message));
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`hermes-peer-bridge listening on http://${HOST}:${PORT}`);
  console.log(`  GET  /health           — health check`);
  console.log(`  POST /jarvis/dispatch  — jarvis delegation receiver`);
  console.log(`  Peers: ${Object.entries(PEERS).map(([p, prof]) => `${p}→hermes profile "${prof}"`).join(", ")}`);
  if (!TOKEN) {
    console.warn("  WARNING: HERMES_PEER_BRIDGE_TOKEN unset — auth DISABLED (dev only)");
  }
});

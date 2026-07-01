#!/usr/bin/env node
/**
 * Tailscale API Proxy for Windows Paperclip
 *
 * Listens on the Windows Tailscale interface IP:3100 and proxies to
 * 127.0.0.1:3100. This lets Macs, Box 2, and the bridge daemon reach
 * Windows Paperclip without requiring Paperclip itself to bind to 0.0.0.0
 * (which local_trusted deployment mode rejects).
 *
 * Binds specifically to the Tailscale IP, NOT 0.0.0.0, so it doesn't
 * conflict with Paperclip's 127.0.0.1:3100 binding.
 *
 * Usage:
 *   node ts-proxy.mjs
 *
 * Environment:
 *   TS_PROXY_PORT     — listen port (default: 3100)
 *   TS_PROXY_HOST     — listen host/Tailscale IP (default: 100.103.95.73)
 *   TS_PROXY_TARGET   — target URL (default: http://127.0.0.1:3100)
 */

import http from "node:http";
import https from "node:https";

const TARGET_URL = process.env.TS_PROXY_TARGET || "http://127.0.0.1:3100";
const LISTEN_PORT = parseInt(process.env.TS_PROXY_PORT || "3100", 10);
const LISTEN_HOST = process.env.TS_PROXY_HOST || "100.103.95.73";

const targetUrl = new URL(TARGET_URL);

/**
 * Forward an HTTP request to the target server.
 */
function proxyRequest(req, res) {
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };

  // Rewrite Host header to the target so Paperclip doesn't see 0.0.0.0
  options.headers.host = targetUrl.host;

  // Strip hop-by-hop headers
  const hopByHop = [
    "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers",
    "transfer-encoding", "upgrade",
  ];
  for (const h of hopByHop) delete options.headers[h];

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[ts-proxy] Request error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${err.message}`);
    }
  });

  req.pipe(proxyReq);
}

/**
 * Forward a WebSocket upgrade to the target server.
 */
function proxyWebSocket(req, socket, head) {
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: req.url,
    headers: { ...req.headers },
    method: "GET",
  };
  // Rewrite Host
  options.headers.host = targetUrl.host;

  const proxyReq = http.request(options);
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    // The upgrade was successful — handshake back to the client
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${proxyRes.headers["sec-websocket-accept"]}\r\n` +
      "\r\n"
    );
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on("error", (err) => {
    console.error(`[ts-proxy] WebSocket error: ${err.message}`);
    socket.destroy();
  });

  proxyReq.end();
}

const server = http.createServer(proxyRequest);

// Handle WebSocket upgrades
server.on("upgrade", proxyWebSocket);

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[ts-proxy] Listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${TARGET_URL}`
  );
  console.log(
    `[ts-proxy] Reachable at http://100.103.95.73:${LISTEN_PORT} (Tailscale)`
  );
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[ts-proxy] Shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

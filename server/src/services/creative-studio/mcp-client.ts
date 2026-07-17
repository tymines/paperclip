// Creative Studio P0 — minimal server-side MCP client (D1 ruling, Tyler 2026-07-12:
// the Paperclip server owns its MCP connections; no fleet-agent proxy lane).
//
// Speaks MCP Streamable HTTP (JSON-RPC 2.0 over POST): initialize -> tools/call.
// Deliberately minimal: no SSE resumption, no sampling, no roots — Creative Studio
// only needs request/response tool calls. Sessions are cached per endpoint and
// re-initialized on 404/session-expiry.

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class McpHttpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly authToken?: string,
    private readonly clientName = "paperclip-creative-studio",
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.authToken) h.authorization = `Bearer ${this.authToken}`;
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    return h;
  }

  private async rpc(method: string, params: unknown, timeoutMs = 120_000): Promise<any> {
    const id = this.nextId++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: ctrl.signal,
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      if (res.status === 404 && this.sessionId) {
        // session expired — force re-init on next call
        this.sessionId = null;
        this.initPromise = null;
        throw new Error(`MCP session expired (404) for ${method}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`MCP HTTP ${res.status} on ${method}: ${body.slice(0, 300)}`);
      }
      const ctype = res.headers.get("content-type") ?? "";
      let payload: JsonRpcResponse | undefined;
      if (ctype.includes("text/event-stream")) {
        // minimal SSE parse: take the last data: line carrying our response id
        const text = await res.text();
        for (const line of text.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg?.id === id) payload = msg;
          } catch { /* keep scanning */ }
        }
      } else {
        payload = (await res.json()) as JsonRpcResponse;
      }
      if (!payload) throw new Error(`MCP: no response payload for ${method}`);
      if (payload.error) throw new Error(`MCP ${method} error ${payload.error.code}: ${payload.error.message}`);
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async notify(method: string): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    }).catch(() => { /* notifications are best-effort */ });
  }

  async ensureInitialized(): Promise<void> {
    if (this.sessionId) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.rpc("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: this.clientName, version: "0.1.0" },
        }, 30_000);
        await this.notify("notifications/initialized");
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult> {
    await this.ensureInitialized();
    const result = (await this.rpc("tools/call", { name, arguments: args }, timeoutMs)) as McpToolResult;
    if (result?.isError) {
      const text = result.content?.map((c) => c.text).filter(Boolean).join("\n") ?? "unknown tool error";
      throw new Error(`MCP tool ${name} failed: ${text.slice(0, 500)}`);
    }
    return result;
  }

  /** Extract the first JSON payload from a tool result (structuredContent preferred, then text). */
  static toJson<T = any>(result: McpToolResult): T | null {
    if (result.structuredContent != null) return result.structuredContent as T;
    for (const c of result.content ?? []) {
      if (c.type === "text" && typeof c.text === "string") {
        try { return JSON.parse(c.text) as T; } catch { /* not JSON — skip */ }
      }
    }
    return null;
  }
}

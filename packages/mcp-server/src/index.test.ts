import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  createOlympusMcpServer,
  createPaperclipMcpServer,
  runOlympusServer,
  runServer,
} from "./index.js";

const config = {
  apiUrl: "http://localhost:3100/api",
  apiKey: "token-123",
  companyId: "11111111-1111-1111-1111-111111111111",
  agentId: "22222222-2222-2222-2222-222222222222",
  runId: "33333333-3333-3333-3333-333333333333",
};

async function inspectServer(
  factory: typeof createPaperclipMcpServer,
) {
  const result = factory(config);
  const client = new Client({ name: "mcp-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await result.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    return {
      identity: client.getServerVersion(),
      tools: (await client.listTools()).tools.map((tool) => tool.name),
    };
  } finally {
    await client.close();
    await result.server.close();
  }
}

describe("MCP server compatibility identities", () => {
  it("preserves Paperclip identity and adds the parallel Olympus identity", async () => {
    const paperclip = await inspectServer(createPaperclipMcpServer);
    const olympus = await inspectServer(createOlympusMcpServer);

    expect(paperclip.identity).toEqual({ name: "paperclip", version: "0.1.0" });
    expect(olympus.identity).toEqual({ name: "olympus", version: "0.1.0" });

    for (const tools of [paperclip.tools, olympus.tools]) {
      expect(tools).toHaveLength(80);
      expect(tools.filter((name) => name.startsWith("paperclip"))).toHaveLength(40);
      expect(tools.filter((name) => name.startsWith("olympus"))).toHaveLength(40);
      expect(tools).toContain("paperclipApiRequest");
      expect(tools).toContain("olympusApiRequest");
    }
  });

  it("keeps both legacy and Olympus stdio runners exported", () => {
    expect(runServer).toBeTypeOf("function");
    expect(runOlympusServer).toBeTypeOf("function");
  });
});

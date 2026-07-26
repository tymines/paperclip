// Lane provider registry (2026-07-25): writer/critic lanes accept any of
// gemini · deepseek · anthropic · openai (ChatGPT) · moonshot (Kimi), pinned
// by env. Chain order, degraded-critic honesty, OpenAI-compat call formation.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const keys = new Set<string>();
vi.mock("../services/provider-api-keys/index.js", () => ({
  getRawKey: async (p: string) => (keys.has(p) ? `key-${p}` : null),
}));

function mockFetchOk(text: string, finish = "stop") {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: text }, finish_reason: finish }] }),
    text: async () => "",
  })) as never;
}

async function importGen() {
  vi.resetModules();
  return import("../services/chapter-generator.js");
}

beforeEach(() => {
  keys.clear();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllGlobals());

describe("writer lane — BOOK_WRITER_PRIMARY pins the chain", () => {
  it("openai primary: ChatGPT answers first when configured", async () => {
    vi.stubEnv("BOOK_WRITER_PRIMARY", "openai");
    keys.add("openai"); keys.add("gemini");
    vi.stubGlobal("fetch", mockFetchOk("chatgpt prose"));
    const { callLLM } = await importGen();
    const out = await callLLM("sys", "user");
    expect(out).toBe("chatgpt prose");
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body);
    expect((vi.mocked(fetch).mock.calls[0][0] as string)).toContain("api.openai.com");
    expect(body.model).toBe("gpt-4o");
  });

  it("env overrides the model + endpoint (fleet gateways)", async () => {
    vi.stubEnv("BOOK_WRITER_PRIMARY", "openai");
    vi.stubEnv("BOOK_OPENAI_MODEL", "gpt-5-mini");
    vi.stubEnv("BOOK_OPENAI_BASE_URL", "https://gateway.internal/v1/chat/completions");
    keys.add("openai");
    vi.stubGlobal("fetch", mockFetchOk("ok"));
    const { callLLM } = await importGen();
    await callLLM("s", "u");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://gateway.internal/v1/chat/completions");
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body).model).toBe("gpt-5-mini");
  });

  it("unconfigured primary falls through to the next configured lane", async () => {
    vi.stubEnv("BOOK_WRITER_PRIMARY", "openai"); // not keyed
    keys.add("deepseek");
    vi.stubGlobal("fetch", mockFetchOk("deepseek prose"));
    const { callLLM } = await importGen();
    expect(await callLLM("s", "u")).toBe("deepseek prose");
    expect((vi.mocked(fetch).mock.calls[0][0] as string)).toContain("deepseek");
  });
});

describe("critic lane — BOOK_CRITIC_PRIMARY + honest degradation", () => {
  it("moonshot critic: Kimi answers the critic lane", async () => {
    vi.stubEnv("BOOK_CRITIC_PRIMARY", "moonshot");
    keys.add("moonshot");
    vi.stubGlobal("fetch", mockFetchOk("kimi critique"));
    const { callCriticLLM } = await importGen();
    const res = await callCriticLLM("s", "u");
    expect(res.provider).toBe("moonshot");
    expect(res.criticDegraded).toBe(false);
    expect((vi.mocked(fetch).mock.calls[0][0] as string)).toContain("moonshot.ai");
  });

  it("anthropic is a valid critic primary now (Claude as reviewer)", async () => {
    vi.stubEnv("BOOK_CRITIC_PRIMARY", "anthropic");
    keys.add("anthropic");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: "claude critique" }], stop_reason: "end_turn" }),
      text: async () => "",
    })) as never);
    const { callCriticLLM } = await importGen();
    const res = await callCriticLLM("s", "u");
    expect(res.provider).toBe("anthropic");
    expect(res.text).toBe("claude critique");
  });

  it("a non-pinned answerer is flagged criticDegraded, never silent", async () => {
    vi.stubEnv("BOOK_CRITIC_PRIMARY", "moonshot"); // not keyed
    keys.add("gemini");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "gemini critique" }] } }] }),
      text: async () => "",
    })) as never);
    const { callCriticLLM } = await importGen();
    const res = await callCriticLLM("s", "u");
    expect(res.provider).toBe("gemini");
    expect(res.criticDegraded).toBe(true);
  });
});

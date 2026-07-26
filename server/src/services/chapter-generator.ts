import { getRawKey, type ProviderKey } from "../services/provider-api-keys/index.js";

/**
 * Build a diagnosable failure message that names the feature and each provider's
 * outcome, so a "provider not configured" surfaces WHICH feature + WHICH provider
 * (and points at the Gemini pin) instead of a bare "Anthropic not configured".
 */
function providerFailureMessage(feature: string, diag: string[]): string {
  return (
    `${feature}: no LLM provider produced output. Book Studio is pinned to Gemini — ` +
    `set GOOGLE_API_KEY (or GEMINI_API_KEY) to enable it. ` +
    `Provider chain: [${diag.join("; ")}]. ` +
    `DeepSeek/Anthropic are used only if their keys are explicitly configured.`
  );
}

// Writer lane primary (2026-07-25, Tyler's update): the default stays Gemini,
// but the lane is a registry, not a pin — set BOOK_WRITER_PRIMARY to any
// LaneProvider (see below). The old OpenAI hard-ban is lifted.
export const BOOK_WRITER_PRIMARY = (process.env.BOOK_WRITER_PRIMARY || "gemini") as LaneProvider;

// Spec v1 (2026-07-24): the CRITIC lane is a DIFFERENT model than the writer.
// BOOK_CRITIC_PRIMARY is the placeholder knob; the fleet's provider config can
// repoint it without a code change. Fallback = the writer primary — a degraded
// critic is reported honestly via `criticDegraded`, never silently same-model.
//
// Lane providers (2026-07-25, Tyler's update): the lanes are no longer
// Gemini/DeepSeek-only. Both lanes accept any of:
//   gemini · deepseek · anthropic · openai (ChatGPT) · moonshot (Kimi)
// e.g. writer=ChatGPT, critic=Kimi: BOOK_WRITER_PRIMARY=openai
// BOOK_CRITIC_PRIMARY=moonshot (+ matching keys in the provider-key store —
// "openai" and "moonshot" are first-class slots there). Models/endpoints are
// env-overridable: BOOK_OPENAI_MODEL / BOOK_OPENAI_BASE_URL /
// BOOK_MOONSHOT_MODEL / BOOK_MOONSHOT_BASE_URL.
export type LaneProvider = "gemini" | "deepseek" | "anthropic" | "openai" | "moonshot";
export const BOOK_CRITIC_PRIMARY = (process.env.BOOK_CRITIC_PRIMARY || "deepseek") as LaneProvider;

export interface CriticResult {
  text: string;
  /** Which lane actually answered. */
  provider: LaneProvider;
  /** True when the pinned critic was unavailable and the fallback answered. */
  criticDegraded: boolean;
}

/**
 * Critic lane call (Spec v1 §5.B) — pinned to BOOK_CRITIC_PRIMARY (default
 * DeepSeek), falling back through the remaining lane providers (writer primary
 * first). A non-pinned answerer sets criticDegraded — surfaced honestly,
 * never silently same-model. Only configured providers are tried.
 */
export async function callCriticLLM(
  systemPrompt: string,
  userPrompt: string,
  feature = "Book Studio critic",
): Promise<CriticResult> {
  const order: LaneProvider[] = [
    BOOK_CRITIC_PRIMARY,
    BOOK_WRITER_PRIMARY,
    ...LANE_ORDER.filter((p) => p !== BOOK_CRITIC_PRIMARY && p !== BOOK_WRITER_PRIMARY),
  ];
  const diag: string[] = [];
  for (const name of order) {
    const key = await getRawKey(name).catch(() => null);
    if (!key) { diag.push(`${name}: not configured`); continue; }
    try {
      const text = await LANE_CALLS[name](systemPrompt, userPrompt);
      return { text, provider: name, criticDegraded: name !== BOOK_CRITIC_PRIMARY };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[chapter-generator] ${feature}: ${name} failed:`, err);
      diag.push(`${name}: error (${msg.slice(0, 140)})`);
    }
  }
  throw new Error(providerFailureMessage(feature, diag));
}

const MAX_RETRIES = 2;

// Output-token ceilings. gemini-2.5-* are THINKING models: reasoning tokens
// count against the output budget, so a 4096 cap left as little as ~150 words
// of actual prose (acceptance finding #6 — Ch.9 truncated at 122 words, Ch.6
// opened mid-sentence). Budgets are raised AND finish_reason is handled with
// continuation stitching below — never trust a cap alone.
const GEMINI_MAX_TOKENS = 16384;
const DEEPSEEK_MAX_TOKENS = 8192; // deepseek-chat hard output ceiling
const ANTHROPIC_MAX_TOKENS = 16384;
/** Max automatic continuation segments when a provider stops on token limit. */
const MAX_CONTINUATIONS = 3;

const CONTINUE_PROMPT =
  "Continue EXACTLY where the previous text stopped — mid-sentence if that is where it stopped. " +
  "Do not repeat any text, do not add headings or preamble, do not summarize. Just continue the prose to a natural, complete ending.";

interface GenerateDraftInput {
  bookTitle: string;
  chapterNumber: number;
  previousChapterSummary?: string;
  userPrompt?: string;
}

interface ReviseInput {
  bookTitle: string;
  chapterTitle: string;
  existingBeats: Record<string, unknown>[];
  revisionInstruction: string;
}

interface GeneratedChapter {
  title: string;
  beats: Record<string, unknown>[];
}

/**
 * Calls Gemini API via Google Generative Language endpoint.
 * Gemini is the primary (Tyler's preferred) model for chapter generation.
 */
async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = await getRawKey("gemini");
  if (!key) throw new Error("Gemini not configured");

  // Multi-turn contents so MAX_TOKENS truncation can be continued in place:
  // [user prompt] → [model partial] → [user CONTINUE] → [model partial] → …
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
  ];
  let full = "";
  for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        // Gemini native generateContent needs the key explicitly (x-goog-api-key).
        // Without it the endpoint 403s "unregistered caller" — this was the bug
        // that made callLLM fall through Gemini to the fallbacks.
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: GEMINI_MAX_TOKENS,
          },
        }),
      },
    );
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`Gemini API error (${resp.status}): ${errBody}`);
    }
    const data = await resp.json() as any;
    const cand = data.candidates?.[0];
    const text: string = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    full += text;
    if (cand?.finishReason !== "MAX_TOKENS" || !text) return full;
    // Truncated on the output cap — stitch a continuation (finding #6).
    console.warn(`[chapter-generator] Gemini hit MAX_TOKENS (segment ${seg + 1}) — continuing`);
    contents.push({ role: "model", parts: [{ text }] });
    contents.push({ role: "user", parts: [{ text: CONTINUE_PROMPT }] });
  }
  return full;
}

/**
 * Calls DeepSeek API (OpenAI-compatible endpoint, NOT OpenAI).
 * DeepSeek is the first fallback — same API shape as OpenAI but different provider.
 */
async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = await getRawKey("deepseek");
  if (!key) throw new Error("DeepSeek not configured");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      let full = "";
      for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
        const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages,
            temperature: 0.8,
            max_tokens: DEEPSEEK_MAX_TOKENS,
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(`DeepSeek API error (${resp.status}): ${errBody}`);
        }
        const data = await resp.json() as any;
        const choice = data.choices?.[0];
        const text: string = choice?.message?.content ?? "";
        full += text;
        if (choice?.finish_reason !== "length" || !text) return full;
        // Truncated on the output cap — stitch a continuation (finding #6).
        console.warn(`[chapter-generator] DeepSeek hit length cap (segment ${seg + 1}) — continuing`);
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "user", content: CONTINUE_PROMPT });
      }
      return full;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("DeepSeek failed after max retries");
}

/**
 * Calls Anthropic API as the final fallback.
 */
async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = await getRawKey("anthropic");
  if (!key) throw new Error("Anthropic not configured");

  const messages: Array<{ role: string; content: string }> = [
    { role: "user", content: userPrompt },
  ];
  let full = "";
  for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`Anthropic API error (${resp.status}): ${errBody}`);
    }
    const data = await resp.json() as any;
    const text: string = data.content?.[0]?.text ?? "";
    full += text;
    if (data.stop_reason !== "max_tokens" || !text) return full;
    // Truncated on the output cap — stitch a continuation (finding #6).
    console.warn(`[chapter-generator] Anthropic hit max_tokens (segment ${seg + 1}) — continuing`);
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: CONTINUE_PROMPT });
  }
  return full;
}

// ── OpenAI-compatible lanes: openai (ChatGPT) · moonshot (Kimi) ─────────────
// Same chat-completions shape as DeepSeek. Models and endpoints are
// env-overridable so the fleet can repoint at gateways or newer models without
// a code change.
const OPENAI_COMPAT: Record<"openai" | "moonshot", { baseUrl: string; model: string; maxTokens: number }> = {
  openai: {
    baseUrl: process.env.BOOK_OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions",
    model: process.env.BOOK_OPENAI_MODEL || "gpt-4o",
    maxTokens: 16384,
  },
  moonshot: {
    baseUrl: process.env.BOOK_MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1/chat/completions",
    model: process.env.BOOK_MOONSHOT_MODEL || "kimi-k2-0711-preview",
    maxTokens: 8192,
  },
};

async function callOpenAICompat(provider: "openai" | "moonshot", systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = OPENAI_COMPAT[provider];
  const key = await getRawKey(provider);
  if (!key) throw new Error(`${provider} not configured`);
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  let full = "";
  for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
    const resp = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.8, max_tokens: cfg.maxTokens }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`${provider} API error (${resp.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await resp.json() as any;
    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? "";
    full += text;
    if (choice?.finish_reason !== "length" || !text) return full;
    console.warn(`[chapter-generator] ${provider} hit max_tokens (segment ${seg + 1}) — continuing`);
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: CONTINUE_PROMPT });
  }
  return full;
}

const callOpenAI = (s: string, u: string) => callOpenAICompat("openai", s, u);
const callMoonshot = (s: string, u: string) => callOpenAICompat("moonshot", s, u);

/** Lane registry — both writer and critic chains resolve through this. */
const LANE_ORDER: LaneProvider[] = ["gemini", "deepseek", "anthropic", "openai", "moonshot"];
const LANE_CALLS: Record<LaneProvider, (s: string, u: string) => Promise<string>> = {
  gemini: callGemini,
  deepseek: callDeepSeek,
  anthropic: callAnthropic,
  openai: callOpenAI,
  moonshot: callMoonshot,
};

/**
 * Calls an LLM to generate chapter content.
 * Chain order: BOOK_WRITER_PRIMARY first, then the remaining lane providers.
 * Only providers whose key is configured (store or env) are attempted.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  feature = "Book Studio",
): Promise<string> {
  const order: LaneProvider[] = [
    BOOK_WRITER_PRIMARY,
    ...LANE_ORDER.filter((p) => p !== BOOK_WRITER_PRIMARY),
  ];
  const diag: string[] = [];
  for (const name of order) {
    const key = await getRawKey(name).catch(() => null);
    if (!key) { diag.push(`${name}: not configured`); continue; }
    try {
      return await LANE_CALLS[name](systemPrompt, userPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[chapter-generator] ${feature}: ${name} failed:`, err);
      diag.push(`${name}: error (${msg.slice(0, 140)})`);
    }
  }
  throw new Error(providerFailureMessage(feature, diag));
}

// ── Token streaming (SSE draft output) ──────────────────────────────────────

/**
 * Parse an OpenAI-style SSE body (`data: {json}` / `data: [DONE]`) yielding
 * text deltas. Used for Gemini's OpenAI-compatible endpoint and DeepSeek.
 * Convention copied from services/app-dev/design-chat.ts.
 * RETURNS the final finish_reason (e.g. "length" when the output cap was hit)
 * so callers can stitch continuations instead of silently truncating.
 */
async function* parseOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string, string | null, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return finishReason;
      try {
        const json = JSON.parse(data);
        const choice = json?.choices?.[0];
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta.length) yield delta;
      } catch { /* keep-alive / partial frame */ }
    }
  }
  return finishReason;
}

/** Anthropic /v1/messages streaming: content_block_delta → delta.text.
 *  RETURNS the stop_reason (message_delta) so callers can stitch continuations. */
async function* parseAnthropicSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string, string | null, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stopReason: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const json = JSON.parse(line.slice(5).trim());
        if (json?.type === "content_block_delta" && typeof json?.delta?.text === "string") {
          yield json.delta.text;
        }
        if (json?.type === "message_delta" && typeof json?.delta?.stop_reason === "string") {
          stopReason = json.delta.stop_reason;
        }
      } catch { /* keep-alive / partial frame */ }
    }
  }
  return stopReason;
}

/**
 * Shared OpenAI-compatible streaming with continuation stitching: when the
 * stream ends with finish_reason "length" (output cap), re-request with the
 * accumulated partial as an assistant turn + CONTINUE_PROMPT and keep
 * yielding — the client sees one uninterrupted prose stream (finding #6).
 */
async function* streamOpenAiCompatible(
  label: string,
  url: string,
  headers: Record<string, string>,
  model: string,
  maxTokens: number,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ model, stream: true, temperature: 0.8, max_tokens: maxTokens, messages }),
      signal,
    });
    if (!resp.ok || !resp.body) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`${label} stream error (${resp.status}): ${errBody.slice(0, 200)}`);
    }
    let segmentText = "";
    const gen = parseOpenAiSse(resp.body);
    let finishReason: string | null = null;
    for (;;) {
      const r = await gen.next();
      if (r.done) { finishReason = r.value; break; }
      segmentText += r.value;
      yield r.value;
    }
    if (finishReason !== "length" || !segmentText) return;
    console.warn(`[chapter-generator] ${label} stream hit length cap (segment ${seg + 1}) — continuing`);
    messages.push({ role: "assistant", content: segmentText });
    messages.push({ role: "user", content: CONTINUE_PROMPT });
  }
}

async function* streamGemini(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("gemini");
  if (!key) throw new Error("Gemini not configured");
  // Gemini's OpenAI-compatible Chat Completions endpoint (same pattern as the
  // App Dev design chat) — simplest reliable token stream.
  yield* streamOpenAiCompatible(
    "Gemini",
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    { Authorization: `Bearer ${key}` },
    "gemini-2.5-flash",
    GEMINI_MAX_TOKENS,
    systemPrompt,
    userPrompt,
    signal,
  );
}

async function* streamDeepSeek(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("deepseek");
  if (!key) throw new Error("DeepSeek not configured");
  yield* streamOpenAiCompatible(
    "DeepSeek",
    "https://api.deepseek.com/v1/chat/completions",
    { Authorization: `Bearer ${key}` },
    "deepseek-chat",
    DEEPSEEK_MAX_TOKENS,
    systemPrompt,
    userPrompt,
    signal,
  );
}

async function* streamAnthropic(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("anthropic");
  if (!key) throw new Error("Anthropic not configured");
  const messages: Array<{ role: string; content: string }> = [
    { role: "user", content: userPrompt },
  ];
  for (let seg = 0; seg <= MAX_CONTINUATIONS; seg++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: ANTHROPIC_MAX_TOKENS,
        stream: true,
        system: systemPrompt,
        messages,
      }),
      signal,
    });
    if (!resp.ok || !resp.body) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`Anthropic stream error (${resp.status}): ${errBody.slice(0, 200)}`);
    }
    let segmentText = "";
    const gen = parseAnthropicSse(resp.body);
    let stopReason: string | null = null;
    for (;;) {
      const r = await gen.next();
      if (r.done) { stopReason = r.value; break; }
      segmentText += r.value;
      yield r.value;
    }
    if (stopReason !== "max_tokens" || !segmentText) return;
    console.warn(`[chapter-generator] Anthropic stream hit max_tokens (segment ${seg + 1}) — continuing`);
    messages.push({ role: "assistant", content: segmentText });
    messages.push({ role: "user", content: CONTINUE_PROMPT });
  }
}

/**
 * Stream draft tokens with the same provider order as callLLM
 * (Gemini → DeepSeek → Anthropic; OpenAI hard-banned). Fallback only happens
 * BEFORE the first token: once a provider has emitted prose we never silently
 * switch models mid-chapter — a mid-stream failure surfaces as an error.
 */
export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  feature = "Book Studio",
): AsyncGenerator<string, void, unknown> {
  const providers: Array<{ name: ProviderKey; gen: () => AsyncGenerator<string, void, unknown> }> = [
    { name: "gemini", gen: () => streamGemini(systemPrompt, userPrompt, signal) },
    { name: "deepseek", gen: () => streamDeepSeek(systemPrompt, userPrompt, signal) },
    { name: "anthropic", gen: () => streamAnthropic(systemPrompt, userPrompt, signal) },
  ];
  const diag: string[] = [];
  for (const provider of providers) {
    if (signal?.aborted) throw new Error("Aborted");
    // Only attempt configured providers — never invoke an unconfigured lane
    // (that's what surfaced the misleading "Anthropic not configured").
    const key = await getRawKey(provider.name).catch(() => null);
    if (!key) { diag.push(`${provider.name}: not configured`); continue; }
    let yieldedAny = false;
    try {
      for await (const delta of provider.gen()) {
        yieldedAny = true;
        yield delta;
      }
      if (yieldedAny) return;
      diag.push(`${provider.name}: produced no tokens`);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (yieldedAny) throw err; // never switch providers mid-prose
      const msg = err instanceof Error ? err.message : String(err);
      diag.push(`${provider.name}: error (${msg.slice(0, 140)})`);
      console.warn(`[chapter-generator] ${feature}: ${provider.name} stream failed, trying next:`, err);
    }
  }
  throw new Error(providerFailureMessage(feature, diag));
}

/**
 * Generates a new chapter draft for a book.
 */
export async function generateChapterDraft(input: GenerateDraftInput): Promise<GeneratedChapter> {
  const { bookTitle, chapterNumber, previousChapterSummary, userPrompt } = input;

  const systemPrompt = [
    "You are a professional fiction writer generating chapter outlines for a novel.",
    "Your output must be valid JSON with this exact structure:",
    `{ "title": "Chapter Title", "beats": [{ "description": "A brief narrative beat description" }] }`,
    "Generate 5-8 beats per chapter. Each beat is a short narrative moment (1-2 sentences).",
    "Beats should follow a logical story progression (rising action, climax, resolution within the chapter).",
    "The title should be compelling and thematic. Return ONLY the JSON, no surrounding text.",
  ].join("\n");

  const promptParts: string[] = [`Generate Chapter ${chapterNumber} of "${bookTitle}".`];

  if (previousChapterSummary) {
    promptParts.push(`\nPrevious chapter summary: ${previousChapterSummary}`);
  }

  if (userPrompt) {
    promptParts.push(`\nAuthor's guidance: ${userPrompt}`);
  }

  promptParts.push("\nRespond with the JSON object only.");

  const raw = await callLLM(systemPrompt, promptParts.join(""));

  // Parse the JSON response
  try {
    // Try direct parse first
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || `Chapter ${chapterNumber}`,
      beats: Array.isArray(parsed.beats) ? parsed.beats : parsed.beats ? [parsed.beats] : [],
    };
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return {
        title: parsed.title || `Chapter ${chapterNumber}`,
        beats: Array.isArray(parsed.beats) ? parsed.beats : [],
      };
    }
    // Last resort: use the raw text as the only beat
    return {
      title: `Chapter ${chapterNumber}`,
      beats: [{ description: raw.trim() }],
    };
  }
}

/**
 * Revises an existing chapter based on user instructions.
 */
export async function reviseChapterContent(input: ReviseInput): Promise<GeneratedChapter> {
  const { bookTitle, chapterTitle, existingBeats, revisionInstruction } = input;

  const beatsText = existingBeats
    .map((b, i) => `Beat ${i + 1}: ${b.description ?? JSON.stringify(b)}`)
    .join("\n");

  const systemPrompt = [
    "You are a professional fiction editor revising a chapter outline.",
    "Your output must be valid JSON with this exact structure:",
    `{ "title": "Revised Chapter Title (keep original unless revision changes focus)", "beats": [{ "description": "A brief narrative beat description" }] }`,
    "Return ONLY the JSON object, no surrounding text.",
  ].join("\n");

  const userPrompt = [
    `Revise this chapter from "${bookTitle}".`,
    `\nCurrent title: "${chapterTitle}"`,
    `\nCurrent beats:\n${beatsText}`,
    `\nRevision instruction: ${revisionInstruction}`,
    "\nRespond with the JSON object only.",
  ].join("");

  const raw = await callLLM(systemPrompt, userPrompt);

  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || chapterTitle,
      beats: Array.isArray(parsed.beats) ? parsed.beats : [],
    };
  } catch {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return {
        title: parsed.title || chapterTitle,
        beats: Array.isArray(parsed.beats) ? parsed.beats : [],
      };
    }
    return {
      title: chapterTitle,
      beats: existingBeats,
    };
  }
}

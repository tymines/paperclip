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

// Tyler's ruling (2026-07-12): Gemini is THE Book Studio writer model — the
// pinned PRIMARY, not a coin-flip. DeepSeek/Anthropic are explicit FALLBACKS
// only, used when Gemini is unconfigured or errors. Override the primary via
// BOOK_WRITER_PRIMARY if ever needed; default stays gemini. callLLM() below
// honors this order (Gemini first, fallbacks after).
export const BOOK_WRITER_PRIMARY = (process.env.BOOK_WRITER_PRIMARY || "gemini") as
  | "gemini" | "deepseek" | "anthropic";

const MAX_RETRIES = 2;

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

  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      // Gemini native generateContent needs the key explicitly (x-goog-api-key).
      // Without it the endpoint 403s "unregistered caller" — this was the bug
      // that made callLLM fall through Gemini to the fallbacks.
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 4096,
        },
      }),
    },
  );
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Gemini API error (${resp.status}): ${errBody}`);
  }
  const data = await resp.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 4096,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`DeepSeek API error (${resp.status}): ${errBody}`);
      }
      const data = await resp.json() as any;
      return data.choices?.[0]?.message?.content ?? "";
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

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error (${resp.status}): ${errBody}`);
  }
  const data = await resp.json() as any;
  return data.content?.[0]?.text ?? "";
}

/**
 * Calls an LLM to generate chapter content.
 * Provider priority: Gemini (primary) → DeepSeek (fallback) → Anthropic (last resort).
 * OpenAI is NOT in this chain (hard-banned).
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  feature = "Book Studio",
): Promise<string> {
  // Gemini (pinned primary) → DeepSeek → Anthropic, but ONLY providers whose key
  // is configured (store or env) are attempted. Unconfigured providers are
  // skipped, never invoked — so the surfaced error can't be a downstream
  // "Anthropic not configured" masking the real (Gemini) cause.
  const chain: Array<{ name: ProviderKey; call: (s: string, u: string) => Promise<string> }> = [
    { name: "gemini", call: callGemini },
    { name: "deepseek", call: callDeepSeek },
    { name: "anthropic", call: callAnthropic },
  ];
  const diag: string[] = [];
  for (const p of chain) {
    const key = await getRawKey(p.name).catch(() => null);
    if (!key) { diag.push(`${p.name}: not configured`); continue; }
    try {
      return await p.call(systemPrompt, userPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[chapter-generator] ${feature}: ${p.name} failed:`, err);
      diag.push(`${p.name}: error (${msg.slice(0, 140)})`);
    }
  }
  throw new Error(providerFailureMessage(feature, diag));
}

// ── Token streaming (SSE draft output) ──────────────────────────────────────

/**
 * Parse an OpenAI-style SSE body (`data: {json}` / `data: [DONE]`) yielding
 * text deltas. Used for Gemini's OpenAI-compatible endpoint and DeepSeek.
 * Convention copied from services/app-dev/design-chat.ts.
 */
async function* parseOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) yield delta;
      } catch { /* keep-alive / partial frame */ }
    }
  }
}

/** Anthropic /v1/messages streaming: content_block_delta → delta.text. */
async function* parseAnthropicSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      } catch { /* keep-alive / partial frame */ }
    }
  }
}

async function* streamGemini(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("gemini");
  if (!key) throw new Error("Gemini not configured");
  // Gemini's OpenAI-compatible Chat Completions endpoint (same pattern as the
  // App Dev design chat) — simplest reliable token stream.
  const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gemini-2.5-flash",
      stream: true,
      temperature: 0.8,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Gemini stream error (${resp.status}): ${errBody.slice(0, 200)}`);
  }
  yield* parseOpenAiSse(resp.body);
}

async function* streamDeepSeek(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("deepseek");
  if (!key) throw new Error("DeepSeek not configured");
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      stream: true,
      temperature: 0.8,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`DeepSeek stream error (${resp.status}): ${errBody.slice(0, 200)}`);
  }
  yield* parseOpenAiSse(resp.body);
}

async function* streamAnthropic(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const key = await getRawKey("anthropic");
  if (!key) throw new Error("Anthropic not configured");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Anthropic stream error (${resp.status}): ${errBody.slice(0, 200)}`);
  }
  yield* parseAnthropicSse(resp.body);
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

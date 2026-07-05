import { getRawKey } from "../services/provider-api-keys/index.js";

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
      headers: { "Content-Type": "application/json" },
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
export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  // Level 1 — Gemini (primary, per Tyler's directive)
  const geminiKey = await getRawKey("gemini").catch(() => null);
  if (geminiKey) {
    try {
      return await callGemini(systemPrompt, userPrompt);
    } catch (err) {
      console.warn("[chapter-generator] Gemini failed, trying DeepSeek:", err);
    }
  }

  // Level 2 — DeepSeek (non-OpenAI fallback)
  const deepseekKey = await getRawKey("deepseek").catch(() => null);
  if (deepseekKey) {
    try {
      return await callDeepSeek(systemPrompt, userPrompt);
    } catch (err) {
      console.warn("[chapter-generator] DeepSeek failed, trying Anthropic:", err);
    }
  }

  // Level 3 — Anthropic (last resort)
  const anthropicKey = await getRawKey("anthropic").catch(() => null);
  if (anthropicKey) {
    try {
      return await callAnthropic(systemPrompt, userPrompt);
    } catch (err) {
      console.warn("[chapter-generator] Anthropic also failed:", err);
    }
  }

  throw new Error(
    "No LLM API key configured. Set 'gemini', 'deepseek', or 'anthropic' in provider API keys.",
  );
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

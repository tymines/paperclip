import { getRawKey } from "../services/provider-api-keys/index.js";

const DEFAULT_MODEL = "gpt-4o-mini";
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
 * Calls an LLM (via OpenAI-compatible API) to generate chapter content.
 * Uses `openai` key from provider-api-keys, with fallback to `anthropic`.
 */
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  // Try OpenAI first
  const openaiKey = await getRawKey("openai").catch(() => null);
  if (openaiKey) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
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
          throw new Error(`OpenAI API error (${resp.status}): ${errBody}`);
        }
        const data = await resp.json() as any;
        return data.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // Fallback to Anthropic
  const anthropicKey = await getRawKey("anthropic").catch(() => null);
  if (anthropicKey) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
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

  throw new Error("No LLM API key configured. Set 'openai' or 'anthropic' in provider API keys.");
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

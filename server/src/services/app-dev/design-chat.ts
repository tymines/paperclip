/**
 * Design-agent reasoning layer — Gemini 2.5 Flash.
 *
 * Mirrors how the rest of the fleet uses Gemini for vision/reasoning, but as a
 * direct streaming chat-completion call (chat granularity, not a full agent
 * run) so the App Dev composer gets token-by-token replies. The model is fixed
 * to gemini-2.5-flash. Concept-IMAGE generation is a separate, pluggable step
 * (see ./concept-image.ts) and is intentionally held until Tyler picks a model.
 */

export const DESIGN_AGENT_MODEL = "gemini-2.5-flash";

// Gemini's OpenAI-compatible Chat Completions endpoint.
const GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export class DesignModelUnconfiguredError extends Error {
  constructor() {
    super(
      "Design agent model (Gemini 2.5 Flash) not configured — set GEMINI_API_KEY or GOOGLE_API_KEY.",
    );
    this.name = "DesignModelUnconfiguredError";
  }
}

export function geminiApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
}

function systemPrompt(appName: string): string {
  return [
    `You are the Designer agent for the Paperclip "App Dev" workspace.`,
    `You are helping design and iterate on the app "${appName}".`,
    `Reason about UX, layout, information hierarchy, and visual design.`,
    `Propose concrete, calm, modern concepts and iterate based on feedback.`,
    `When the user asks you to generate a mockup IMAGE, say you will produce a`,
    `concept render — the image step is handled separately by the configured`,
    `image model. Keep replies focused and practical.`,
  ].join(" ");
}

export interface DesignChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Stream a design-reasoning reply from Gemini 2.5 Flash, yielding text deltas.
 * Throws DesignModelUnconfiguredError if no key is present.
 */
export async function* streamDesignReply(opts: {
  appName: string;
  prompt: string;
  history?: DesignChatTurn[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): AsyncGenerator<string, void, unknown> {
  const env = opts.env ?? process.env;
  const key = geminiApiKey(env);
  if (!key) throw new DesignModelUnconfiguredError();

  const messages = [
    { role: "system", content: systemPrompt(opts.appName) },
    ...(opts.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: opts.prompt },
  ];

  const resp = await fetch(GEMINI_OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DESIGN_AGENT_MODEL,
      stream: true,
      temperature: 0.6,
      messages,
    }),
    signal: opts.signal,
  });

  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Gemini request failed (${resp.status}): ${detail.slice(0, 200)}`);
  }

  // Parse the OpenAI-style SSE stream: lines of `data: {json}` / `data: [DONE]`.
  const reader = resp.body.getReader();
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
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
}

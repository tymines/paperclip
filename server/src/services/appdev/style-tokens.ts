/**
 * Style-token extraction (spec 4.2) — "matches the palette" checkable against
 * NAMED values, not vibes. A utility job: given reference-pack images, emit
 * palette (hex), type scale, corner radii, spacing scale, mood keywords.
 *
 * Runs on Claude vision (same direct-fetch pattern and key as visual-review;
 * no OpenAI per model rules). JSON-only output, one retry, then hard fail.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { uploadsRoot } from "../image-studio/uploads.js";
import { anthropicApiKey, VfgModelUnconfiguredError } from "./visual-review.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface StyleTokens {
  palette: string[];
  type_scale: string[];
  corner_radii: string[];
  spacing_scale: string[];
  mood_keywords: string[];
}

function isStyleTokens(v: unknown): v is StyleTokens {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o === "object" &&
    ["palette", "type_scale", "corner_radii", "spacing_scale", "mood_keywords"].every(
      (k) => Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string"),
    )
  );
}

/** Load an image stored under the uploads root as base64 (path-traversal safe). */
export async function loadUploadAsB64(rel: string): Promise<string> {
  const root = uploadsRoot();
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error("asset path escapes uploads root");
  }
  return (await fs.readFile(abs)).toString("base64");
}

const PROMPT = [
  "You are a design-token extractor. From the reference images (concept art,",
  "competitor screenshots, mock renders), extract the visual contract.",
  "Return STRICT JSON only, no markdown fences:",
  "{",
  '  "palette": ["#0D131D", ...],          // 4-10 dominant hex colors, most dominant first',
  '  "type_scale": ["32/semibold heading", ...], // observed sizes/weights, coarse',
  '  "corner_radii": ["16px cards", "8px buttons", ...],',
  '  "spacing_scale": ["8px base grid", ...],',
  '  "mood_keywords": ["dark", "playful", ...]  // 3-8 words',
  "}",
  "Hex values must be actual colors sampled from the images.",
].join("\n");

export async function extractStyleTokens(input: {
  imagesB64: string[];
  model?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ tokens: StyleTokens; model: string; raw: string }> {
  const env = input.env ?? process.env;
  const key = anthropicApiKey(env);
  if (!key) throw new VfgModelUnconfiguredError();
  if (input.imagesB64.length === 0) throw new Error("no images supplied for token extraction");
  const model = input.model?.trim() || env.VFG_REVIEW_MODEL || "claude-sonnet-5";

  const call = async (extra: string): Promise<string> => {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: PROMPT + extra }];
    for (const b64 of input.imagesB64.slice(0, 8)) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } });
    }
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0,
        system: "You extract design tokens. Respond only with valid JSON.",
        messages: [{ role: "user", content }],
      }),
    });
    if (!resp.ok) throw new Error(`token extraction request failed (${resp.status})`);
    const json = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    return (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  };

  const parse = (text: string): StyleTokens | null => {
    let t = text.trim();
    if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
    try {
      const v = JSON.parse(t);
      return isStyleTokens(v) ? v : null;
    } catch {
      return null;
    }
  };

  let raw = await call("");
  let tokens = parse(raw);
  if (!tokens) {
    raw = await call("\n\nREMINDER: previous output did not validate. JSON object only, all five keys, string arrays.");
    tokens = parse(raw);
  }
  if (!tokens) throw new Error("style-token extraction hard-failed after one retry (non-conforming output)");
  return { tokens, model, raw };
}

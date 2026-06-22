/**
 * Concept-image generation for the App Dev design agent.
 *
 * Model: Gemini 3.1 Flash Image, called with the SAME key the design-chat
 * reasoning layer uses (GEMINI_API_KEY / GOOGLE_API_KEY) — no new key needed.
 * The pluggable interface is kept so a different provider could be swapped in,
 * but Gemini 3.1 Flash Image is now the registered default.
 *
 * If no key is present at runtime the generator is unavailable and callers get
 * a clearly-flagged "needs key" result — never a faked image.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { uploadsRoot } from "../image-studio/uploads.js";

export interface ConceptImageRequest {
  prompt: string;
  appName: string;
  /** Optional reference (e.g. a prior concept id) for iteration. */
  referenceId?: string;
  aspect?: "portrait" | "landscape" | "square";
}

export interface ConceptImageResult {
  /** Relative path under the uploads store, served at /api/uploads/<path>. */
  imagePath: string;
  provider: ConceptImageProviderId;
  model: string;
}

export type ConceptImageProviderId = "gemini_flash_image";

export interface ConceptImageGenerator {
  readonly provider: ConceptImageProviderId;
  readonly model: string;
  generate(req: ConceptImageRequest): Promise<ConceptImageResult>;
}

export type ConceptImageStatus =
  | { configured: true; provider: ConceptImageProviderId; model: string }
  | { configured: false; reason: string };

// Gemini 3.1 Flash Image — image-capable Gemini model. Generated via the native
// generateContent endpoint with IMAGE response modality.
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const GENERATE_CONTENT_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

function geminiKey(env: NodeJS.ProcessEnv): string | null {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
}

type FetchImpl = typeof fetch;

/**
 * Gemini 3.1 Flash Image concept generator. The transport (`fetchImpl`) is
 * injectable so the generation path can be exercised in tests without a live
 * API call.
 */
export class GeminiFlashImageGenerator implements ConceptImageGenerator {
  readonly provider = "gemini_flash_image" as const;
  readonly model = GEMINI_IMAGE_MODEL;
  private key: string;
  private fetchImpl: FetchImpl;

  constructor(key: string, opts: { fetchImpl?: FetchImpl } = {}) {
    this.key = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(req: ConceptImageRequest): Promise<ConceptImageResult> {
    const prompt = [
      `Design a clean, modern mobile/app UI concept mockup for "${req.appName}".`,
      req.prompt,
      req.referenceId ? `Iterate on the previous concept (${req.referenceId}).` : "",
      `Calm, spacious, dark UI. High-fidelity screen mockup, no text labels of the model.`,
    ]
      .filter(Boolean)
      .join(" ");

    const resp = await this.fetchImpl(GENERATE_CONTENT_URL(this.model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Gemini image request failed (${resp.status}): ${detail.slice(0, 200)}`);
    }
    const json = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.map((p) => p.inlineData).find((d) => d?.data);
    if (!inline?.data) {
      throw new Error("Gemini image response contained no image data");
    }
    const ext = (inline.mimeType || "image/png").includes("jpeg") ? "jpg" : "png";
    const rel = `concepts/${randomUUID()}.${ext}`;
    const abs = path.resolve(uploadsRoot(), rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, Buffer.from(inline.data, "base64"));
    return { imagePath: `/api/uploads/${rel}`, provider: this.provider, model: this.model };
  }
}

/**
 * Resolve the active concept-image generator, or null if no Gemini key is set.
 */
export function resolveConceptImageGenerator(
  env: NodeJS.ProcessEnv = process.env,
  opts: { fetchImpl?: FetchImpl } = {},
): ConceptImageGenerator | null {
  const key = geminiKey(env);
  if (!key) return null;
  return new GeminiFlashImageGenerator(key, opts);
}

export function conceptImageStatus(env: NodeJS.ProcessEnv = process.env): ConceptImageStatus {
  const gen = resolveConceptImageGenerator(env);
  if (gen) return { configured: true, provider: gen.provider, model: gen.model };
  return {
    configured: false,
    reason:
      "Gemini 3.1 Flash Image is wired but needs GEMINI_API_KEY / GOOGLE_API_KEY set at runtime to generate concepts.",
  };
}

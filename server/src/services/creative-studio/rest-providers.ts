// Creative Studio R2 — plain-REST provider adapters (Tyler round-2 ask):
//   Gemini (Imagen images + Veo video; GEMINI_API_KEY / GOOGLE_API_KEY — already on
//     the box, fleet uses it; flagship because it works with zero new accounts),
//   OpenAI (gpt-image-1; OPENAI_API_KEY),
//   Replicate (Flux dev/schnell/1.1-pro + SD 3.5; REPLICATE_API_TOKEN or the
//     credentials vault via getReplicateToken — same source the Influencer studio uses).
// All implement the same CreativeProvider interface as the MCP adapters, so jobs,
// Library, and Recreate work identically. Binary outputs are persisted through the
// local asset store and served company-scoped. Model lists here are CONFIG (curated
// catalogs of what each REST API offers), not mocked data — generation is always real.
// BFL-direct note: Flux can also run against api.bfl.ml directly; keep Replicate as
// the default host and treat BFL_API_KEY as a future config option (status hint only).

import { getReplicateToken } from "../replicate/index.js";
import { saveAssetBuffer, saveAssetFromUrl } from "./asset-store.js";
import type {
  CreativeMode, CreativeProvider, GenerateRequest, NormalizedModel, ProviderId, ProviderJobState,
} from "./providers.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function notConfigured(msg: string): never {
  const err: any = new Error(msg);
  err.code = "provider_not_configured";
  err.status = 503;
  throw err;
}

/** company scope is applied by the route when it converts stored filenames to URLs */
export const LOCAL_ASSET_PREFIX = "local-asset:";

// ---------------------------------------------------------------------------
// Gemini — Imagen (image) + Veo (video) via the Gemini API
// ---------------------------------------------------------------------------

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements CreativeProvider {
  readonly id = "gemini" as ProviderId;

  get configured(): boolean {
    return !!(env("GEMINI_API_KEY") || env("GOOGLE_API_KEY"));
  }

  private key(): string {
    const k = env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
    if (!k) notConfigured("Gemini not configured (GEMINI_API_KEY / GOOGLE_API_KEY)");
    return k;
  }

  private headers(): Record<string, string> {
    return { "x-goog-api-key": this.key(), "content-type": "application/json" };
  }

  async listModels(): Promise<NormalizedModel[]> {
    return [
      { provider: this.id, id: "imagen-4.0-generate-001", displayName: "Imagen 4", description: "Google's flagship image model — photorealism, strong text rendering.", modes: ["image"] },
      { provider: this.id, id: "imagen-4.0-fast-generate-001", displayName: "Imagen 4 Fast", description: "Fast, budget Imagen tier for drafts and batches.", modes: ["image"] },
      { provider: this.id, id: "gemini-2.5-flash-image", displayName: "Nano Banana (Gemini Image)", description: "Gemini native image gen/editing — conversational, strong character consistency.", modes: ["image"] },
      { provider: this.id, id: "veo-3.0-generate-001", displayName: "Veo 3", description: "Google video with native audio — cinematic, top-tier prompt adherence.", modes: ["video"] },
      { provider: this.id, id: "veo-3.0-fast-generate-001", displayName: "Veo 3 Fast", description: "Lower-latency Veo tier for iteration.", modes: ["video"] },
    ];
  }

  async generate(req: GenerateRequest): Promise<ProviderJobState> {
    if (req.mode === "image") {
      if (req.model.startsWith("imagen")) return this.imagenGenerate(req);
      return this.geminiImageGenerate(req);
    }
    if (req.mode === "video") return this.veoStart(req);
    throw new Error(`Gemini adapter does not support mode ${req.mode}`);
  }

  private async imagenGenerate(req: GenerateRequest): Promise<ProviderJobState> {
    const body = {
      instances: [{ prompt: req.prompt }],
      parameters: {
        sampleCount: Math.min(Number(req.params.count ?? 1) || 1, 4),
        ...(req.params.aspect_ratio ? { aspectRatio: String(req.params.aspect_ratio) } : {}),
      },
    };
    const res = await fetch(`${GEMINI_BASE}/models/${req.model}:predict`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Imagen HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const outputs: ProviderJobState["outputs"] = [];
    for (const p of json?.predictions ?? []) {
      const b64 = p?.bytesBase64Encoded;
      if (typeof b64 === "string") {
        const { filename } = await saveAssetBuffer(Buffer.from(b64, "base64"), (p?.mimeType ?? "image/png").split("/").pop() ?? "png");
        outputs.push({ url: `${LOCAL_ASSET_PREFIX}${filename}`, kind: "image" });
      }
    }
    if (outputs.length === 0) throw new Error("Imagen returned no images (possibly safety-filtered)");
    return { providerJobId: null, status: "completed", outputs };
  }

  private async geminiImageGenerate(req: GenerateRequest): Promise<ProviderJobState> {
    const parts: any[] = [{ text: req.prompt }];
    // image refs supported via inline fetch (identity/edit reference)
    for (const ref of req.refs.slice(0, 3)) {
      try {
        const r = await fetch(ref.url);
        if (r.ok) {
          const mime = r.headers.get("content-type")?.split(";")[0] ?? "image/png";
          parts.push({ inlineData: { mimeType: mime, data: Buffer.from(await r.arrayBuffer()).toString("base64") } });
        }
      } catch { /* skip unfetchable refs */ }
    }
    const res = await fetch(`${GEMINI_BASE}/models/${req.model}:generateContent`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    });
    if (!res.ok) throw new Error(`Gemini image HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const outputs: ProviderJobState["outputs"] = [];
    for (const part of json?.candidates?.[0]?.content?.parts ?? []) {
      const d = part?.inlineData;
      if (d?.data) {
        const { filename } = await saveAssetBuffer(Buffer.from(d.data, "base64"), (d.mimeType ?? "image/png").split("/").pop() ?? "png");
        outputs.push({ url: `${LOCAL_ASSET_PREFIX}${filename}`, kind: "image" });
      }
    }
    if (outputs.length === 0) throw new Error("Gemini returned no image (possibly safety-filtered)");
    return { providerJobId: null, status: "completed", outputs };
  }

  private async veoStart(req: GenerateRequest): Promise<ProviderJobState> {
    const instance: Record<string, unknown> = { prompt: req.prompt };
    const start = req.refs.find((r) => r.role === "start_image");
    if (start) {
      try {
        const r = await fetch(start.url);
        if (r.ok) {
          instance.image = {
            bytesBase64Encoded: Buffer.from(await r.arrayBuffer()).toString("base64"),
            mimeType: r.headers.get("content-type")?.split(";")[0] ?? "image/png",
          };
        }
      } catch { /* proceed text-only */ }
    }
    const res = await fetch(`${GEMINI_BASE}/models/${req.model}:predictLongRunning`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({
        instances: [instance],
        parameters: { ...(req.params.aspect_ratio ? { aspectRatio: String(req.params.aspect_ratio) } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`Veo HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    if (!json?.name) throw new Error("Veo did not return an operation name");
    return { providerJobId: String(json.name), status: "running", outputs: [] };
  }

  async getJob(providerJobId: string, mode: CreativeMode): Promise<ProviderJobState> {
    if (mode !== "video") return { providerJobId, status: "completed", outputs: [] };
    const res = await fetch(`${GEMINI_BASE}/${providerJobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Veo poll HTTP ${res.status}`);
    const json: any = await res.json();
    if (json?.error) return { providerJobId, status: "failed", outputs: [], error: String(json.error?.message ?? "Veo operation failed").slice(0, 300) };
    if (!json?.done) return { providerJobId, status: "running", outputs: [] };
    const outputs: ProviderJobState["outputs"] = [];
    const samples = json?.response?.generateVideoResponse?.generatedSamples
      ?? json?.response?.generatedVideos ?? [];
    for (const s of samples) {
      const uri = s?.video?.uri ?? s?.uri;
      if (typeof uri === "string") {
        const { filename } = await saveAssetFromUrl(uri, "mp4", { "x-goog-api-key": this.key() });
        outputs.push({ url: `${LOCAL_ASSET_PREFIX}${filename}`, kind: "video" });
      }
    }
    if (outputs.length === 0) return { providerJobId, status: "failed", outputs: [], error: "Veo finished without video output (possibly safety-filtered)" };
    return { providerJobId, status: "completed", outputs };
  }

  async credits(): Promise<{ balance: number | null; detail?: unknown }> {
    return { balance: null, detail: "billed to the Google API account — no credit balance API" };
  }
}

// ---------------------------------------------------------------------------
// OpenAI — gpt-image-1
// ---------------------------------------------------------------------------

export class OpenAIImagesProvider implements CreativeProvider {
  readonly id = "openai" as ProviderId;

  get configured(): boolean { return !!env("OPENAI_API_KEY"); }

  async listModels(): Promise<NormalizedModel[]> {
    return [
      { provider: this.id, id: "gpt-image-1", displayName: "GPT Image", description: "OpenAI image generation — strong instruction following, text and layout.", modes: ["image"] },
    ];
  }

  async generate(req: GenerateRequest): Promise<ProviderJobState> {
    const key = env("OPENAI_API_KEY");
    if (!key) notConfigured("OpenAI not configured (OPENAI_API_KEY)");
    const aspect = String(req.params.aspect_ratio ?? "1:1");
    const size = aspect === "16:9" ? "1536x1024" : aspect === "9:16" ? "1024x1536" : "1024x1024";
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: req.model || "gpt-image-1", prompt: req.prompt, n: Math.min(Number(req.params.count ?? 1) || 1, 4), size }),
    });
    if (!res.ok) throw new Error(`OpenAI images HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const outputs: ProviderJobState["outputs"] = [];
    for (const d of json?.data ?? []) {
      if (d?.b64_json) {
        const { filename } = await saveAssetBuffer(Buffer.from(d.b64_json, "base64"), "png");
        outputs.push({ url: `${LOCAL_ASSET_PREFIX}${filename}`, kind: "image" });
      } else if (typeof d?.url === "string") {
        const { filename } = await saveAssetFromUrl(d.url, "png");
        outputs.push({ url: `${LOCAL_ASSET_PREFIX}${filename}`, kind: "image" });
      }
    }
    if (outputs.length === 0) throw new Error("OpenAI returned no images");
    return { providerJobId: null, status: "completed", outputs };
  }

  async getJob(providerJobId: string): Promise<ProviderJobState> {
    return { providerJobId, status: "completed", outputs: [] }; // synchronous API — nothing to poll
  }

  async credits(): Promise<{ balance: number | null; detail?: unknown }> {
    return { balance: null, detail: "billed to the OpenAI account — no credit balance API" };
  }
}

// ---------------------------------------------------------------------------
// Replicate — Flux family + SD 3.5 (official-model predictions endpoint)
// ---------------------------------------------------------------------------

const REPLICATE_MODELS: Array<{ slug: string; displayName: string; description: string }> = [
  { slug: "black-forest-labs/flux-schnell", displayName: "Flux Schnell", description: "Fastest Flux — drafts and batch iteration." },
  { slug: "black-forest-labs/flux-dev", displayName: "Flux Dev", description: "Flux development tier — quality/speed balance." },
  { slug: "black-forest-labs/flux-1.1-pro", displayName: "Flux 1.1 Pro", description: "Top Flux quality — hero shots and finals." },
  { slug: "stability-ai/stable-diffusion-3.5-large", displayName: "SD 3.5 Large", description: "Stability's flagship — strong style range." },
];

export class ReplicateProvider implements CreativeProvider {
  readonly id = "replicate" as ProviderId;

  // env is the sync signal; the credentials vault is also honored at call time
  get configured(): boolean { return !!env("REPLICATE_API_TOKEN"); }

  async checkConfigured(): Promise<boolean> {
    try { return (await getReplicateToken()) != null; } catch { return this.configured; }
  }

  private async token(): Promise<string> {
    const t = await getReplicateToken();
    if (!t) notConfigured("Replicate not configured (REPLICATE_API_TOKEN or credentials vault 'replicate')");
    return t;
  }

  async listModels(): Promise<NormalizedModel[]> {
    return REPLICATE_MODELS.map((m) => ({
      provider: this.id, id: m.slug, displayName: m.displayName, description: m.description, modes: ["image"] as CreativeMode[],
    }));
  }

  async generate(req: GenerateRequest): Promise<ProviderJobState> {
    const token = await this.token();
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      ...(req.params.aspect_ratio ? { aspect_ratio: String(req.params.aspect_ratio) } : {}),
    };
    const res = await fetch(`https://api.replicate.com/v1/models/${req.model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Token ${token}`, "content-type": "application/json", Prefer: "wait=30" },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) throw new Error(`Replicate HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    return this.normalizePrediction(json);
  }

  async getJob(providerJobId: string): Promise<ProviderJobState> {
    const token = await this.token();
    const res = await fetch(`https://api.replicate.com/v1/predictions/${providerJobId}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) throw new Error(`Replicate poll HTTP ${res.status}`);
    return this.normalizePrediction(await res.json());
  }

  private normalizePrediction(json: any): ProviderJobState {
    const s = String(json?.status ?? "");
    const status: ProviderJobState["status"] =
      s === "succeeded" ? "completed" : s === "failed" || s === "canceled" ? "failed" : s === "starting" ? "pending" : "running";
    const outputs: ProviderJobState["outputs"] = [];
    const out = json?.output;
    for (const u of Array.isArray(out) ? out : typeof out === "string" ? [out] : []) {
      if (typeof u === "string" && /^https?:\/\//.test(u)) outputs.push({ url: u, kind: "image" });
    }
    return {
      providerJobId: json?.id != null ? String(json.id) : null,
      status,
      outputs,
      error: json?.error ? String(json.error).slice(0, 300) : undefined,
      raw: { status: s, metrics: json?.metrics },
    };
  }

  async credits(): Promise<{ balance: number | null; detail?: unknown }> {
    return { balance: null, detail: "billed to the Replicate account — usage-based, no credit balance API" };
  }
}

// Creative Studio P0 — provider adapters over the Higgsfield + OpenArt MCPs (D1: server-side
// MCP client). Krea REST deferred to P3 (D2) — the interface below is what its adapter implements.
//
// Data honesty: a provider with no configured endpoint/token reports { configured: false } and
// every route returns an explicit keyed-off error instead of mock output. Config is env-based in
// P0 (move into company secret bindings in P1):
//   HIGGSFIELD_MCP_URL + HIGGSFIELD_MCP_TOKEN
//   OPENART_MCP_URL   + OPENART_MCP_TOKEN

import { McpHttpClient } from "./mcp-client.js";

export type CreativeMode = "image" | "video" | "audio" | "3d";
export type ProviderId = "higgsfield" | "openart";

export interface NormalizedModel {
  provider: ProviderId;
  id: string;
  displayName: string;
  description: string;
  modes: CreativeMode[];
  /** which reference roles this model accepts, when known */
  refRoles?: string[];
}

export interface GenerateRequest {
  mode: CreativeMode;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  refs: Array<{ role: string; url: string }>;
}

export interface ProviderJobState {
  providerJobId: string | null;
  status: "pending" | "running" | "completed" | "failed";
  outputs: Array<{ url: string; kind: string; thumbUrl?: string }>;
  costCredits?: number;
  error?: string;
  raw?: unknown;
}

export interface CreativeProvider {
  id: ProviderId;
  configured: boolean;
  listModels(): Promise<NormalizedModel[]>;
  generate(req: GenerateRequest): Promise<ProviderJobState>;
  getJob(providerJobId: string, mode: CreativeMode): Promise<ProviderJobState>;
  credits(): Promise<{ balance: number | null; detail?: unknown }>;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// shared result-shape helpers (both MCPs return job-ish JSON; shapes vary — we
// normalize defensively and keep `raw` for the UI's detail drawer)
// ---------------------------------------------------------------------------

function pickStatus(raw: any): ProviderJobState["status"] {
  const s = String(raw?.status ?? raw?.state ?? "").toLowerCase();
  if (["completed", "succeeded", "success", "done", "finished"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "nsfw"].includes(s)) return "failed";
  if (["queued", "pending", "created", "submitted"].includes(s)) return "pending";
  return "running";
}

function pickOutputs(raw: any): ProviderJobState["outputs"] {
  const out: ProviderJobState["outputs"] = [];
  const push = (url: unknown, kind: string, thumbUrl?: unknown) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      out.push({ url, kind, thumbUrl: typeof thumbUrl === "string" ? thumbUrl : undefined });
    }
  };
  const candidates = [raw?.outputs, raw?.results, raw?.assets, raw?.media, raw?.images, raw?.videos, raw?.creations]
    .find(Array.isArray) as any[] | undefined;
  for (const item of candidates ?? []) {
    if (typeof item === "string") push(item, "unknown");
    else push(item?.url ?? item?.download_url ?? item?.image_url ?? item?.video_url, item?.kind ?? item?.type ?? "unknown", item?.thumbnail_url ?? item?.thumb_url);
  }
  push(raw?.url ?? raw?.output_url, raw?.kind ?? "unknown");
  return out;
}

function pickJobId(raw: any): string | null {
  const id = raw?.job_id ?? raw?.id ?? raw?.jobId ?? raw?.creation_id ?? raw?.generation_id ?? null;
  return id != null ? String(id) : null;
}

// ---------------------------------------------------------------------------
// Higgsfield adapter
// ---------------------------------------------------------------------------

class HiggsfieldProvider implements CreativeProvider {
  readonly id: ProviderId = "higgsfield";
  readonly configured: boolean;
  private client: McpHttpClient | null;

  constructor() {
    const url = env("HIGGSFIELD_MCP_URL");
    this.configured = !!url;
    this.client = url ? new McpHttpClient(url, env("HIGGSFIELD_MCP_TOKEN")) : null;
  }

  private need(): McpHttpClient {
    if (!this.client) throw Object.assign(new Error("Higgsfield MCP not configured (HIGGSFIELD_MCP_URL)"), { code: "provider_not_configured" });
    return this.client;
  }

  async listModels(): Promise<NormalizedModel[]> {
    const res = await this.need().callTool("models_explore", { action: "list", limit: 100 });
    const json = McpHttpClient.toJson<any>(res);
    const models: any[] = json?.models ?? json?.items ?? [];
    return models.map((m) => ({
      provider: this.id,
      id: String(m.id ?? m.model_id ?? m.name),
      displayName: String(m.display_name ?? m.displayName ?? m.name ?? m.id),
      description: String(m.description ?? ""),
      modes: (Array.isArray(m.output_types) ? m.output_types : [m.type ?? m.output_type])
        .filter((t: unknown): t is CreativeMode => ["image", "video", "audio", "3d"].includes(String(t))),
    })).filter((m) => m.modes.length > 0);
  }

  async generate(req: GenerateRequest): Promise<ProviderJobState> {
    const tool = req.mode === "image" ? "generate_image"
      : req.mode === "video" ? "generate_video"
      : req.mode === "audio" ? "generate_audio"
      : "generate_3d";
    const args: Record<string, unknown> = { prompt: req.prompt, model: req.model, ...req.params };
    for (const ref of req.refs) {
      // pass refs through under their role names (start_image, end_image, image_references, audio…)
      const key = ref.role;
      if (key.endsWith("s") || key.includes("references")) {
        (args[key] = (args[key] as unknown[] | undefined) ?? []) && (args[key] as unknown[]).push(ref.url);
      } else {
        args[key] = ref.url;
      }
    }
    const res = await this.need().callTool(tool, args, 180_000);
    const json = McpHttpClient.toJson<any>(res) ?? {};
    return {
      providerJobId: pickJobId(json),
      status: pickStatus(json),
      outputs: pickOutputs(json),
      costCredits: typeof json?.cost === "number" ? json.cost : (typeof json?.credits_used === "number" ? json.credits_used : undefined),
      raw: json,
    };
  }

  async getJob(providerJobId: string, _mode: CreativeMode): Promise<ProviderJobState> {
    const res = await this.need().callTool("job_display", { job_id: providerJobId });
    const json = McpHttpClient.toJson<any>(res) ?? {};
    const job = json?.job ?? json;
    return {
      providerJobId,
      status: pickStatus(job),
      outputs: pickOutputs(job),
      costCredits: typeof job?.cost === "number" ? job.cost : undefined,
      error: job?.error ? String(job.error) : undefined,
      raw: job,
    };
  }

  async credits(): Promise<{ balance: number | null; detail?: unknown }> {
    const res = await this.need().callTool("balance", {});
    const json = McpHttpClient.toJson<any>(res) ?? {};
    const bal = json?.balance ?? json?.credits ?? json?.remaining ?? null;
    return { balance: typeof bal === "number" ? bal : (bal != null ? Number(bal) : null), detail: json };
  }
}

// ---------------------------------------------------------------------------
// OpenArt adapter
// ---------------------------------------------------------------------------

class OpenArtProvider implements CreativeProvider {
  readonly id: ProviderId = "openart";
  readonly configured: boolean;
  private client: McpHttpClient | null;

  constructor() {
    const url = env("OPENART_MCP_URL");
    this.configured = !!url;
    this.client = url ? new McpHttpClient(url, env("OPENART_MCP_TOKEN")) : null;
  }

  private need(): McpHttpClient {
    if (!this.client) throw Object.assign(new Error("OpenArt MCP not configured (OPENART_MCP_URL)"), { code: "provider_not_configured" });
    return this.client;
  }

  async listModels(): Promise<NormalizedModel[]> {
    const res = await this.need().callTool("openart_model_list", {});
    const json = McpHttpClient.toJson<any>(res);
    const models: any[] = json?.models ?? [];
    return models.map((m) => ({
      provider: this.id,
      id: String(m.id),
      displayName: String(m.displayName ?? m.id),
      description: String(m.description ?? ""),
      modes: Object.keys(m.modes ?? {}).filter((k): k is CreativeMode => ["image", "video", "audio", "3d"].includes(k)),
      refRoles: Object.values<any>(m.modes ?? {}).flat().map((mm: any) => String(mm?.mode ?? "")).filter(Boolean),
    })).filter((m) => m.modes.length > 0);
  }

  async generate(req: GenerateRequest): Promise<ProviderJobState> {
    const tool = req.mode === "video" ? "openart_generate_video" : "openart_generate_image";
    const args: Record<string, unknown> = { model: req.model, prompt: req.prompt, ...req.params };
    if (req.refs.length > 0) args.reference_images = req.refs.map((r) => r.url);
    const res = await this.need().callTool(tool, args, 180_000);
    const json = McpHttpClient.toJson<any>(res) ?? {};
    return { providerJobId: pickJobId(json), status: pickStatus(json), outputs: pickOutputs(json), raw: json };
  }

  async getJob(providerJobId: string, _mode: CreativeMode): Promise<ProviderJobState> {
    const res = await this.need().callTool("openart_creation_get", { creation_id: providerJobId });
    const json = McpHttpClient.toJson<any>(res) ?? {};
    const job = json?.creation ?? json;
    return {
      providerJobId,
      status: pickStatus(job),
      outputs: pickOutputs(job),
      error: job?.error ? String(job.error) : undefined,
      raw: job,
    };
  }

  async credits(): Promise<{ balance: number | null; detail?: unknown }> {
    const res = await this.need().callTool("openart_account_get", {});
    const json = McpHttpClient.toJson<any>(res) ?? {};
    const bal = json?.credits ?? json?.balance ?? json?.account?.credits ?? null;
    return { balance: typeof bal === "number" ? bal : (bal != null ? Number(bal) : null), detail: json };
  }
}

// ---------------------------------------------------------------------------
// registry — D3 defaults: HF default for video/audio/3d + edit tools; OA default
// for fast/cheap image. (default, Tyler can override)
// ---------------------------------------------------------------------------

let registry: Record<ProviderId, CreativeProvider> | null = null;

export function creativeProviders(): Record<ProviderId, CreativeProvider> {
  if (!registry) registry = { higgsfield: new HiggsfieldProvider(), openart: new OpenArtProvider() };
  return registry;
}

export function providerStatus() {
  const p = creativeProviders();
  return {
    higgsfield: { configured: p.higgsfield.configured, keyedOffHint: "Set HIGGSFIELD_MCP_URL (+_TOKEN) in the server environment." },
    openart: { configured: p.openart.configured, keyedOffHint: "Set OPENART_MCP_URL (+_TOKEN) in the server environment." },
    krea: { configured: false, keyedOffHint: "Deferred to P3 (decision D2 default)." },
    defaultProviderByMode: { image: "openart", video: "higgsfield", audio: "higgsfield", "3d": "higgsfield" },
    batchConfirmThresholdCredits: 50, // D6 default, Tyler can override
  };
}

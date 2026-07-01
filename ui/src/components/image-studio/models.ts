/**
 * Image/video-model catalog for the Generate panel's multi-PROVIDER picker.
 *
 * Models are grouped by hosted provider (Replicate · Atlas Cloud · WaveSpeed AI)
 * so Tyler can A/B the same persona prompt across providers and compare quality.
 * Each model carries its provider + the provider-native model id sent to the
 * backend. This mirrors the server-side catalogs in
 * services/image-providers/*.ts — the verified model ids live there too.
 *
 * The ⭐ Recommended default stays the Replicate persona LoRA ("General"):
 * selecting it renders through the persona's own trained model. Atlas/WaveSpeed
 * models render the prompt as text-to-image on that host (the persona LoRA is
 * not portable across providers).
 */
export type ProviderHost = "replicate" | "atlascloud" | "wavespeedai";
export type ModelTier = "Quick & Cheap" | "Standard" | "Premium";
export type SafetyFilter = "Minimal" | "On";

export interface ProviderMeta {
  host: ProviderHost;
  label: string;
  /** Brand chip color (hex). */
  color: string;
  blurb: string;
}

export const PROVIDER_META: Record<ProviderHost, ProviderMeta> = {
  replicate: {
    host: "replicate",
    label: "Replicate",
    color: "#ec4899",
    blurb: "Persona's own trained LoRA — proven default.",
  },
  atlascloud: {
    host: "atlascloud",
    label: "Atlas Cloud",
    color: "#3b82f6",
    blurb: "NSFW-friendly “Turbo Spicy” image + video.",
  },
  wavespeedai: {
    host: "wavespeedai",
    label: "WaveSpeed AI",
    color: "#10b981",
    blurb: "Fast + cheap, multi-LoRA (up to 4).",
  },
};

export const PROVIDER_ORDER: ProviderHost[] = ["replicate", "atlascloud", "wavespeedai"];

export interface ImageModel {
  /** Unique picker id (provider-scoped). */
  id: string;
  /** Provider-native model id sent to the backend; null = provider default. */
  nativeModel: string | null;
  provider: ProviderHost;
  name: string;
  tier: ModelTier;
  kind: "image" | "video";
  description: string;
  filters: SafetyFilter;
  audio: boolean;
  lora: boolean;
  maxResolution: string;
  /** USD per render (per ~5s clip for video) — drives the live cost preview. */
  costPerImage: number;
  /** Fully backed end-to-end today. */
  wired: boolean;
  /** The single catalog-wide ⭐ Recommended pick. */
  recommended?: boolean;
  /** The featured pick within its provider group. */
  providerFeatured?: boolean;
  recommendedNote?: string;
  altReason?: string;
}

export const IMAGE_MODELS: ImageModel[] = [
  // ── Replicate ───────────────────────────────────────────────────────────
  {
    id: "general",
    nativeModel: null,
    provider: "replicate",
    name: "General",
    tier: "Standard",
    kind: "image",
    description: "Persona LoRA · high quality 4K with full control",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "4K",
    costPerImage: 0.04,
    wired: true,
    recommended: true,
    providerFeatured: true,
    recommendedNote: "Tested best quality on Sidney — renders through the persona's trained LoRA.",
  },
  {
    id: "replicate-flux-dev-lora",
    nativeModel: "black-forest-labs/flux-dev-lora",
    provider: "replicate",
    name: "Flux Dev LoRA",
    tier: "Standard",
    kind: "image",
    description: "Base flux-dev-lora inference",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "2MP",
    costPerImage: 0.04,
    wired: true,
    altReason: "Base flux-dev without the persona model.",
  },
  // ── Atlas Cloud ─────────────────────────────────────────────────────────
  {
    id: "atlas-seedream",
    nativeModel: "bytedance/seedream-v5.0-lite",
    provider: "atlascloud",
    name: "Seedream 5 Lite",
    tier: "Quick & Cheap",
    kind: "image",
    description: "Cheap, fast text-to-image",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.02,
    wired: true,
    providerFeatured: true,
    altReason: "Atlas default — cheapest A/B render.",
  },
  {
    id: "atlas-qwen",
    nativeModel: "qwen/qwen-image-2.0/text-to-image",
    provider: "atlascloud",
    name: "Qwen Image 2.0",
    tier: "Standard",
    kind: "image",
    description: "Sharper text + fine detail",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.05,
    wired: true,
    altReason: "Sharper text + fine detail.",
  },
  {
    id: "atlas-wan-image",
    nativeModel: "alibaba/wan-2.7/text-to-image",
    provider: "atlascloud",
    name: "WAN 2.7 (image)",
    tier: "Premium",
    kind: "image",
    description: "Premium WAN aesthetic",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.05,
    wired: true,
    altReason: "WAN aesthetic, premium quality.",
  },
  {
    id: "atlas-wan-spicy-i2v",
    nativeModel: "atlascloud/wan-2.2-turbo-spicy/image-to-video-lora",
    provider: "atlascloud",
    name: "WAN 2.2 Turbo Spicy I2V",
    tier: "Premium",
    kind: "video",
    description: "Spicy image-to-video with LoRA",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "720p",
    costPerImage: 0.13,
    wired: true,
    altReason: "NSFW image-to-video — $0.026/s.",
  },
  // ── WaveSpeed AI ────────────────────────────────────────────────────────
  {
    id: "wave-flux",
    nativeModel: "wavespeed-ai/flux-dev",
    provider: "wavespeedai",
    name: "Flux Dev (Ultra Fast)",
    tier: "Quick & Cheap",
    kind: "image",
    description: "~1s renders, very cheap",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2MP",
    costPerImage: 0.012,
    wired: true,
    providerFeatured: true,
    altReason: "WaveSpeed default — fastest + cheapest.",
  },
  {
    id: "wave-flux-lora",
    nativeModel: "wavespeed-ai/flux-dev-lora",
    provider: "wavespeedai",
    name: "Flux Dev LoRA (multi)",
    tier: "Standard",
    kind: "image",
    description: "Stack up to 4 LoRAs at once",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "2MP",
    costPerImage: 0.02,
    wired: true,
    altReason: "Multi-LoRA — up to 4 simultaneously.",
  },
  {
    id: "wave-wan-i2v",
    nativeModel: "wavespeed-ai/wan-2.2/i2v-720p-ultra-fast",
    provider: "wavespeedai",
    name: "WAN 2.2 I2V (Ultra Fast)",
    tier: "Premium",
    kind: "video",
    description: "Cheap burst image-to-video",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "720p",
    costPerImage: 0.1,
    wired: true,
    altReason: "Cheap burst image-to-video.",
  },
];

export const MODEL_TIERS: ModelTier[] = ["Quick & Cheap", "Standard", "Premium"];

/** The single ⭐ Recommended model id (catalog-wide default). */
export const RECOMMENDED_MODEL_ID = IMAGE_MODELS.find((m) => m.recommended)?.id ?? "general";

/** Default selection = the Recommended pick. */
export const DEFAULT_MODEL_ID = RECOMMENDED_MODEL_ID;

/** Models for one provider, in catalog order. */
export function modelsByProvider(host: ProviderHost): ImageModel[] {
  return IMAGE_MODELS.filter((m) => m.provider === host);
}

/**
 * Recommended model for a template: the first entry of compatible_models (if any
 * is a known model), else the catalog Recommended pick.
 */
export function recommendedModelId(compatibleModels?: string[] | null): string {
  const first = (compatibleModels ?? []).find((id) => IMAGE_MODELS.some((m) => m.id === id));
  return first ?? RECOMMENDED_MODEL_ID;
}

/** Per-image fee breakdown for the cost-preview tooltip. */
export const LORA_FEE = 0;
export const UPSCALE_FEE = 0;

export function findModel(id: string): ImageModel {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

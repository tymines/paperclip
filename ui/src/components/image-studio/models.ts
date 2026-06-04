/**
 * Image-model catalog for the Generate panel's multi-model picker. Mirrors the
 * ZenCreator Text-To-Image model list (tiered grouping + per-model capability
 * badges + safety-filter labels).
 *
 * Tier 1 note: persona generation runs through the trained Flux LoRA path
 * ("General"). The other entries are surfaced for capability parity + cost
 * preview; selecting one still renders via the persona's LoRA. `wired` marks the
 * one that is fully backed today.
 */
export type ModelTier = "Quick & Cheap" | "Standard" | "Premium";
export type SafetyFilter = "Minimal" | "On";

export interface ImageModel {
  id: string;
  name: string;
  tier: ModelTier;
  description: string;
  filters: SafetyFilter;
  audio: boolean;
  lora: boolean;
  maxResolution: string;
  /** USD per generated image — drives the live cost preview. */
  costPerImage: number;
  wired: boolean;
}

export const IMAGE_MODELS: ImageModel[] = [
  // ── Quick & Cheap ─────────────────────────────────────────────────────────
  {
    id: "sdxl",
    name: "SDXL",
    tier: "Quick & Cheap",
    description: "Fast generation with LoRA support",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "1K",
    costPerImage: 0.02,
    wired: false,
  },
  {
    id: "flux-klein-nsfw",
    name: "Flux Klein NSFW",
    tier: "Quick & Cheap",
    description: "Flux Klein with uncensored LoRA",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "2MP",
    costPerImage: 0.03,
    wired: false,
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    tier: "Quick & Cheap",
    description: "Fast generation up to 2K",
    filters: "On",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.039,
    wired: false,
  },
  // ── Standard ──────────────────────────────────────────────────────────────
  {
    id: "general",
    name: "General",
    tier: "Standard",
    description: "Persona LoRA · high quality 4K with full control",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "4K",
    costPerImage: 0.04,
    wired: true,
  },
  {
    id: "qwen-2",
    name: "Qwen Image 2.0",
    tier: "Standard",
    description: "High quality generation up to 2K",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.05,
    wired: false,
  },
  {
    id: "seedream-5",
    name: "Seedream 5",
    tier: "Standard",
    description: "High quality 2K, latest generation",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.05,
    wired: false,
  },
  // ── Premium ───────────────────────────────────────────────────────────────
  {
    id: "qwen-2-pro",
    name: "Qwen Image 2.0 Pro",
    tier: "Premium",
    description: "Premium quality generation up to 2K",
    filters: "Minimal",
    audio: false,
    lora: false,
    maxResolution: "2K",
    costPerImage: 0.08,
    wired: false,
  },
  {
    id: "wan-2-7",
    name: "Premium WAN 2.7",
    tier: "Premium",
    description: "Premium WAN 2.7 with higher fidelity",
    filters: "Minimal",
    audio: false,
    lora: true,
    maxResolution: "1K",
    costPerImage: 0.07,
    wired: false,
  },
];

export const MODEL_TIERS: ModelTier[] = ["Quick & Cheap", "Standard", "Premium"];

export const DEFAULT_MODEL_ID = "general";

/** Per-image fee breakdown for the cost-preview tooltip. */
export const LORA_FEE = 0;
export const UPSCALE_FEE = 0;

export function findModel(id: string): ImageModel {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[3];
}

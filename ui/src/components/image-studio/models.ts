import type {
  ImageStudioCapability,
  ProviderHost,
} from "@/api/imageStudio";

export type { ProviderHost } from "@/api/imageStudio";

export interface ImageModel
  extends Omit<ImageStudioCapability, "priceEstimate"> {
  priceEstimate: ImageStudioCapability["priceEstimate"] | null;
  /** Compatibility alias for the older Create panel. */
  provider?: ProviderHost;
}

export const PROVIDER_ORDER: ProviderHost[] = [
  "replicate",
  "atlascloud",
  "wavespeedai",
];

export const RECOMMENDED_MODEL_ID = "general";
export const DEFAULT_MODEL_ID = RECOMMENDED_MODEL_ID;

type CompatibilityChoice = Pick<
  ImageModel,
  "id" | "providerHost" | "nativeModel" | "name"
>;

// Compatibility identifiers preserve saved templates and the older Create
// surface while capability availability, identity, and price all come from the
// server-owned endpoint. These placeholders must never be shown as available.
const COMPATIBILITY_CHOICES: CompatibilityChoice[] = [
  { id: "general", providerHost: "replicate", nativeModel: null, name: "Persona LoRA" },
  {
    id: "replicate-flux-dev-lora",
    providerHost: "replicate",
    nativeModel: "black-forest-labs/flux-dev-lora",
    name: "Flux Dev LoRA",
  },
  {
    id: "atlas-seedream",
    providerHost: "atlascloud",
    nativeModel: "bytedance/seedream-v5.0-lite",
    name: "Seedream 5 Lite",
  },
  {
    id: "atlas-qwen",
    providerHost: "atlascloud",
    nativeModel: "qwen/qwen-image-2.0/text-to-image",
    name: "Qwen Image 2.0",
  },
  {
    id: "atlas-wan-image",
    providerHost: "atlascloud",
    nativeModel: "alibaba/wan-2.7/text-to-image",
    name: "WAN 2.7 (image)",
  },
  {
    id: "atlas-wan-spicy-i2v",
    providerHost: "atlascloud",
    nativeModel: "atlascloud/wan-2.2-turbo-spicy/image-to-video-lora",
    name: "WAN 2.2 I2V",
  },
  {
    id: "wave-flux",
    providerHost: "wavespeedai",
    nativeModel: "wavespeed-ai/flux-dev",
    name: "Flux Dev",
  },
  {
    id: "wave-flux-lora",
    providerHost: "wavespeedai",
    nativeModel: "wavespeed-ai/flux-dev-lora",
    name: "Flux Dev LoRA",
  },
  {
    id: "wave-wan-i2v",
    providerHost: "wavespeedai",
    nativeModel: "wavespeed-ai/wan-2.2/i2v-720p-ultra-fast",
    name: "WAN 2.2 I2V",
  },
];

function compatibilityModel(choice: CompatibilityChoice): ImageModel {
  return {
    ...choice,
    provider: choice.providerHost,
    providerName: choice.providerHost,
    providerColor: "#64748b",
    mediaKind: choice.id.includes("i2v") ? "video" : "image",
    supportsLora: false,
    identityMethod: "no_identity_guarantee",
    requiredInputs: ["prompt"],
    configured: false,
    credentialVerified: false,
    catalogAvailable: false,
    readiness: "blocked",
    enabled: false,
    disabledReason: "Generation capabilities have not loaded.",
    recommended: choice.id === RECOMMENDED_MODEL_ID,
    providerFeatured: false,
    priceEstimate: null,
  };
}

/**
 * Deprecated compatibility-only model identifiers. Generation pickers must use
 * `GET /companies/:companyId/image-studio/capabilities` instead.
 */
export const IMAGE_MODELS: ImageModel[] = COMPATIBILITY_CHOICES.map(compatibilityModel);

export function modelsByProvider(
  models: ImageModel[],
  host: ProviderHost,
): ImageModel[] {
  return models.filter((model) => model.providerHost === host);
}

export function recommendedModelId(compatibleModels?: string[] | null): string {
  const first = (compatibleModels ?? []).find((id) =>
    IMAGE_MODELS.some((model) => model.id === id),
  );
  return first ?? RECOMMENDED_MODEL_ID;
}

export function findModel(
  id: string,
  models: ImageModel[] = IMAGE_MODELS,
): ImageModel {
  return (
    models.find((model) => model.id === id) ??
    models.find((model) => model.recommended) ??
    models[0] ??
    IMAGE_MODELS[0]
  );
}

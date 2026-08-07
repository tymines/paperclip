import type {
  ImageProvider,
  ModelInfo,
  ProviderHost,
} from "../image-providers/types.js";

export type CapabilityReadiness =
  | "catalog_only"
  | "credential_verified"
  | "blocked";

export type CapabilityIdentityMethod =
  | "trained_persona_identity"
  | "no_identity_guarantee";

export type CapabilityRequiredInput = "prompt" | "trained_persona" | "input_image";

export interface ImageStudioProviderCapabilityState {
  host: ProviderHost;
  name: string;
  color: string;
  configured: boolean;
  credentialVerified: boolean;
  catalogAvailable: boolean;
  disabledReason: string | null;
}

export interface ImageStudioCapability {
  id: string;
  providerHost: ProviderHost;
  providerName: string;
  providerColor: string;
  nativeModel: string | null;
  name: string;
  mediaKind: "image" | "video";
  supportsLora: boolean;
  identityMethod: CapabilityIdentityMethod;
  requiredInputs: CapabilityRequiredInput[];
  configured: boolean;
  credentialVerified: boolean;
  catalogAvailable: boolean;
  readiness: CapabilityReadiness;
  enabled: boolean;
  disabledReason: string | null;
  recommended: boolean;
  providerFeatured: boolean;
  priceEstimate: {
    amountUsd: number;
    unit: "image" | "second";
    source: "provider_adapter_catalog";
    observedAt: string;
  };
}

export interface ImageStudioCapabilityCatalog {
  generatedAt: string;
  providers: ImageStudioProviderCapabilityState[];
  capabilities: ImageStudioCapability[];
}

const COMPATIBILITY_IDS: Partial<Record<ProviderHost, Record<string, string>>> = {
  replicate: {
    "persona-lora": "general",
    "black-forest-labs/flux-dev-lora": "replicate-flux-dev-lora",
  },
  atlascloud: {
    "bytedance/seedream-v5.0-lite": "atlas-seedream",
    "qwen/qwen-image-2.0/text-to-image": "atlas-qwen",
    "alibaba/wan-2.7/text-to-image": "atlas-wan-image",
    "atlascloud/wan-2.2-turbo-spicy/image-to-video-lora": "atlas-wan-spicy-i2v",
  },
  wavespeedai: {
    "wavespeed-ai/flux-dev": "wave-flux",
    "wavespeed-ai/flux-dev-lora": "wave-flux-lora",
    "wavespeed-ai/wan-2.2/i2v-720p-ultra-fast": "wave-wan-i2v",
  },
};

function capabilityId(host: ProviderHost, modelId: string): string {
  return COMPATIBILITY_IDS[host]?.[modelId] ?? `${host}:${modelId}`;
}

function isImageToVideo(model: ModelInfo): boolean {
  const id = model.id.toLowerCase();
  return (
    model.kind === "video" &&
    (id.includes("image-to-video") || id.includes("/i2v") || id.includes("i2v-"))
  );
}

function identityMethod(
  host: ProviderHost,
  model: ModelInfo,
): CapabilityIdentityMethod {
  return host === "replicate" && model.id === "persona-lora"
    ? "trained_persona_identity"
    : "no_identity_guarantee";
}

function disabledReason(args: {
  model: ModelInfo;
  configured: boolean;
  credentialVerified: boolean;
}): string | null {
  if (args.model.kind === "video") {
    return "Video generation is not available in the current Studio route.";
  }
  if (!args.configured) {
    return "This provider is not configured.";
  }
  if (!args.credentialVerified) {
    return "This provider credential could not be verified.";
  }
  return null;
}

async function inspectProvider(
  provider: ImageProvider,
  observedAt: string,
): Promise<{
  provider: ImageStudioProviderCapabilityState;
  capabilities: ImageStudioCapability[];
}> {
  const configured = await provider.isConfigured().catch(() => false);
  const verification = configured
    ? await provider.verify().catch(() => ({ ok: false as const }))
    : null;
  const credentialVerified = verification?.ok ?? false;

  let models: ModelInfo[] = [];
  let catalogAvailable = false;
  try {
    models = await provider.listModels();
    catalogAvailable = models.length > 0;
  } catch {
    // Provider/catalog failures are represented as state only. Do not expose
    // credential-bearing URLs, handles, or raw provider errors to the client.
  }

  const providerDisabledReason = !catalogAvailable
    ? "The provider model catalog is unavailable."
    : !configured
      ? "This provider is not configured."
      : !credentialVerified
        ? "This provider credential could not be verified."
        : null;

  return {
    provider: {
      host: provider.id,
      name: provider.name,
      color: provider.color,
      configured,
      credentialVerified,
      catalogAvailable,
      disabledReason: providerDisabledReason,
    },
    capabilities: models.map((model) => {
      const method = identityMethod(provider.id, model);
      const reason = disabledReason({ model, configured, credentialVerified });
      const requiredInputs: CapabilityRequiredInput[] = ["prompt"];
      if (method === "trained_persona_identity") requiredInputs.push("trained_persona");
      if (isImageToVideo(model)) requiredInputs.push("input_image");

      return {
        id: capabilityId(provider.id, model.id),
        providerHost: provider.id,
        providerName: provider.name,
        providerColor: provider.color,
        nativeModel: model.id === "persona-lora" ? null : model.id,
        name: model.name,
        mediaKind: model.kind,
        supportsLora: model.lora,
        identityMethod: method,
        requiredInputs,
        configured,
        credentialVerified,
        catalogAvailable: true,
        readiness:
          model.kind === "video"
            ? "blocked"
            : credentialVerified
              ? "credential_verified"
              : "catalog_only",
        enabled: reason === null,
        disabledReason: reason,
        recommended: provider.id === "replicate" && model.id === "persona-lora",
        providerFeatured: model.recommended === true,
        priceEstimate: {
          amountUsd: model.costPerUnit,
          unit: model.costUnit,
          source: "provider_adapter_catalog",
          observedAt,
        },
      } satisfies ImageStudioCapability;
    }),
  };
}

export async function buildImageStudioCapabilityCatalog(
  providers: ImageProvider[],
  now: Date = new Date(),
): Promise<ImageStudioCapabilityCatalog> {
  const generatedAt = now.toISOString();
  const inspected = await Promise.all(
    providers.map((provider) => inspectProvider(provider, generatedAt)),
  );

  return {
    generatedAt,
    providers: inspected.map((entry) => entry.provider),
    capabilities: inspected.flatMap((entry) => entry.capabilities),
  };
}

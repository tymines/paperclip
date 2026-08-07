import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import type { ImageStudioProviderCapabilityState } from "../../src/api/imageStudio";
import { ModelPicker } from "../../src/components/image-studio/ModelPicker";
import type { ImageModel } from "../../src/components/image-studio/models";

const observedAt = "2026-08-06T20:30:00.000Z";
const providers: ImageStudioProviderCapabilityState[] = [
  {
    host: "replicate",
    name: "Replicate",
    color: "#ec4899",
    configured: true,
    credentialVerified: true,
    catalogAvailable: true,
    disabledReason: null,
  },
  {
    host: "atlascloud",
    name: "Atlas Cloud",
    color: "#3b82f6",
    configured: true,
    credentialVerified: true,
    catalogAvailable: true,
    disabledReason: null,
  },
];

const common = {
  configured: true,
  credentialVerified: true,
  catalogAvailable: true,
  providerFeatured: false,
} as const;

const models: ImageModel[] = [
  {
    ...common,
    id: "general",
    providerHost: "replicate",
    providerName: "Replicate",
    providerColor: "#ec4899",
    nativeModel: null,
    name: "Persona LoRA",
    mediaKind: "image",
    supportsLora: true,
    identityMethod: "trained_persona_identity",
    requiredInputs: ["prompt", "trained_persona"],
    readiness: "credential_verified",
    enabled: true,
    disabledReason: null,
    recommended: true,
    priceEstimate: {
      amountUsd: 0.04,
      unit: "image",
      source: "provider_adapter_catalog",
      observedAt,
    },
  },
  {
    ...common,
    id: "replicate-flux-dev-lora",
    providerHost: "replicate",
    providerName: "Replicate",
    providerColor: "#ec4899",
    nativeModel: "black-forest-labs/flux-dev-lora",
    name: "Alternate Replicate Flux Dev LoRA",
    mediaKind: "image",
    supportsLora: true,
    identityMethod: "no_identity_guarantee",
    requiredInputs: ["prompt"],
    readiness: "blocked",
    enabled: false,
    disabledReason:
      "This alternate Replicate selection is not honored by the current persona generation path.",
    recommended: false,
    priceEstimate: {
      amountUsd: 0.04,
      unit: "image",
      source: "provider_adapter_catalog",
      observedAt,
    },
  },
  {
    ...common,
    id: "atlas-video",
    providerHost: "atlascloud",
    providerName: "Atlas Cloud",
    providerColor: "#3b82f6",
    nativeModel: "atlas/video",
    name: "Atlas Image-to-Video",
    mediaKind: "video",
    supportsLora: false,
    identityMethod: "no_identity_guarantee",
    requiredInputs: ["prompt", "input_image"],
    readiness: "blocked",
    enabled: false,
    disabledReason: "Video generation is not available in the current Studio route.",
    recommended: false,
    providerFeatured: true,
    priceEstimate: {
      amountUsd: 0.02,
      unit: "second",
      source: "provider_adapter_catalog",
      observedAt,
    },
  },
];

function Fixture() {
  const [selected, setSelected] = useState("general");
  return (
    <main className="mx-auto min-w-0 max-w-5xl p-3" data-testid="fixture-shell">
      <ModelPicker
        value={selected}
        onChange={setSelected}
        models={models}
        providers={providers}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

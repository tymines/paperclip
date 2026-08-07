// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageStudioProviderCapabilityState } from "@/api/imageStudio";
import { ModelPicker } from "./ModelPicker";
import type { ImageModel } from "./models";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const models: ImageModel[] = [
  {
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
    configured: true,
    credentialVerified: true,
    catalogAvailable: true,
    readiness: "credential_verified",
    enabled: true,
    disabledReason: null,
    recommended: true,
    providerFeatured: true,
    priceEstimate: {
      amountUsd: 0.04,
      unit: "image",
      source: "provider_adapter_catalog",
      observedAt: "2026-08-06T20:30:00.000Z",
    },
  },
  {
    id: "atlas-video",
    providerHost: "atlascloud",
    providerName: "Atlas Cloud",
    providerColor: "#3b82f6",
    nativeModel: "atlas/video",
    name: "Atlas I2V",
    mediaKind: "video",
    supportsLora: false,
    identityMethod: "no_identity_guarantee",
    requiredInputs: ["prompt", "input_image"],
    configured: true,
    credentialVerified: true,
    catalogAvailable: true,
    readiness: "blocked",
    enabled: false,
    disabledReason: "Video generation is not available in the current Studio route.",
    recommended: false,
    providerFeatured: true,
    priceEstimate: {
      amountUsd: 0.02,
      unit: "second",
      source: "provider_adapter_catalog",
      observedAt: "2026-08-06T20:30:00.000Z",
    },
  },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelPicker capability truth", () => {
  for (const [width, height] of [[390, 844], [430, 932], [1440, 900]]) {
    it(`keeps truthful controls reachable at ${width}x${height}`, async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const onChange = vi.fn();

      await act(async () => {
        root.render(
          <ModelPicker
            value="general"
            onChange={onChange}
            models={models}
            providers={providers}
          />,
        );
      });

      const ready = container.querySelector<HTMLButtonElement>("[data-testid='model-general']");
      const video = container.querySelector<HTMLButtonElement>("[data-testid='model-atlas-video']");
      expect(ready?.disabled).toBe(false);
      expect(video?.disabled).toBe(true);
      expect(container.textContent).toContain("Trained identity");
      expect(container.textContent).toContain("Identity not guaranteed");
      expect(container.textContent).toContain("Est. $0.040/image");
      expect(container.textContent).toContain(
        "Video generation is not available in the current Studio route.",
      );
      expect(container.textContent).not.toMatch(/\bLIVE\b|NSFW-friendly|proven default|live cost/i);

      await act(async () => ready?.click());
      expect(onChange).toHaveBeenCalledWith("general");
      await act(async () => video?.click());
      expect(onChange).toHaveBeenCalledTimes(1);

      const tableToggle = container.querySelector<HTMLButtonElement>(
        "[data-testid='model-mode-table']",
      );
      await act(async () => tableToggle?.click());
      expect(container.querySelector(".overflow-x-auto")).not.toBeNull();

      await act(async () => root.unmount());
      container.remove();
    });
  }
});

import { describe, expect, it, vi } from "vitest";
import type {
  ImageProvider,
  ModelInfo,
  ProviderHost,
} from "../image-providers/types.js";
import { buildImageStudioCapabilityCatalog } from "./capabilities.js";

function fakeProvider(args: {
  host: ProviderHost;
  configured: boolean;
  verified?: boolean;
  models?: ModelInfo[];
  catalogError?: Error;
}): ImageProvider {
  return {
    id: args.host,
    name: `${args.host} display`,
    color: "#123456",
    tokenKey: args.host,
    isConfigured: vi.fn(async () => args.configured),
    verify: vi.fn(async () =>
      args.verified
        ? { ok: true, detail: "private account detail" }
        : { ok: false, error: "secret-bearing provider error" },
    ),
    listModels: vi.fn(async () => {
      if (args.catalogError) throw args.catalogError;
      return args.models ?? [];
    }),
    defaultModel: vi.fn(() => args.models?.[0]?.id ?? "none"),
    submitGeneration: vi.fn(async () => ({ predictionId: "unused" })),
    pollPrediction: vi.fn(async () => ({
      id: "unused",
      status: "starting",
      outputUrl: null,
    })),
    downloadOutput: vi.fn(async () => Buffer.from([])),
  };
}

const personaModel: ModelInfo = {
  id: "persona-lora",
  name: "Persona LoRA",
  kind: "image",
  costPerUnit: 0.04,
  costUnit: "image",
  lora: true,
  nsfw: true,
  recommended: true,
  note: "proven private note that must not be exposed",
};

const videoModel: ModelInfo = {
  id: "atlascloud/wan/image-to-video",
  name: "WAN I2V",
  kind: "video",
  costPerUnit: 0.02,
  costUnit: "second",
  lora: false,
  nsfw: true,
};

describe("buildImageStudioCapabilityCatalog", () => {
  it("normalizes verified image identity, price provenance, and blocked I2V truth", async () => {
    const now = new Date("2026-08-06T20:30:00.000Z");
    const catalog = await buildImageStudioCapabilityCatalog(
      [
        fakeProvider({
          host: "replicate",
          configured: true,
          verified: true,
          models: [personaModel],
        }),
        fakeProvider({
          host: "atlascloud",
          configured: true,
          verified: true,
          models: [videoModel],
        }),
      ],
      now,
    );

    expect(catalog.generatedAt).toBe(now.toISOString());
    expect(catalog.providers[0]).toMatchObject({
      configured: true,
      credentialVerified: true,
      catalogAvailable: true,
      disabledReason: null,
    });
    expect(catalog.capabilities[0]).toMatchObject({
      id: "general",
      nativeModel: null,
      identityMethod: "trained_persona_identity",
      requiredInputs: ["prompt", "trained_persona"],
      readiness: "credential_verified",
      enabled: true,
      priceEstimate: {
        amountUsd: 0.04,
        unit: "image",
        source: "provider_adapter_catalog",
        observedAt: now.toISOString(),
      },
    });
    expect(catalog.capabilities[1]).toMatchObject({
      mediaKind: "video",
      identityMethod: "no_identity_guarantee",
      requiredInputs: ["prompt", "input_image"],
      readiness: "blocked",
      enabled: false,
      disabledReason: "Video generation is not available in the current Studio route.",
    });
    expect(JSON.stringify(catalog)).not.toContain("private account detail");
    expect(JSON.stringify(catalog)).not.toContain("proven private note");
    expect(JSON.stringify(catalog)).not.toContain("secret-bearing provider error");
  });

  it("distinguishes unconfigured, unverified, and unavailable catalogs", async () => {
    const catalog = await buildImageStudioCapabilityCatalog([
      fakeProvider({
        host: "replicate",
        configured: false,
        models: [personaModel],
      }),
      fakeProvider({
        host: "wavespeedai",
        configured: true,
        verified: false,
        models: [{ ...personaModel, id: "wavespeed-ai/flux-dev" }],
      }),
      fakeProvider({
        host: "atlascloud",
        configured: true,
        verified: true,
        catalogError: new Error("private catalog failure"),
      }),
    ]);

    expect(catalog.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "replicate",
          configured: false,
          credentialVerified: false,
          catalogAvailable: true,
          disabledReason: "This provider is not configured.",
        }),
        expect.objectContaining({
          host: "wavespeedai",
          configured: true,
          credentialVerified: false,
          catalogAvailable: true,
          disabledReason: "This provider credential could not be verified.",
        }),
        expect.objectContaining({
          host: "atlascloud",
          configured: true,
          credentialVerified: true,
          catalogAvailable: false,
          disabledReason: "The provider model catalog is unavailable.",
        }),
      ]),
    );
    expect(catalog.capabilities.find((item) => item.providerHost === "replicate"))
      .toMatchObject({ enabled: false, readiness: "catalog_only" });
    expect(catalog.capabilities.find((item) => item.providerHost === "wavespeedai"))
      .toMatchObject({ enabled: false, readiness: "catalog_only" });
  });
});

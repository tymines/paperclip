/**
 * Female Undresser — structured generation lane.
 *
 * Hermes is still selecting the right consistent-character undress model. This
 * module is the wiring on our side so that landing his choice is a *config*
 * change, not a code change: set the persona's
 * `image_providers.default_params.undresser_model` (and optionally
 * `undresser_provider_host`) and this lane fires through the provider
 * abstraction (Replicate / Atlas / WaveSpeed). Until a model is configured it
 * returns a structured `backend_pending` result describing exactly what's
 * resolved and what's missing — no real generations are fired.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { imageProviders } from "@paperclipai/db";

type PersonaRow = typeof imageProviders.$inferSelect;
import {
  getProvider,
  DEFAULT_PROVIDER_HOST,
  isProviderHost,
  type ProviderHost,
} from "../image-providers/index.js";

/** Default "remove clothing" instruction; overridable per request later. */
const DEFAULT_UNDRESS_PROMPT =
  "remove clothing, nude, photorealistic, preserve the subject's face and identity";

export interface UndresserRequest {
  personaId: string;
  /** Source image as a data URI / public URL (img2img input). */
  sourceImage: string | null;
  /** Filename the UI reported (no bytes yet) — kept for diagnostics. */
  sourceFile: string | null;
  /** UI-selected model id, used only as a fallback if no persona config. */
  uiModel: string | null;
  prompt?: string | null;
  count: number;
  contentRating: "sfw" | "explicit";
}

interface ResolvedUndresserConfig {
  /** The configured undress model id (persona config wins over UI pick). */
  model: string | null;
  /** Which hosted provider the model lives on. */
  providerHost: ProviderHost;
  /** Source of the model decision (for diagnostics). */
  source: "persona_config" | "ui_selection" | "none";
}

export type UndresserResult =
  | {
      status: "backend_pending";
      message: string;
      resolved: ResolvedUndresserConfig;
    }
  | {
      status: "submitted";
      predictionId: string;
      model: string;
      providerHost: ProviderHost;
    };

/** Read the persona's undresser model + provider host from default_params. */
export function resolveUndresserConfig(
  persona: PersonaRow,
  uiModel: string | null,
): ResolvedUndresserConfig {
  const params = (persona.defaultParams as Record<string, unknown> | null) ?? {};
  const configuredModel =
    typeof params.undresser_model === "string" && params.undresser_model.trim().length > 0
      ? params.undresser_model.trim()
      : null;

  const configuredHost = params.undresser_provider_host;
  const providerHost: ProviderHost = isProviderHost(configuredHost)
    ? configuredHost
    : isProviderHost(persona.providerHost)
      ? persona.providerHost
      : DEFAULT_PROVIDER_HOST;

  if (configuredModel) {
    return { model: configuredModel, providerHost, source: "persona_config" };
  }
  // No persona config yet. We surface the UI pick for diagnostics but do NOT
  // treat it as a go signal — the model decision is Hermes' to make in config.
  return {
    model: uiModel && uiModel.trim().length > 0 ? uiModel.trim() : null,
    providerHost,
    source: uiModel ? "ui_selection" : "none",
  };
}

/**
 * Run (or defer) an undresser generation. Returns `backend_pending` until a
 * persona has `default_params.undresser_model` set; once set, fires through the
 * provider abstraction. Loads the persona by id (global or company-scoped).
 */
export async function runUndresserGeneration(
  db: Db,
  req: UndresserRequest,
): Promise<UndresserResult> {
  const [persona] = await db
    .select()
    .from(imageProviders)
    .where(eq(imageProviders.id, req.personaId))
    .limit(1);
  if (!persona) {
    return {
      status: "backend_pending",
      message: "Persona not found.",
      resolved: { model: null, providerHost: DEFAULT_PROVIDER_HOST, source: "none" },
    };
  }

  const resolved = resolveUndresserConfig(persona, req.uiModel);

  // Gate: until the persona has a configured undresser model, defer. Setting
  // image_providers.default_params.undresser_model is the 1-line change that
  // flips this lane live.
  if (resolved.source !== "persona_config" || !resolved.model) {
    return {
      status: "backend_pending",
      message:
        "Undresser model not configured yet — set default_params.undresser_model on the persona to enable generation.",
      resolved,
    };
  }

  const provider = getProvider(resolved.providerHost);
  if (!provider) {
    return {
      status: "backend_pending",
      message: `Unknown provider host '${resolved.providerHost}'.`,
      resolved,
    };
  }

  // From here on the lane is live: fire through the provider abstraction.
  const { predictionId } = await provider.submitGeneration({
    prompt: req.prompt?.trim() || DEFAULT_UNDRESS_PROMPT,
    model: resolved.model,
    image: req.sourceImage ?? undefined,
    disableSafety: req.contentRating === "explicit",
  });

  return {
    status: "submitted",
    predictionId,
    model: resolved.model,
    providerHost: resolved.providerHost,
  };
}

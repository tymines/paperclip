/**
 * Image-provider registry.
 *
 * One uniform ImageProvider per inference host. The generator worker and the
 * Image Studio routes resolve a provider by its `provider_host` and drive it
 * provider-agnostically (submit → poll → download).
 */
import type { ImageProvider, ProviderHost } from "./types.js";
import { PROVIDER_HOSTS, isProviderHost } from "./types.js";
import { replicateProvider } from "./replicate.js";
import { atlascloudProvider } from "./atlascloud.js";
import { wavespeedaiProvider } from "./wavespeedai.js";

export * from "./types.js";

const REGISTRY: Record<ProviderHost, ImageProvider> = {
  replicate: replicateProvider,
  atlascloud: atlascloudProvider,
  wavespeedai: wavespeedaiProvider,
};

/** All providers in display order (Replicate first — it's the default). */
export function listProviders(): ImageProvider[] {
  return PROVIDER_HOSTS.map((h) => REGISTRY[h]);
}

/** Resolve a provider by host, or null for an unknown/invalid host. */
export function getProvider(host: string | null | undefined): ImageProvider | null {
  return isProviderHost(host) ? REGISTRY[host] : null;
}

/** The default host when a job/request doesn't specify one. */
export const DEFAULT_PROVIDER_HOST: ProviderHost = "replicate";

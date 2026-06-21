/**
 * Video provider registry.
 *
 * Mirrors the pattern of image-providers/. Add a provider by implementing
 * the VideoProvider interface and registering it here. The orchestrator
 * dispatches per-scene video gen via this layer.
 *
 * Providers to wire (per spec):
 *   - atlascloud   bytedance/seedance-v1.5-pro/image-to-video[-spicy] (Tyler's prepaid credit, NSFW-capable)
 *   - wavespeedai  wavespeed-ai/wan-2.1-i2v-720p (SFW, prepaid)
 *   - runpod       self-hosted i2v (future, cost-saver at volume)
 */

export type VideoGenInput = {
  imageUrl: string;          // keyframe to animate (must be publicly fetchable)
  motionPrompt?: string;     // what changes during the clip
  durationSeconds: number;   // 3-5 typical, 4-12 supported by Seedance
  aspectRatio: "9:16" | "16:9" | "1:1";
  seed?: number;
  generateAudio?: boolean;   // most providers default false
};

export type VideoGenSubmitResult = {
  jobId: string;             // provider-side ID for polling
  estimatedCostUsd: number;
};

export type VideoGenStatus =
  | { status: "in_progress"; }
  | { status: "completed"; videoUrl: string; actualCostUsd?: number }
  | { status: "failed"; error: string };

export interface VideoProvider {
  readonly host: VideoProviderHost;
  readonly displayName: string;

  isConfigured(): Promise<boolean>;
  submit(input: VideoGenInput): Promise<VideoGenSubmitResult>;
  poll(jobId: string): Promise<VideoGenStatus>;
}

export type VideoProviderHost = "atlascloud" | "wavespeedai" | "runpod";

export const VIDEO_PROVIDER_HOSTS: VideoProviderHost[] = [
  "atlascloud",
  "wavespeedai",
  "runpod",
];

export const DEFAULT_VIDEO_PROVIDER_HOST: VideoProviderHost = "atlascloud";

// Registry — populated by provider modules importing themselves
const providers = new Map<VideoProviderHost, VideoProvider>();

export function registerVideoProvider(provider: VideoProvider): void {
  providers.set(provider.host, provider);
}

export function getVideoProvider(host: VideoProviderHost): VideoProvider | undefined {
  return providers.get(host);
}

export function listVideoProviders(): VideoProvider[] {
  return Array.from(providers.values());
}

export function isVideoProviderHost(s: string): s is VideoProviderHost {
  return VIDEO_PROVIDER_HOSTS.includes(s as VideoProviderHost);
}

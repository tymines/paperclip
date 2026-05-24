import {
  Facebook,
  Instagram,
  Linkedin,
  MessageSquare,
  Music,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import type { SocialPlatform } from "@paperclipai/shared";

export interface PlatformMeta {
  label: string;
  /** Used on chips + the platform color stripe in calendar / queue. */
  color: string;
  /** Lucide icon shown next to the label. */
  icon: LucideIcon;
  /** Max characters for the primary text body (caption / tweet / post). */
  captionLimit: number;
  /** Soft cap: warn but don't block (some platforms truncate gracefully). */
  captionLimitIsHard: boolean;
  /** Max attached media items. */
  mediaLimit: number;
  /** Whether the platform supports scheduled-publish via our adapter today. */
  schedulerSupported: boolean;
}

/** Authoritative per-platform metadata. Keep in sync with server adapters. */
export const PLATFORM_META: Record<SocialPlatform, PlatformMeta> = {
  instagram: {
    label: "Instagram",
    color: "#E1306C",
    icon: Instagram,
    captionLimit: 2200,
    captionLimitIsHard: false,
    mediaLimit: 10,
    schedulerSupported: true,
  },
  twitter: {
    label: "X",
    color: "#1DA1F2",
    icon: Twitter,
    captionLimit: 280,
    captionLimitIsHard: true,
    mediaLimit: 4,
    schedulerSupported: true,
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    icon: Facebook,
    captionLimit: 5000,
    captionLimitIsHard: false,
    mediaLimit: 10,
    schedulerSupported: true,
  },
  threads: {
    label: "Threads",
    color: "#101010",
    icon: MessageSquare,
    captionLimit: 500,
    captionLimitIsHard: true,
    mediaLimit: 10,
    schedulerSupported: true,
  },
  reddit: {
    label: "Reddit",
    color: "#FF4500",
    icon: MessageSquare,
    captionLimit: 40_000,
    captionLimitIsHard: true,
    mediaLimit: 1,
    schedulerSupported: true,
  },
  linkedin: {
    label: "LinkedIn",
    color: "#0A66C2",
    icon: Linkedin,
    captionLimit: 3000,
    captionLimitIsHard: true,
    mediaLimit: 9,
    schedulerSupported: false,
  },
  youtube: {
    label: "YouTube",
    color: "#FF0000",
    icon: Youtube,
    captionLimit: 5000,
    captionLimitIsHard: false,
    mediaLimit: 1,
    schedulerSupported: false,
  },
  tiktok: {
    label: "TikTok",
    color: "#000000",
    icon: Music,
    captionLimit: 2200,
    captionLimitIsHard: false,
    mediaLimit: 1,
    schedulerSupported: false,
  },
  pinterest: {
    label: "Pinterest",
    color: "#E60023",
    icon: MessageSquare,
    captionLimit: 500,
    captionLimitIsHard: false,
    mediaLimit: 1,
    schedulerSupported: false,
  },
  bluesky: {
    label: "Bluesky",
    color: "#0085FF",
    icon: MessageSquare,
    captionLimit: 300,
    captionLimitIsHard: true,
    mediaLimit: 4,
    schedulerSupported: false,
  },
  mastodon: {
    label: "Mastodon",
    color: "#6364FF",
    icon: MessageSquare,
    captionLimit: 500,
    captionLimitIsHard: true,
    mediaLimit: 4,
    schedulerSupported: false,
  },
};

export const TYLER_PRIORITY_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "twitter",
  "facebook",
  "threads",
  "reddit",
];

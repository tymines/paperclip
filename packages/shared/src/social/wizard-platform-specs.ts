/**
 * Source of truth for the Social Connect Wizard's per-platform copy.
 *
 * Distilled from Hermes's research in
 * `/Users/augi/.openclaw/agents/codex/workspace/social-platform-apis.md` —
 * specifically the "Tyler's Homework" section. Each entry tells the
 * 4-step wizard:
 *
 *   1. What you need  → cost / time / preconditions
 *   2. Register the app → developer-console deep link + required app config
 *   3. Paste credentials → labels + format hints for client_id / secret
 *   4. Connect account → OAuth authorize URL template + scopes
 *
 * Keep this file in `@paperclipai/shared` because both the server (OAuth
 * URL builder) and the UI (wizard copy) consume it.
 */
import type { SocialPlatform } from "../constants.js";

export type WizardGateKind =
  | "instagram_business_account"
  | "x_paid_tier"
  | "reddit_commercial_route";

export interface WizardGate {
  kind: WizardGateKind;
  /** Short label shown on the gate UI. */
  label: string;
  /** Long-form explanation. */
  detail: string;
  /** Optional helper link (e.g. "convert to Business account"). */
  href?: string;
  /** When true, the wizard refuses to advance past step 1 if not confirmed. */
  blocking: boolean;
}

export interface WizardCostNote {
  /** "$0.015–$0.20 per post" etc. */
  rangeLabel: string;
  /** Longer explanation rendered under the cost chip. */
  detail: string;
}

export interface WizardCallout {
  tone: "info" | "warn" | "success";
  title: string;
  body: string;
}

export interface WizardOAuthConfig {
  /**
   * URL template for the platform's OAuth consent screen. `{client_id}`,
   * `{redirect_uri}`, `{state}`, `{scopes}` placeholders are substituted
   * server-side before redirecting.
   */
  authorizeUrlTemplate: string;
  /** Space- or comma-separated scopes the wizard requests. */
  scopes: string[];
  /**
   * Used to join scopes in the URL. Most platforms want space-separated;
   * X uses `%20` (also space when URL-encoded); Reddit uses comma.
   */
  scopeJoin: " " | ",";
  /** Whether to add a `response_type=code` query param. */
  responseTypeCode: boolean;
  /** Whether to add PKCE params (X requires PKCE). */
  requiresPkce: boolean;
}

export interface WizardPlatformSpec {
  platform: SocialPlatform;
  /** Used in copy: "Connect Instagram", etc. */
  label: string;
  /** Used in copy: "Meta App (Business type)". */
  appKind: string;
  /** Approx wall-clock setup time. */
  setupTime: string;
  /** Developer-console URL the wizard deep-links to in step 2. */
  developerConsoleUrl: string;
  /** App-type / product config Tyler must select in the dev console. */
  appConfig: Array<{ label: string; value: string }>;
  /** Cost callout for step 1 (X PPU, Reddit commercial). */
  cost?: WizardCostNote;
  /** Optional precondition gate shown on step 1. */
  gates: WizardGate[];
  /** Steps-1 callouts (e.g. "Facebook is the only platform with native scheduling"). */
  callouts: WizardCallout[];
  /** Credential field labels for step 3. */
  credentialFields: {
    clientIdLabel: string;
    clientSecretLabel: string;
    clientIdPattern?: string;
    /** Help text shown under each input. */
    clientIdHint?: string;
    clientSecretHint?: string;
  };
  /** Whether the platform needs Meta App Review reminder banner post-connect. */
  needsMetaAppReview: boolean;
  /** OAuth runtime config. */
  oauth: WizardOAuthConfig;
  /** Permissions/scopes worth calling out specifically (App Review reminder). */
  scopesForAppReview?: string[];
}

const PAPERCLIP_CALLBACK_BASE = "https://paperclip.augiport.com/auth/social-callback";

export const WIZARD_PLATFORM_SPECS: Partial<Record<SocialPlatform, WizardPlatformSpec>> = {
  instagram: {
    platform: "instagram",
    label: "Instagram",
    appKind: "Meta App (Business type) + Instagram Platform product",
    setupTime: "~20 min (excluding Meta App Review queue)",
    developerConsoleUrl: "https://developers.facebook.com/apps",
    appConfig: [
      { label: "App type", value: "Business" },
      { label: "Product to add", value: "Instagram Platform → Instagram API with Instagram Login" },
      { label: "OAuth redirect URI", value: `${PAPERCLIP_CALLBACK_BASE}/instagram` },
      {
        label: "Required scopes",
        value: "instagram_business_basic, instagram_business_content_publish",
      },
      {
        label: "Optional scopes",
        value: "instagram_business_manage_messages, instagram_manage_insights",
      },
    ],
    gates: [
      {
        kind: "instagram_business_account",
        label: "Instagram Business / Creator account required",
        detail:
          "The Instagram Basic Display API was deprecated December 4, 2024. Personal accounts can no longer connect — only Business or Creator accounts. Convert in the Instagram app: Settings → Account → Switch to professional account.",
        href: "https://help.instagram.com/502981923235522",
        blocking: true,
      },
    ],
    callouts: [
      {
        tone: "info",
        title: "Self-managed scheduling",
        body: "Instagram's API has no scheduled_publish_time — Paperclip stores the post locally and fires the two-step publish API at the scheduled time.",
      },
    ],
    credentialFields: {
      clientIdLabel: "Instagram App ID",
      clientIdHint: "Found in Meta App Dashboard → App Settings → Basic. 15-16 digit number.",
      clientSecretLabel: "Instagram App Secret",
      clientSecretHint: "Click 'Show' next to App Secret in Meta App Dashboard. 32-char hex string.",
      clientIdPattern: "^[0-9]{14,18}$",
    },
    needsMetaAppReview: true,
    scopesForAppReview: [
      "instagram_business_content_publish",
      "instagram_business_manage_messages",
      "instagram_manage_insights",
    ],
    oauth: {
      authorizeUrlTemplate:
        "https://www.instagram.com/oauth/authorize?force_reauth=true&client_id={client_id}&redirect_uri={redirect_uri}&response_type=code&scope={scopes}&state={state}",
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
      scopeJoin: ",",
      responseTypeCode: true,
      requiresPkce: false,
    },
  },
  twitter: {
    platform: "twitter",
    label: "X",
    appKind: "X Developer App (OAuth 2.0 with PKCE)",
    setupTime: "~15 min after purchasing credits",
    developerConsoleUrl: "https://developer.x.com/en/portal/dashboard",
    appConfig: [
      { label: "App type", value: "OAuth 2.0 (Confidential client)" },
      { label: "Callback URI", value: `${PAPERCLIP_CALLBACK_BASE}/twitter` },
      { label: "Website URL", value: "https://paperclip.augiport.com" },
      {
        label: "Required scopes",
        value:
          "tweet.read, tweet.write, users.read, dm.read, dm.write, offline.access",
      },
    ],
    cost: {
      rangeLabel: "$0.015 per post (or $0.20 with a URL) — Pay-per-use only",
      detail:
        "X discontinued the free tier; new developers must purchase credits in the Developer Console. Reads are $0.001/owned-resource, writes $0.015 (or $0.20 if the tweet contains a URL). Recommend starting with a $50 credit and a $200 monthly hard-cap.",
    },
    gates: [
      {
        kind: "x_paid_tier",
        label: "Pay-per-use tier confirmed",
        detail:
          "Connecting X will incur per-API-call charges from your X Developer Console wallet. Paperclip never adds margin to these charges — they go straight from X to you. Confirm you've purchased ≥$50 in credits and accept ongoing per-post costs.",
        href: "https://docs.x.com/x-api/getting-started/pricing",
        blocking: true,
      },
    ],
    callouts: [
      {
        tone: "warn",
        title: "URL cost surprise",
        body: "Tweets containing a URL cost $0.20 instead of $0.015 — a 13× jump. Paperclip's composer will warn before publishing a tweet that includes a link.",
      },
    ],
    credentialFields: {
      clientIdLabel: "OAuth 2.0 Client ID",
      clientIdHint: "Developer Portal → your project → Keys & Tokens → OAuth 2.0 Client ID.",
      clientSecretLabel: "OAuth 2.0 Client Secret",
      clientSecretHint: "Shown once at creation — regenerate if you lost it.",
    },
    needsMetaAppReview: false,
    oauth: {
      authorizeUrlTemplate:
        "https://twitter.com/i/oauth2/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scopes}&state={state}&code_challenge=paperclip-pkce&code_challenge_method=plain",
      scopes: [
        "tweet.read",
        "tweet.write",
        "users.read",
        "dm.read",
        "dm.write",
        "offline.access",
      ],
      scopeJoin: " ",
      responseTypeCode: true,
      requiresPkce: true,
    },
  },
  facebook: {
    platform: "facebook",
    label: "Facebook",
    appKind: "Meta App (Business type) + Facebook Login for Business",
    setupTime: "~20 min (shares Meta App with Instagram)",
    developerConsoleUrl: "https://developers.facebook.com/apps",
    appConfig: [
      { label: "App type", value: "Business (same Meta App as Instagram)" },
      { label: "Product to add", value: "Facebook Login for Business" },
      { label: "OAuth redirect URI", value: `${PAPERCLIP_CALLBACK_BASE}/facebook` },
      {
        label: "Required scopes",
        value:
          "pages_manage_posts, pages_read_engagement, pages_show_list, pages_messaging",
      },
    ],
    gates: [],
    callouts: [
      {
        tone: "success",
        title: "Native scheduling supported",
        body: "Facebook is the only platform Paperclip wires into platform-native scheduling — posts are scheduled via FB's scheduled_publish_time (min 10 minutes ahead, max ~75 days). All other platforms are Paperclip self-managed.",
      },
    ],
    credentialFields: {
      clientIdLabel: "Facebook App ID",
      clientIdHint: "Same App ID as Instagram (shared Meta App).",
      clientSecretLabel: "Facebook App Secret",
      clientSecretHint: "Same App Secret as Instagram.",
      clientIdPattern: "^[0-9]{14,18}$",
    },
    needsMetaAppReview: true,
    scopesForAppReview: ["pages_manage_posts", "pages_messaging"],
    oauth: {
      authorizeUrlTemplate:
        "https://www.facebook.com/v21.0/dialog/oauth?client_id={client_id}&redirect_uri={redirect_uri}&state={state}&scope={scopes}&response_type=code",
      scopes: [
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_show_list",
        "pages_messaging",
      ],
      scopeJoin: ",",
      responseTypeCode: true,
      requiresPkce: false,
    },
  },
  threads: {
    platform: "threads",
    label: "Threads",
    appKind: "Meta App + separate Threads API product (graph.threads.net)",
    setupTime: "~15 min (separate from Facebook/IG product)",
    developerConsoleUrl: "https://developers.facebook.com/apps/?show_reminder=true",
    appConfig: [
      { label: "App type", value: "Business (can reuse Meta App, separate product)" },
      { label: "Product to add", value: "Threads API (graph.threads.net base URL)" },
      { label: "OAuth redirect URI", value: `${PAPERCLIP_CALLBACK_BASE}/threads` },
      {
        label: "Required scopes",
        value:
          "threads_basic, threads_content_publish, threads_manage_replies, threads_read_replies, threads_manage_insights",
      },
    ],
    gates: [],
    callouts: [
      {
        tone: "info",
        title: "No DM API yet",
        body: "Threads added web DMs in May 2026, but the API for messaging is still not public. Threads inbox in Paperclip will activate when Meta exposes the endpoint — until then, Threads is publish-only.",
      },
    ],
    credentialFields: {
      clientIdLabel: "Threads App ID",
      clientIdHint: "From the Threads product card in your Meta App dashboard.",
      clientSecretLabel: "Threads App Secret",
      clientSecretHint: "Threads has its own App Secret separate from Facebook/IG.",
    },
    needsMetaAppReview: true,
    scopesForAppReview: [
      "threads_content_publish",
      "threads_manage_replies",
      "threads_manage_insights",
    ],
    oauth: {
      authorizeUrlTemplate:
        "https://threads.net/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&scope={scopes}&response_type=code&state={state}",
      scopes: [
        "threads_basic",
        "threads_content_publish",
        "threads_manage_replies",
        "threads_read_replies",
        "threads_manage_insights",
      ],
      scopeJoin: ",",
      responseTypeCode: true,
      requiresPkce: false,
    },
  },
  reddit: {
    platform: "reddit",
    label: "Reddit",
    appKind: "Reddit OAuth app (web app type)",
    setupTime: "~5 min for personal use; weeks–months for commercial contract",
    developerConsoleUrl: "https://www.reddit.com/prefs/apps",
    appConfig: [
      { label: "App type", value: "web app" },
      { label: "Name", value: "Paperclip" },
      { label: "Callback URI", value: `${PAPERCLIP_CALLBACK_BASE}/reddit` },
      {
        label: "Required scopes",
        value: "identity, submit, read, history, privatemessages",
      },
    ],
    cost: {
      rangeLabel: "Free for personal • Commercial requires Reddit-direct contract",
      detail:
        "Reddit's Data API is free up to 100 QPM for non-commercial use. Commercial use (paid SaaS like Paperclip) requires a contract with dev-platform@reddit.com — lead time can be weeks-to-months and Reddit doesn't publish a public rate card. Start the conversation early.",
    },
    gates: [
      {
        kind: "reddit_commercial_route",
        label: "Personal or commercial use?",
        detail:
          "Reddit's Data API distinguishes personal-use apps (free, 100 QPM) from commercial-use apps (contract required). Choose 'commercial' if Paperclip's Reddit features will be exposed to paying customers — the wizard will route you to Reddit's commercial-contract email and exit.",
        blocking: true,
      },
    ],
    callouts: [
      {
        tone: "warn",
        title: "Vote automation = permanent ban",
        body: "Never automate upvotes/downvotes through this app. Reddit's vote-manipulation policy means the entire OAuth client is permanently banned on first detection — no warning.",
      },
    ],
    credentialFields: {
      clientIdLabel: "Reddit Client ID",
      clientIdHint: "The string under your app name on https://www.reddit.com/prefs/apps (just below 'web app').",
      clientSecretLabel: "Reddit Client Secret",
      clientSecretHint: "The 'secret' field on the same screen.",
    },
    needsMetaAppReview: false,
    oauth: {
      authorizeUrlTemplate:
        "https://www.reddit.com/api/v1/authorize?client_id={client_id}&response_type=code&state={state}&redirect_uri={redirect_uri}&duration=permanent&scope={scopes}",
      scopes: ["identity", "submit", "read", "history", "privatemessages"],
      scopeJoin: ",",
      responseTypeCode: true,
      requiresPkce: false,
    },
  },
};

export function getWizardSpec(platform: SocialPlatform): WizardPlatformSpec | null {
  return WIZARD_PLATFORM_SPECS[platform] ?? null;
}

export function buildOAuthAuthorizeUrl(opts: {
  spec: WizardPlatformSpec;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const { spec, clientId, redirectUri, state } = opts;
  const joinedScopes = spec.oauth.scopes.join(spec.oauth.scopeJoin);
  return spec.oauth.authorizeUrlTemplate
    .replace("{client_id}", encodeURIComponent(clientId))
    .replace("{redirect_uri}", encodeURIComponent(redirectUri))
    .replace("{state}", encodeURIComponent(state))
    .replace("{scopes}", encodeURIComponent(joinedScopes));
}

export const PAPERCLIP_SOCIAL_CALLBACK_BASE = PAPERCLIP_CALLBACK_BASE;

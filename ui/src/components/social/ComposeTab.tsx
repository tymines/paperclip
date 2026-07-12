/**
 * ComposeTab — multi-platform editor + scheduling controls.
 *
 * Mirrors Buffer's "Tailor your post" composer:
 *   - One shared text area that propagates to all selected platforms.
 *   - Platform toggle chips along the top (each selected platform validates
 *     live via /social/posts/validate, surfacing per-platform errors +
 *     warnings as colored chips below the editor).
 *   - Media attach: real uploads (jpeg/png/webp/gif/mp4) through
 *     POST /social/media with preview thumbnails, drag-free reordering
 *     (arrows — the order IS the IG carousel order), plus a paste-a-URL
 *     fallback for media already hosted elsewhere. Amber pre-publish hint
 *     when a selected platform can't take the attached media (e.g. Meta
 *     platforms need a publicly reachable URL — PAPERCLIP_PUBLIC_URL).
 *   - Save-draft / Schedule-for / Post-now action row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  FileText,
  Film,
  Image,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import type { SocialAccountPublic, SocialPlatform, SocialPostType } from "@paperclipai/shared";
import { socialApi, type CaptionSuggestion, type PostValidationResult } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { useToastActions } from "../../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLATFORM_META } from "./platform-meta";
import { cn } from "../../lib/utils";

interface ComposeTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

type ScheduleMode = "draft" | "post_now" | "schedule";

/** One attached media item — uploaded through /social/media or a pasted URL. */
interface ComposedMediaItem {
  key: string;
  /** Absolute URL that goes on the post's mediaUrls. */
  url: string;
  /** URL the browser can render as a thumbnail (session-authenticated). */
  previewUrl: string;
  kind: "image" | "video";
  filename: string;
  /** False = loopback fallback only (no public base URL configured). */
  publiclyFetchable: boolean;
}

/** Derive the post type the adapters expect from the attached media. */
function derivePostType(items: ComposedMediaItem[]): SocialPostType {
  if (items.length === 0) return "text";
  if (items.some((i) => i.kind === "video")) return "video";
  return items.length > 1 ? "carousel" : "image";
}

/** Platforms whose servers must download media from a public URL. */
const URL_FETCH_PLATFORMS: ReadonlySet<SocialPlatform> = new Set([
  "instagram",
  "facebook",
  "threads",
] as SocialPlatform[]);

export function ComposeTab({ companyId, accounts }: ComposeTabProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  // Account selection: default to all connected accounts.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => {
    return new Set(accounts.map((a) => a.id));
  });
  const [caption, setCaption] = useState("");
  const [mediaItems, setMediaItems] = useState<ComposedMediaItem[]>([]);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [publicUrlNotice, setPublicUrlNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("schedule");
  const [scheduledFor, setScheduledFor] = useState(() => nextRoundHourIso());
  const [redditTitle, setRedditTitle] = useState("");
  const [redditSubreddit, setRedditSubreddit] = useState("");

  // DeepSeek "Generate caption" panel state.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<CaptionSuggestion | null>(null);
  const [aiError, setAiError] = useState<{ title: string; detail: string } | null>(null);

  // Reset selection when accounts list changes (e.g. user just connected one).
  useEffect(() => {
    setSelectedAccountIds((prev) => {
      const validIds = new Set(accounts.map((a) => a.id));
      const next = new Set<string>();
      for (const id of prev) if (validIds.has(id)) next.add(id);
      // If nothing carries over, select all.
      if (next.size === 0) for (const a of accounts) next.add(a.id);
      return next;
    });
  }, [accounts]);

  const selectedPlatforms: SocialPlatform[] = useMemo(() => {
    const set = new Set<SocialPlatform>();
    for (const a of accounts) {
      if (selectedAccountIds.has(a.id)) set.add(a.platform);
    }
    return Array.from(set);
  }, [accounts, selectedAccountIds]);

  const mediaUrls = useMemo(() => mediaItems.map((i) => i.url), [mediaItems]);
  const postType = useMemo(() => derivePostType(mediaItems), [mediaItems]);

  // Live per-platform validation. Debounced via React Query refetch keying.
  // The server's per-platform validatePost is the source of truth for
  // media-count/type rules (X ≤4 images or 1 video, IG carousel 2–10,
  // Reddit single image, …) — its errors render as the chips below.
  const validationQuery = useQuery({
    queryKey: [
      "social",
      "validate",
      companyId,
      selectedPlatforms.join(","),
      caption,
      mediaUrls.join("|"),
      postType,
      redditTitle,
      redditSubreddit,
    ],
    queryFn: () =>
      socialApi.validatePost(companyId, selectedPlatforms, {
        baseCaption: caption,
        postType,
        mediaUrls,
        metadata: { title: redditTitle, subreddit: redditSubreddit },
      }),
    enabled: selectedPlatforms.length > 0 && (caption.length > 0 || mediaUrls.length > 0),
    staleTime: 200,
  });

  // ── Media attach ──────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => socialApi.uploadMedia(companyId, files),
    onSuccess: (result) => {
      if (result.media.length > 0) {
        setMediaItems((prev) => [
          ...prev,
          ...result.media.map((m) => ({
            key: m.id,
            url: m.mediaUrl,
            previewUrl: m.contentUrl,
            kind: m.kind,
            filename: m.filename,
            publiclyFetchable: m.publiclyFetchable,
          })),
        ]);
      }
      setPublicUrlNotice(result.publicUrlNotice ?? null);
      for (const err of result.errors) {
        pushToast({ title: `Skipped ${err.filename}`, body: err.reason, tone: "error" });
      }
    },
    onError: (err) => {
      pushToast({
        title: "Upload failed",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const onFilesPicked = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0) uploadMutation.mutate(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addRemoteMediaUrl = () => {
    const raw = mediaUrlInput.trim();
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http(s)");
    } catch {
      pushToast({ title: "Not a valid URL", body: "Paste an absolute http(s) URL.", tone: "error" });
      return;
    }
    const isVideo = /\.(mp4|mov)(\?|#|$)/i.test(raw);
    setMediaItems((prev) => [
      ...prev,
      {
        key: `url-${Date.now()}-${prev.length}`,
        url: raw,
        previewUrl: raw,
        kind: isVideo ? "video" : "image",
        filename: raw.split("/").pop()?.split("?")[0] ?? "remote media",
        // Pasted URLs are assumed hosted publicly — the adapters still
        // hard-check at publish time.
        publiclyFetchable: true,
      },
    ]);
    setMediaUrlInput("");
  };

  const removeMediaItem = (key: string) => {
    setMediaItems((prev) => prev.filter((i) => i.key !== key));
  };

  /** Reorder — the resulting order is the IG/Threads carousel order. */
  const moveMediaItem = (key: string, delta: -1 | 1) => {
    setMediaItems((prev) => {
      const index = prev.findIndex((i) => i.key === key);
      if (index < 0) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item as ComposedMediaItem);
      return next;
    });
  };

  // Amber pre-publish hint: a selected Meta-family platform can never
  // fetch loopback-only media — name the config key, don't let the
  // publish fail opaquely later.
  const urlFetchPlatformsSelected = selectedPlatforms.filter((p) => URL_FETCH_PLATFORMS.has(p));
  const nonPublicItems = mediaItems.filter((i) => !i.publiclyFetchable);
  const showPublicUrlHint = urlFetchPlatformsSelected.length > 0 && nonPublicItems.length > 0;

  // Target platform for the AI suggestion: pick the first selected
  // platform if any, otherwise default to Instagram so the user gets a
  // sensible length/tone shape.
  const aiTargetPlatform: SocialPlatform = useMemo(
    () => (selectedPlatforms[0] ?? ("instagram" as SocialPlatform)),
    [selectedPlatforms],
  );

  const firstMediaUrl = mediaItems[0]?.url ?? null;
  const captionMutation = useMutation({
    mutationFn: () =>
      socialApi.suggestCaption(companyId, {
        platform: aiTargetPlatform,
        prompt: aiPrompt.length > 0 ? aiPrompt : null,
        mediaUrl: firstMediaUrl,
      }),
    onSuccess: (result) => {
      setAiSuggestion(result);
      setAiError(null);
    },
    onError: (err) => {
      setAiSuggestion(null);
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (lower.includes("deepseek_key_missing") || lower.includes("503")) {
        setAiError({
          title: "DeepSeek key missing",
          detail: "Add your DeepSeek key in Provider API Keys, then retry.",
        });
      } else if (
        lower.includes("deepseek_key_unauthorized") ||
        lower.includes("deepseek_rate_limited") ||
        lower.includes("deepseek_upstream_error") ||
        lower.includes("502")
      ) {
        setAiError({
          title: "DeepSeek key needs attention",
          detail: "DeepSeek refused the request — key revoked, out of credit, or rate-limited.",
        });
      } else {
        setAiError({
          title: "Could not generate caption",
          detail: message.slice(0, 220),
        });
      }
    },
  });

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    const tagSuffix = aiSuggestion.hashtags.length > 0
      ? `\n\n${aiSuggestion.hashtags.map((t) => `#${t}`).join(" ")}`
      : "";
    const appended = caption.trim().length > 0
      ? `${caption.trim()}\n\n${aiSuggestion.caption}${tagSuffix}`
      : `${aiSuggestion.caption}${tagSuffix}`;
    setCaption(appended);
    setAiSuggestion(null);
    setAiPanelOpen(false);
    setAiPrompt("");
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (selectedAccountIds.size === 0) {
        throw new Error("Pick at least one account to post to.");
      }
      const status =
        scheduleMode === "draft" ? "draft" : scheduleMode === "post_now" ? "scheduled" : "scheduled";
      const scheduledAt =
        scheduleMode === "schedule"
          ? new Date(scheduledFor).toISOString()
          : scheduleMode === "post_now"
            ? new Date().toISOString()
            : null;
      return socialApi.createPost(companyId, {
        content: caption,
        postType,
        status,
        scheduledAt,
        mediaUrls,
        tags: [],
        accountIds: Array.from(selectedAccountIds),
        metadata: {
          // Keys the Reddit adapter reads at publish time.
          title: redditTitle || undefined,
          subreddit: redditSubreddit || undefined,
          // Legacy aliases kept for older readers of post.metadata.
          redditTitle: redditTitle || undefined,
          redditSubreddit: redditSubreddit || undefined,
        },
      });
    },
    onSuccess: () => {
      pushToast({
        title:
          scheduleMode === "draft"
            ? "Draft saved"
            : scheduleMode === "post_now"
              ? "Queued to post now"
              : "Scheduled",
        tone: "success",
      });
      setCaption("");
      setMediaItems([]);
      setMediaUrlInput("");
      setRedditTitle("");
      setRedditSubreddit("");
      queryClient.invalidateQueries({ queryKey: queryKeys.social.posts(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.social.queue(companyId, null) });
    },
    onError: (err) => {
      pushToast({
        title: "Couldn't submit post",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const validation = validationQuery.data ?? {};
  const anyHardError =
    Object.values(validation).some((v: PostValidationResult) => !v.ok);
  const needsRedditMeta = selectedPlatforms.includes("reddit");
  const canSubmit =
    selectedAccountIds.size > 0 &&
    (caption.trim().length > 0 || mediaItems.length > 0) &&
    !anyHardError &&
    !uploadMutation.isPending;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Left column: editor */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Post to</Label>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connect at least one account from the Accounts tab.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((account) => {
                const meta = PLATFORM_META[account.platform];
                const Icon = meta.icon;
                const active = selectedAccountIds.has(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => toggleAccount(account.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-transparent text-white"
                        : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                    style={active ? { backgroundColor: meta.color } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{account.displayName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="compose-caption" className="text-xs uppercase tracking-wide text-muted-foreground">
              Caption
            </Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="compose-generate-caption"
              onClick={() => {
                setAiPanelOpen((open) => !open);
                setAiError(null);
              }}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {aiPanelOpen ? "Hide AI" : "Generate caption"}
            </Button>
          </div>
          <Textarea
            id="compose-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's the post?"
            className="min-h-[140px] resize-y"
          />
          {aiPanelOpen ? (
            <div
              data-testid="compose-ai-panel"
              className="space-y-2 rounded-md border border-accent/40 bg-accent/10 p-3"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Generate via DeepSeek · target: {aiTargetPlatform}
              </div>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="What's the post about? (e.g. 'shipped v2 social scheduler, want to tease it to existing audience')"
                className="min-h-[64px] text-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    captionMutation.isPending ||
                    (aiPrompt.trim().length === 0 && !firstMediaUrl)
                  }
                  onClick={() => captionMutation.mutate()}
                >
                  {captionMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {captionMutation.isPending ? "Generating…" : "Generate"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Uses the first attached media as visual context if provided.
                </span>
              </div>
              {aiError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{aiError.title}</div>
                    <div className="text-destructive/90">{aiError.detail}</div>
                    <a
                      href="/instance/settings/provider-keys"
                      className="mt-0.5 inline-block text-[11px] underline underline-offset-2 hover:no-underline"
                    >
                      Open Provider API Keys →
                    </a>
                  </div>
                </div>
              ) : null}
              {aiSuggestion ? (
                <div
                  data-testid="compose-ai-suggestion"
                  className="space-y-2 rounded-md border border-border bg-card/80 p-2.5 text-xs"
                >
                  <div className="whitespace-pre-wrap text-[13px] leading-snug">
                    {aiSuggestion.caption}
                  </div>
                  {aiSuggestion.hashtags.length > 0 ? (
                    <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                      {aiSuggestion.hashtags.map((tag) => (
                        <span key={tag} className="rounded-full border border-border bg-background px-1.5 py-0.5">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="text-[10px] italic text-muted-foreground">
                    Intent: {aiSuggestion.intent}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    DeepSeek · {aiSuggestion.latencyMs} ms · ~${aiSuggestion.estimatedCostUsd.toFixed(4)}{aiSuggestion.cached ? " · cached" : ""}{aiSuggestion.usedVision ? " · vision" : ""}
                  </div>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" onClick={applyAiSuggestion}>
                      Use this
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setAiSuggestion(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {selectedPlatforms.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {selectedPlatforms.map((platform) => {
                const meta = PLATFORM_META[platform];
                const Icon = meta.icon;
                const len = caption.length;
                const limit = meta.captionLimit;
                const over = len > limit;
                const near = !over && len > limit * 0.9;
                return (
                  <span
                    key={platform}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                      over
                        ? "border-destructive/60 bg-destructive/10 text-destructive"
                        : near
                          ? "border-amber-400/60 bg-amber-50/60 text-amber-800 dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-200"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" style={{ color: meta.color }} />
                    {meta.label} {len}/{limit}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" /> Media
            </span>
          </Label>

          {mediaItems.length > 0 ? (
            <div className="flex flex-wrap gap-2" data-testid="compose-media-list">
              {mediaItems.map((item, index) => (
                <div
                  key={item.key}
                  className="group relative h-24 w-24 overflow-hidden rounded-md border border-border bg-card"
                  title={item.filename}
                >
                  {item.kind === "video" ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <Film className="h-6 w-6" />
                      <span className="max-w-[80px] truncate px-1 text-[10px]">{item.filename}</span>
                    </div>
                  ) : (
                    <img
                      src={item.previewUrl}
                      alt={item.filename}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                    {index + 1}
                  </span>
                  {!item.publiclyFetchable ? (
                    <span
                      className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1 text-[9px] font-semibold text-black"
                      title="Only reachable from this server — Instagram/Facebook/Threads can't fetch it. Set PAPERCLIP_PUBLIC_URL."
                    >
                      local
                    </span>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 hidden items-center justify-between bg-black/60 px-1 py-0.5 group-hover:flex">
                    <button
                      type="button"
                      className="text-white/80 hover:text-white disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => moveMediaItem(item.key, -1)}
                      aria-label="Move earlier"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-white/80 hover:text-white"
                      onClick={() => removeMediaItem(item.key)}
                      aria-label="Remove media"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-white/80 hover:text-white disabled:opacity-30"
                      disabled={index === mediaItems.length - 1}
                      onClick={() => moveMediaItem(item.key, 1)}
                      aria-label="Move later"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {mediaItems.length > 1 && !mediaItems.some((i) => i.kind === "video") ? (
            <p className="text-[11px] text-muted-foreground">
              This order is the carousel order on Instagram/Threads — use the arrows to rearrange.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              multiple
              className="hidden"
              data-testid="compose-media-file-input"
              onChange={(e) => onFilesPicked(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {uploadMutation.isPending ? "Uploading…" : "Upload media"}
            </Button>
            <span className="text-[11px] text-muted-foreground">jpeg / png / webp / gif / mp4</span>
          </div>

          <div className="flex gap-1.5">
            <Input
              id="compose-media-url"
              value={mediaUrlInput}
              onChange={(e) => setMediaUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRemoteMediaUrl();
                }
              }}
              placeholder="…or paste a public media URL (https://…/photo.jpg)"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mediaUrlInput.trim().length === 0}
              onClick={addRemoteMediaUrl}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

          {showPublicUrlHint ? (
            <div
              data-testid="compose-public-url-hint"
              className="flex items-start gap-2 rounded-md border border-amber-400/60 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {urlFetchPlatformsSelected.join(", ")} must download media from a publicly
                reachable URL, but {nonPublicItems.length === 1 ? "an attached file is" : `${nonPublicItems.length} attached files are`} only
                served from this machine. Set <code className="font-mono">PAPERCLIP_PUBLIC_URL</code> (or
                <code className="font-mono"> auth.publicBaseUrl</code> in config.json) and re-attach, or those
                targets will fail with this exact reason. X and Reddit are unaffected.
              </span>
            </div>
          ) : null}
          {publicUrlNotice && !showPublicUrlHint && mediaItems.some((i) => !i.publiclyFetchable) ? (
            <p className="text-[11px] text-muted-foreground">{publicUrlNotice}</p>
          ) : null}
        </div>

        {needsRedditMeta ? (
          <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
            <div className="text-xs font-medium text-muted-foreground">Reddit-specific</div>
            <Input
              value={redditTitle}
              onChange={(e) => setRedditTitle(e.target.value)}
              placeholder="Reddit post title (required)"
            />
            <Input
              value={redditSubreddit}
              onChange={(e) => setRedditSubreddit(e.target.value)}
              placeholder="Subreddit (e.g. r/SaaS)"
            />
          </div>
        ) : null}

        {/* Per-platform validation chips */}
        <div className="space-y-1.5">
          {Object.entries(validation).map(([platform, result]) => {
            const meta = PLATFORM_META[platform as SocialPlatform];
            if (!meta) return null;
            const r = result as PostValidationResult;
            if (r.ok && r.warnings.length === 0) return null;
            return (
              <div
                key={platform}
                className={cn(
                  "rounded-md border px-3 py-2 text-xs",
                  r.ok
                    ? "border-amber-300/60 bg-amber-50/60 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                <span className="font-semibold">{meta.label}: </span>
                {r.errors.concat(r.warnings).join(" ")}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right column: schedule + submit */}
      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">When to publish</h3>
          <div className="mt-3 flex flex-col gap-1.5">
            <ScheduleRadio
              value="schedule"
              checked={scheduleMode === "schedule"}
              onChange={() => setScheduleMode("schedule")}
              label="Schedule for…"
              hint="Pick an exact date + time."
            />
            {scheduleMode === "schedule" ? (
              <Input
                type="datetime-local"
                value={toDatetimeLocal(scheduledFor)}
                onChange={(e) => setScheduledFor(fromDatetimeLocal(e.target.value))}
                className="ml-6"
              />
            ) : null}
            <ScheduleRadio
              value="post_now"
              checked={scheduleMode === "post_now"}
              onChange={() => setScheduleMode("post_now")}
              label="Post now"
              hint="Publish immediately as soon as the worker picks it up."
            />
            <ScheduleRadio
              value="draft"
              checked={scheduleMode === "draft"}
              onChange={() => setScheduleMode("draft")}
              label="Save as draft"
              hint="Park without scheduling. You can publish from Queue later."
            />
          </div>

          <Button
            className="mt-4 w-full"
            disabled={!canSubmit || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : scheduleMode === "draft" ? (
              <>
                <FileText className="h-4 w-4" /> Save draft
              </>
            ) : scheduleMode === "post_now" ? (
              <>
                <Send className="h-4 w-4" /> Post now
              </>
            ) : (
              <>
                <CalendarClock className="h-4 w-4" /> Schedule
              </>
            )}
          </Button>
          {anyHardError ? (
            <p className="mt-2 text-[11px] text-destructive">
              One or more platforms have a hard validation error. Fix above before submitting.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScheduleRadio({
  value,
  checked,
  onChange,
  label,
  hint,
}: {
  value: ScheduleMode;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent/40">
      <input
        type="radio"
        name="schedule-mode"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function nextRoundHourIso(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

function toDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const tzOffset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function fromDatetimeLocal(value: string): string {
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

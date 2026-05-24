/**
 * ComposeTab — multi-platform editor + scheduling controls.
 *
 * Mirrors Buffer's "Tailor your post" composer:
 *   - One shared text area that propagates to all selected platforms.
 *   - Platform toggle chips along the top (each selected platform validates
 *     live via /social/posts/validate, surfacing per-platform errors +
 *     warnings as colored chips below the editor).
 *   - Media URL input (Tyler ships real upload later; for now paste URLs).
 *   - Save-draft / Schedule-for / Post-now action row.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Image, Loader2, Send } from "lucide-react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";
import { socialApi, type PostValidationResult } from "../../api/social";
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

export function ComposeTab({ companyId, accounts }: ComposeTabProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  // Account selection: default to all connected accounts.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => {
    return new Set(accounts.map((a) => a.id));
  });
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("schedule");
  const [scheduledFor, setScheduledFor] = useState(() => nextRoundHourIso());
  const [redditTitle, setRedditTitle] = useState("");
  const [redditSubreddit, setRedditSubreddit] = useState("");

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

  // Live per-platform validation. Debounced via React Query refetch keying.
  const validationQuery = useQuery({
    queryKey: ["social", "validate", companyId, selectedPlatforms.join(","), caption, mediaUrl, redditTitle, redditSubreddit],
    queryFn: () =>
      socialApi.validatePost(companyId, selectedPlatforms, {
        baseCaption: caption,
        postType: mediaUrl ? "image" : "text",
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        metadata: { title: redditTitle, subreddit: redditSubreddit },
      }),
    enabled: selectedPlatforms.length > 0 && (caption.length > 0 || mediaUrl.length > 0),
    staleTime: 200,
  });

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
        postType: mediaUrl ? "image" : "text",
        status,
        scheduledAt,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        tags: [],
        accountIds: Array.from(selectedAccountIds),
        metadata: {
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
      setMediaUrl("");
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
    (caption.trim().length > 0 || mediaUrl.trim().length > 0) &&
    !anyHardError;

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
          <Label htmlFor="compose-caption" className="text-xs uppercase tracking-wide text-muted-foreground">
            Caption
          </Label>
          <Textarea
            id="compose-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's the post?"
            className="min-h-[140px] resize-y"
          />
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
          <Label htmlFor="compose-media" className="text-xs uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" /> Media URL (paste for now — upload coming soon)
            </span>
          </Label>
          <Input
            id="compose-media"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://…/photo.jpg"
          />
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

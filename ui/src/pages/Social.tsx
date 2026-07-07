import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import {
  Share2,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Send,
  Trash2,
  Settings2,
  Linkedin,
  Instagram,
  Facebook,
  Youtube,
  Inbox as InboxIcon,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";
import { socialApi } from "../api/social";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { SocialAccountPublic, SocialPostListItem, SocialPlatform } from "@paperclipai/shared";
import { XLogoIcon } from "../components/social/x-icon";
import type { SocialDmRow } from "../api/social";
import { imageStudioApi, type SocialPost, type ContentIdea } from "../api/imageStudio";

// ── Platform helpers ──────────────────────────────────────────────────────────

const PLATFORM_ICONS: Partial<Record<SocialPlatform, LucideIcon>> = {
  x: XLogoIcon as unknown as LucideIcon,
  linkedin: Linkedin,
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
};

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  x: "bg-black",
  linkedin: "bg-blue-700",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  facebook: "bg-blue-600",
  tiktok: "bg-black dark:bg-white/10",
  youtube: "bg-red-600",
  pinterest: "bg-red-700",
  threads: "bg-foreground/80",
  bluesky: "bg-blue-500",
  mastodon: "bg-purple-600",
  reddit: "bg-orange-600",
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  reddit: "Reddit",
};

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "outline" },
  publishing: { label: "Publishing", variant: "default" },
  published: { label: "Published", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const STATUS_ICONS: Record<string, LucideIcon> = {
  draft: FileText,
  scheduled: Clock,
  publishing: Send,
  published: CheckCircle2,
  failed: AlertCircle,
};

function PlatformIcon({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const Icon = PLATFORM_ICONS[platform];
  if (Icon) return <Icon style={{ width: size, height: size }} />;
  return (
    <span className="font-bold text-[10px] uppercase leading-none">
      {platform.slice(0, 2)}
    </span>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

type Tab = "posts" | "calendar" | "accounts" | "inbox";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Date(iso).toLocaleDateString();
}

function DmRow({
  dm,
  onMarkRead,
  onExpand,
  expanded,
  threadMessages,
}: {
  dm: SocialDmRow;
  onMarkRead: (dm: SocialDmRow) => void;
  onExpand: (dm: SocialDmRow) => void;
  expanded: boolean;
  threadMessages: SocialDmRow[] | null;
}) {
  const unread = dm.readAt == null && dm.direction === "inbound";
  const initials = (dm.senderHandle ?? dm.senderDisplayName ?? "?").slice(0, 2).toUpperCase();
  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
        unread ? "bg-primary/5 border-primary/30" : "hover:bg-accent/40"
      }`}
      onClick={() => {
        onExpand(dm);
        if (unread) onMarkRead(dm);
      }}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {dm.senderAvatarUrl ? (
            <img
              src={dm.senderAvatarUrl}
              alt=""
              className="h-9 w-9 rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium">
              {initials}
            </div>
          )}
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">
              {dm.senderDisplayName ?? dm.senderHandle ?? "Unknown sender"}
            </span>
            {dm.senderVerified && (
              <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-label="Verified" />
            )}
            {dm.senderHandle && (
              <span className="text-xs text-muted-foreground truncate">@{dm.senderHandle}</span>
            )}
            {dm.senderIsFirstContact && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/60 text-amber-700 dark:text-amber-300">
                first contact
              </Badge>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {timeAgo(dm.sentAt)}
            </span>
          </div>
          <p className={`mt-1 text-sm ${unread ? "text-foreground" : "text-muted-foreground"} line-clamp-2`}>
            {dm.text ?? <span className="italic text-muted-foreground">(no text)</span>}
          </p>
          {expanded && threadMessages && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {threadMessages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className="font-medium">
                    {m.direction === "outbound" ? "You" : m.senderHandle ? `@${m.senderHandle}` : "Them"}
                  </span>
                  <span className="text-muted-foreground"> · {timeAgo(m.sentAt)}</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxView({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data: dms, isLoading } = useQuery({
    queryKey: queryKeys.social.dms(companyId, null, unreadOnly),
    queryFn: () => socialApi.listDms(companyId, { unreadOnly, limit: 100 }),
    refetchInterval: 60_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (dmId: string) => socialApi.markDmRead(companyId, dmId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social", "dms"] });
    },
  });

  const allDms = dms ?? [];
  const threadDms = expandedThreadId
    ? allDms.filter((d) => d.threadId === expandedThreadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    : null;
  const threadHeads = new Map<string, SocialDmRow>();
  for (const d of allDms) {
    const cur = threadHeads.get(d.threadId);
    if (!cur || d.sentAt > cur.sentAt) threadHeads.set(d.threadId, d);
  }
  const heads = [...threadHeads.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }
  if (heads.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        message={
          unreadOnly
            ? "No unread DMs."
            : "No DMs yet. Once you connect an X account with dm.read scope, new messages will appear here within ~60 seconds."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {heads.length} thread{heads.length === 1 ? "" : "s"}
          {dms && dms.some((d) => d.readAt == null && d.direction === "inbound") && (
            <span className="ml-2">
              · {dms.filter((d) => d.readAt == null && d.direction === "inbound").length} unread
            </span>
          )}
        </p>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {unreadOnly ? "Show all" : "Unread only"}
        </button>
      </div>
      <div className="space-y-2">
        {heads.map((dm) => (
          <DmRow
            key={dm.threadId}
            dm={dm}
            expanded={dm.threadId === expandedThreadId}
            threadMessages={dm.threadId === expandedThreadId ? threadDms : null}
            onMarkRead={(d) => markReadMutation.mutate(d.id)}
            onExpand={(d) =>
              setExpandedThreadId((cur) => (cur === d.threadId ? null : d.threadId))
            }
          />
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  account,
  onDelete,
}: {
  account: SocialAccountPublic;
  onDelete: () => void;
}) {
  const isHealthy = account.status === "connected";
  return (
    <Card className="transition-colors hover:bg-accent/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${PLATFORM_COLORS[account.platform]}`}
          >
            <PlatformIcon platform={account.platform} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{account.displayName}</span>
              <Badge variant={isHealthy ? "default" : "destructive"} className="text-[10px] px-1.5">
                {account.status}
              </Badge>
            </div>
            {account.username && (
              <p className="text-xs text-muted-foreground truncate">@{account.username}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {PLATFORM_LABELS[account.platform]}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PostCard({
  post,
  onClick,
}: {
  post: SocialPostListItem;
  onClick: () => void;
}) {
  const statusBadge = STATUS_BADGES[post.status] ?? STATUS_BADGES.draft;
  const StatusIcon = STATUS_ICONS[post.status] ?? FileText;

  return (
    <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <StatusIcon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-medium">
                {post.title || post.content.slice(0, 60) + (post.content.length > 60 ? "..." : "")}
              </h3>
              <Badge variant={statusBadge.variant} className="text-[10px] px-1.5 shrink-0">
                {statusBadge.label}
              </Badge>
            </div>
            {post.title && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{post.content}</p>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {post.platforms.map((platform) => (
                <div
                  key={platform}
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-white text-[8px] ${PLATFORM_COLORS[platform as SocialPlatform]}`}
                >
                  <PlatformIcon platform={platform as SocialPlatform} size={10} />
                </div>
              ))}
              {post.scheduledAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                  <Clock className="h-3 w-3" />
                  {new Date(post.scheduledAt).toLocaleString()}
                </span>
              )}
              {post.tags.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {post.tags.map((t) => `#${t}`).join(" ")}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarView({ posts }: { posts: SocialPostListItem[] }) {
  const scheduledPosts = posts.filter((p) => p.scheduledAt);
  const groupedByDay = scheduledPosts.reduce<Record<string, SocialPostListItem[]>>((acc, post) => {
    const day = new Date(post.scheduledAt!).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    (acc[day] ??= []).push(post);
    return acc;
  }, {});

  if (Object.keys(groupedByDay).length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        message="No scheduled posts yet. Create a post and set a schedule."
      />
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedByDay).map(([day, dayPosts]) => (
        <div key={day}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">{day}</h3>
          <div className="space-y-2 pl-4 border-l-2 border-border">
            {dayPosts.map((post) => (
              <div key={post.id} className="flex items-center gap-3 py-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {new Date(post.scheduledAt!).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <div className="flex gap-1">
                  {post.platforms.map((platform) => (
                    <div
                      key={platform}
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-white text-[8px] ${PLATFORM_COLORS[platform as SocialPlatform]}`}
                    >
                      <PlatformIcon platform={platform as SocialPlatform} size={10} />
                    </div>
                  ))}
                </div>
                <span className="text-sm truncate flex-1">
                  {post.title || post.content.slice(0, 80)}
                </span>
                <Badge
                  variant={STATUS_BADGES[post.status]?.variant ?? "secondary"}
                  className="text-[10px] px-1.5"
                >
                  {STATUS_BADGES[post.status]?.label ?? post.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function Social() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [tab, setTab] = useState<Tab>("posts");
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  // Post draft
  const [postDraft, setPostDraft] = useState({
    title: "",
    content: "",
    postType: "text",
    scheduledAt: "",
    accountIds: [] as string[],
    tags: "",
  });

  // Account draft
  const [accountDraft, setAccountDraft] = useState({
    platform: "x" as SocialPlatform,
    displayName: "",
    username: "",
    platformAccountId: "",
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Social" }]);
  }, [setBreadcrumbs]);

  // Queries
  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: queryKeys.social.posts(selectedCompanyId!),
    queryFn: () => socialApi.listPosts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: queryKeys.social.accounts(selectedCompanyId!),
    queryFn: () => socialApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: draftsData, isLoading: draftsLoading } = useQuery({
    queryKey: ["influencer", "drafts", selectedCompanyId],
    queryFn: () => imageStudioApi.listDrafts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Mutations
  const createPostMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      socialApi.createPost(selectedCompanyId!, data),
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.social.posts(selectedCompanyId!) });
      setCreatePostOpen(false);
      setPostDraft({ title: "", content: "", postType: "text", scheduledAt: "", accountIds: [], tags: "" });
      pushToast({ title: "Post created", body: post.status === "scheduled" ? "Scheduled for publishing" : "Saved as draft" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to create post", body: err.message, tone: "error" });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      socialApi.createAccount(selectedCompanyId!, data),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.social.accounts(selectedCompanyId!) });
      setAddAccountOpen(false);
      setAccountDraft({ platform: "x", displayName: "", username: "", platformAccountId: "" });
      pushToast({ title: "Account connected", body: account.displayName });
    },
    onError: (err) => {
      pushToast({ title: "Failed to add account", body: err.message, tone: "error" });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      socialApi.deleteAccount(selectedCompanyId!, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.social.accounts(selectedCompanyId!) });
      pushToast({ title: "Account removed" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to remove account", body: err.message, tone: "error" });
    },
  });

  function handleCreatePost() {
    if (!postDraft.content.trim() || postDraft.accountIds.length === 0) return;
    createPostMutation.mutate({
      title: postDraft.title.trim() || null,
      content: postDraft.content.trim(),
      postType: postDraft.postType,
      scheduledAt: postDraft.scheduledAt || null,
      accountIds: postDraft.accountIds,
      tags: postDraft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  function handleAddAccount() {
    if (!accountDraft.displayName.trim() || !accountDraft.platformAccountId.trim()) return;
    createAccountMutation.mutate({
      platform: accountDraft.platform,
      displayName: accountDraft.displayName.trim(),
      username: accountDraft.username.trim() || null,
      platformAccountId: accountDraft.platformAccountId.trim(),
    });
  }

  function toggleAccountSelection(accountId: string) {
    setPostDraft((d) => ({
      ...d,
      accountIds: d.accountIds.includes(accountId)
        ? d.accountIds.filter((id) => id !== accountId)
        : [...d.accountIds, accountId],
    }));
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Share2} message="Select a company to manage social media." />;
  }

  if (postsLoading || accountsLoading) {
    return <PageSkeleton variant="list" />;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "posts", label: "Posts" },
    { id: "calendar", label: "Calendar" },
    { id: "inbox", label: "Inbox" },
    { id: "accounts", label: "Accounts" },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tab === "accounts" && (
            <Button size="sm" variant="outline" onClick={() => setAddAccountOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Account
            </Button>
          )}
          {(tab === "posts" || tab === "calendar") && (
            <Button size="sm" onClick={() => setCreatePostOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Post
            </Button>
          )}
        </div>
      </div>

      {/* Posts tab */}
      {tab === "posts" && (
        <>
          {/* Influencer Drafts panel */}
          {draftsLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!draftsLoading && draftsData && draftsData.drafts.length > 0 && (
            <div
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Influencer Drafts</h3>
                <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {draftsData.drafts.length}
                </span>
              </div>
              <div className="divide-y divide-border">
                {draftsData.drafts.map((draft) => {
                  const personaName =
                    (draft.metadata as Record<string, unknown> | null)?.personaId
                      ? `Persona: ${String((draft.metadata as Record<string, unknown>).personaId).slice(0, 8)}...`
                      : "Influencer Studio";
                  const draftStatusBadge = STATUS_BADGES[draft.status] ?? { label: draft.status, variant: "secondary" as const };
                  return (
                    <div key={draft.id} className="px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm line-clamp-2 leading-snug">
                            {draft.content.slice(0, 80)}
                            {draft.content.length > 80 ? "..." : ""}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-muted-foreground">
                              {personaName}
                            </span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(draft.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant={draftStatusBadge.variant}
                          className="text-[10px] px-1.5 shrink-0 mt-0.5"
                        >
                          {draftStatusBadge.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!draftsLoading && draftsData && draftsData.drafts.length === 0 && (
            <div
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Influencer Drafts</h3>
                <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  0
                </span>
              </div>
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No AI-generated drafts yet.</p>
              </div>
            </div>
          )}

          {posts && posts.length === 0 && (
            <EmptyState
              icon={Share2}
              message="No posts yet. Create your first social media post."
              action="New Post"
              onAction={() => setCreatePostOpen(true)}
            />
          )}
          {posts && posts.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onClick={() => navigate(`/social/posts/${post.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Calendar tab */}
      {tab === "calendar" && <CalendarView posts={posts ?? []} />}

      {/* Inbox tab — real DMs polled from X (and other platforms as they wire in). */}
      {tab === "inbox" && <InboxView companyId={selectedCompanyId} />}

      {/* Accounts tab */}
      {tab === "accounts" && (
        <>
          {accounts && accounts.length === 0 && (
            <EmptyState
              icon={Settings2}
              message="No social accounts connected. Add one to start posting."
              action="Add Account"
              onAction={() => setAddAccountOpen(true)}
            />
          )}
          {accounts && accounts.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  onDelete={() => deleteAccountMutation.mutate(account.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Create Post Dialog ──────────────────────────────────────────── */}
      <Dialog open={createPostOpen} onOpenChange={setCreatePostOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="post-title">Title (optional)</Label>
              <Input
                id="post-title"
                placeholder="e.g. Product Launch Announcement"
                value={postDraft.title}
                onChange={(e) => setPostDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-content">Content</Label>
              <Textarea
                id="post-content"
                placeholder="What do you want to share?"
                rows={4}
                value={postDraft.content}
                onChange={(e) => setPostDraft((d) => ({ ...d, content: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground text-right">
                {postDraft.content.length} / 10,000
              </p>
            </div>
            <div className="space-y-2">
              <Label>Post to</Label>
              {(!accounts || accounts.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  No accounts connected.{" "}
                  <button
                    className="underline"
                    onClick={() => {
                      setCreatePostOpen(false);
                      setTab("accounts");
                      setAddAccountOpen(true);
                    }}
                  >
                    Add one first
                  </button>
                  .
                </p>
              )}
              {accounts && accounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((account) => {
                    const selected = postDraft.accountIds.includes(account.id);
                    return (
                      <button
                        key={account.id}
                        onClick={() => toggleAccountSelection(account.id)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-white text-[7px] ${PLATFORM_COLORS[account.platform]}`}
                        >
                          <PlatformIcon platform={account.platform} size={8} />
                        </div>
                        {account.displayName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="post-type">Type</Label>
                <Select
                  value={postDraft.postType}
                  onValueChange={(value) => setPostDraft((d) => ({ ...d, postType: value }))}
                >
                  <SelectTrigger id="post-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="carousel">Carousel</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="reel">Reel</SelectItem>
                    <SelectItem value="thread">Thread</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="post-schedule">Schedule (optional)</Label>
                <Input
                  id="post-schedule"
                  type="datetime-local"
                  value={postDraft.scheduledAt}
                  onChange={(e) => setPostDraft((d) => ({ ...d, scheduledAt: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-tags">Tags (comma-separated)</Label>
              <Input
                id="post-tags"
                placeholder="e.g. launch, product, ai"
                value={postDraft.tags}
                onChange={(e) => setPostDraft((d) => ({ ...d, tags: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreatePostOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreatePost}
              disabled={
                !postDraft.content.trim() ||
                postDraft.accountIds.length === 0 ||
                createPostMutation.isPending
              }
            >
              {createPostMutation.isPending
                ? "Creating..."
                : postDraft.scheduledAt
                  ? "Schedule"
                  : "Save Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Account Dialog ──────────────────────────────────────────── */}
      <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Social Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-platform">Platform</Label>
              <Select
                value={accountDraft.platform}
                onValueChange={(value) =>
                  setAccountDraft((d) => ({ ...d, platform: value as SocialPlatform }))
                }
              >
                <SelectTrigger id="account-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="x">X</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="pinterest">Pinterest</SelectItem>
                  <SelectItem value="threads">Threads</SelectItem>
                  <SelectItem value="bluesky">Bluesky</SelectItem>
                  <SelectItem value="mastodon">Mastodon</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-name">Display Name</Label>
              <Input
                id="account-name"
                placeholder="e.g. Acme Corp"
                value={accountDraft.displayName}
                onChange={(e) => setAccountDraft((d) => ({ ...d, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-username">Username</Label>
              <Input
                id="account-username"
                placeholder="e.g. acmecorp"
                value={accountDraft.username}
                onChange={(e) => setAccountDraft((d) => ({ ...d, username: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-id">Platform Account ID</Label>
              <Input
                id="account-id"
                placeholder="Platform-specific account identifier"
                value={accountDraft.platformAccountId}
                onChange={(e) =>
                  setAccountDraft((d) => ({ ...d, platformAccountId: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddAccountOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAccount}
              disabled={
                !accountDraft.displayName.trim() ||
                !accountDraft.platformAccountId.trim() ||
                createAccountMutation.isPending
              }
            >
              {createAccountMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "@/lib/router";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Send,
  Trash2,
  Save,
  Linkedin,
  Instagram,
  Facebook,
  Youtube,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { socialApi } from "../api/social";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { SocialPlatform, SocialPostTarget } from "@paperclipai/shared";
import { XLogoIcon } from "../components/social/x-icon";
import { BlockedBadge, isBlockedStatus } from "../components/social/data-honesty";

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

const PLATFORM_ICONS: Partial<Record<SocialPlatform, LucideIcon>> = {
  x: XLogoIcon as unknown as LucideIcon,
  linkedin: Linkedin,
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
};

function PlatformIcon({ platform, size = 14 }: { platform: SocialPlatform; size?: number }) {
  const Icon = PLATFORM_ICONS[platform];
  if (Icon) return <Icon style={{ width: size, height: size }} />;
  return <span className="font-bold text-[9px] uppercase">{platform.slice(0, 2)}</span>;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "outline",
  publishing: "default",
  published: "default",
  failed: "destructive",
  cancelled: "secondary",
  // Terminal: no credentialed publish path (blocked_no_credential). Rendered
  // as an amber BlockedBadge where we have the target; this variant is the
  // fallback for generic status badges.
  blocked: "outline",
};

function TargetRow({ target }: { target: SocialPostTarget }) {
  const platform = target.platform as SocialPlatform;
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-accent/30 transition-colors">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${PLATFORM_COLORS[platform]}`}
      >
        <PlatformIcon platform={platform} size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{PLATFORM_LABELS[platform]}</span>
        {target.platformPostId && (
          <span className="text-xs text-muted-foreground ml-2">ID: {target.platformPostId}</span>
        )}
      </div>
      {isBlockedStatus(target.status) ? (
        <BlockedBadge detail={target.errorMessage} />
      ) : (
        <Badge variant={STATUS_VARIANTS[target.status] ?? "secondary"} className="text-[10px] px-1.5">
          {target.status}
        </Badge>
      )}
      {target.platformUrl && (
        <a
          href={target.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

export function SocialPostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");

  const { data: post, isLoading } = useQuery({
    queryKey: queryKeys.social.postDetail(selectedCompanyId!, postId!),
    queryFn: () => socialApi.getPost(selectedCompanyId!, postId!),
    enabled: !!selectedCompanyId && !!postId,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Social", href: "/social" },
      { label: post?.title || "Post" },
    ]);
  }, [setBreadcrumbs, post]);

  useEffect(() => {
    if (post) {
      setEditContent(post.content);
      setEditTitle(post.title ?? "");
    }
  }, [post]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      socialApi.updatePost(selectedCompanyId!, postId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.social.postDetail(selectedCompanyId!, postId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.social.posts(selectedCompanyId!) });
      setEditing(false);
      pushToast({ title: "Post updated" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to update", body: err.message, tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => socialApi.deletePost(selectedCompanyId!, postId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.social.posts(selectedCompanyId!) });
      pushToast({ title: "Post deleted" });
      navigate("/social");
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete", body: err.message, tone: "error" });
    },
  });

  if (isLoading || !post) {
    return <PageSkeleton variant="detail" />;
  }

  const isEditable = post.status === "draft" || post.status === "scheduled";
  const statusBadge = STATUS_VARIANTS[post.status] ?? "secondary";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/social")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold truncate">
              {post.title || "Untitled Post"}
            </h1>
            {isBlockedStatus(post.status) ? (
              <BlockedBadge />
            ) : (
              <Badge variant={statusBadge} className="text-xs">
                {post.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Created {new Date(post.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          {isEditable && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {isEditable && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Content</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-content">Content</Label>
                <Textarea
                  id="edit-content"
                  rows={6}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    updateMutation.mutate({
                      title: editTitle.trim() || null,
                      content: editContent.trim(),
                    })
                  }
                  disabled={!editContent.trim() || updateMutation.isPending}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm">{post.content}</div>
          )}
        </CardContent>
      </Card>

      {/* Schedule info */}
      {post.scheduledAt && (
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              Scheduled for{" "}
              <strong>{new Date(post.scheduledAt).toLocaleString()}</strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {post.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {post.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Targets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Platforms ({post.targets.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {post.targets.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No platforms targeted.</p>
          )}
          {post.targets.map((target) => (
            <TargetRow key={target.id} target={target} />
          ))}
        </CardContent>
      </Card>

      {/* Analytics (if published) */}
      {post.targets.some((t) => t.analytics) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(() => {
                const totals = post.targets.reduce(
                  (acc, t) => {
                    if (!t.analytics) return acc;
                    acc.impressions += (t.analytics as Record<string, number>).impressions ?? 0;
                    acc.engagements += (t.analytics as Record<string, number>).engagements ?? 0;
                    acc.likes += (t.analytics as Record<string, number>).likes ?? 0;
                    acc.shares += (t.analytics as Record<string, number>).shares ?? 0;
                    return acc;
                  },
                  { impressions: 0, engagements: 0, likes: 0, shares: 0 },
                );
                return Object.entries(totals).map(([key, value]) => (
                  <div key={key} className="text-center">
                    <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground capitalize">{key}</p>
                  </div>
                ));
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

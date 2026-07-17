/**
 * QueueTab — Buffer-style chronological queue per account.
 *
 * Each connected account gets a column showing its upcoming posts in send
 * order: media thumb, caption excerpt, send time, status. v1 ships the
 * read view; drag-to-reorder lands in v1.1 (the data model already supports
 * it — just need to wire the ordering field).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import type { SocialAccountPublic, SocialPostListItem } from "@paperclipai/shared";
import { socialApi } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";
import { BlockedBadge, isBlockedStatus } from "./data-honesty";
import { PLATFORM_META } from "./platform-meta";

interface QueueTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

export function QueueTab({ companyId, accounts }: QueueTabProps) {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    accounts[0]?.id ?? null,
  );

  const queueQuery = useQuery({
    queryKey: queryKeys.social.queue(companyId, activeAccountId),
    queryFn: () => socialApi.queue(companyId, activeAccountId ?? undefined),
    enabled: !!companyId,
  });

  const posts = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Connect a social account to see its queue.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Account chip bar */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveAccountId(null)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
            activeAccountId === null
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
        >
          All accounts
        </button>
        {accounts.map((account) => {
          const meta = PLATFORM_META[account.platform];
          const Icon = meta.icon;
          const active = activeAccountId === account.id;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => setActiveAccountId(account.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                active
                  ? "border-transparent text-white"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
              style={active ? { backgroundColor: meta.color } : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {account.displayName}
            </button>
          );
        })}
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
          <Inbox className="h-5 w-5" />
          Nothing in this queue. Compose a post to add one.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sortByScheduled(posts).map((post) => (
            <QueueRow key={post.id} post={post} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueRow({ post }: { post: SocialPostListItem }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex w-20 shrink-0 flex-col items-center text-center">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          {post.scheduledAt
            ? new Date(post.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "Draft"}
        </div>
        <div className="text-xs text-muted-foreground">
          {post.scheduledAt
            ? new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
            : "—"}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {post.platforms.map((p) => {
            const m = PLATFORM_META[p];
            const Icon = m.icon;
            return (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: m.color }}
              >
                <Icon className="h-3 w-3" />
                {m.label}
              </span>
            );
          })}
        </div>
        <div className="mt-1 line-clamp-2 text-sm">{post.content}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isBlockedStatus(post.status) ? (
          <BlockedBadge />
        ) : (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase text-accent-foreground">
            {post.status}
          </span>
        )}
        <Button variant="ghost" size="sm" title="Edit (coming soon)" disabled>
          Edit
        </Button>
      </div>
    </li>
  );
}

function sortByScheduled(posts: SocialPostListItem[]): SocialPostListItem[] {
  return [...posts].sort((a, b) => {
    const aT = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bT = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aT - bT;
  });
}

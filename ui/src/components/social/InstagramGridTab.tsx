/**
 * InstagramGridTab — Later's killer feature.
 *
 * A 3-column grid showing what Tyler's Instagram feed will look like AFTER
 * his scheduled-but-not-yet-published posts go out:
 *
 *   - Top rows = scheduled posts (the future), tinted with a dotted border
 *     and a "Scheduled" overlay
 *   - Below = currently-published posts, fetched from the platform via the
 *     /social/feed/instagram endpoint
 *   - Merged into a single grid sorted by publish time DESC
 *
 * v1: read-only preview. Drag-to-reorder scheduled posts lands in v1.1
 * (the data model — scheduledAt timestamps — already supports it cleanly).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Image as ImageIcon, Instagram } from "lucide-react";
import type { SocialAccountPublic } from "@paperclipai/shared";
import { socialApi, type FeedPublished, type FeedScheduled } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";

interface InstagramGridTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

type Cell =
  | { kind: "scheduled"; post: FeedScheduled; sortTime: number }
  | { kind: "published"; post: FeedPublished; sortTime: number };

export function InstagramGridTab({ companyId, accounts }: InstagramGridTabProps) {
  const igAccount = accounts.find((a) => a.platform === "instagram" && a.status === "connected");
  const feedQuery = useQuery({
    queryKey: queryKeys.social.feed(companyId, "instagram", igAccount?.id ?? null),
    queryFn: () => socialApi.feed(companyId, "instagram", { accountId: igAccount?.id, limit: 33 }),
    enabled: !!igAccount,
  });

  const cells: Cell[] = useMemo(() => {
    if (!feedQuery.data) return [];
    const scheduledCells: Cell[] = (feedQuery.data.scheduled ?? []).map((p) => ({
      kind: "scheduled",
      post: p,
      sortTime: p.scheduledAt ? new Date(p.scheduledAt).getTime() : Date.now() + 365 * 24 * 3600 * 1000,
    }));
    const publishedCells: Cell[] = (feedQuery.data.published ?? []).map((p) => ({
      kind: "published",
      post: p,
      sortTime: p.publishedAt ? new Date(p.publishedAt).getTime() : 0,
    }));
    return [...scheduledCells, ...publishedCells].sort((a, b) => b.sortTime - a.sortTime);
  }, [feedQuery.data]);

  if (!igAccount) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
        <Instagram className="h-6 w-6" />
        <p>Connect an Instagram account to see the grid preview.</p>
        <p className="max-w-md text-xs">
          Once connected, this grid shows your real published posts plus a
          preview of any scheduled posts in the slots they'll occupy after
          publishing — so you can plan how your feed will look ahead of time.
        </p>
      </div>
    );
  }

  if (feedQuery.isLoading) {
    return <GridSkeleton />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Instagram className="h-4 w-4" />
          <span className="text-sm font-medium">{igAccount.displayName}</span>
          <span className="text-xs text-muted-foreground">{igAccount.username}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <LegendDot variant="scheduled" /> Scheduled
          <LegendDot variant="published" /> Published
        </div>
      </div>

      {cells.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
          No posts yet. Compose an image post and schedule it to see how the grid will look.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {cells.map((cell, i) => (
            <GridCell key={`${cell.kind}-${i}`} cell={cell} />
          ))}
        </div>
      )}
    </div>
  );
}

function GridCell({ cell }: { cell: Cell }) {
  const post = cell.post;
  const caption = post.caption ?? "";
  const mediaUrl = post.mediaUrl ?? null;
  const isScheduled = cell.kind === "scheduled";
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden bg-muted",
        isScheduled && "outline outline-2 outline-offset-[-2px] outline-dashed outline-primary/70",
      )}
      title={caption.slice(0, 200)}
    >
      {mediaUrl ? (
        <img
          src={mediaUrl}
          alt=""
          loading="lazy"
          className={cn(
            "h-full w-full object-cover transition-opacity",
            isScheduled && "opacity-80",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          (no image)
        </div>
      )}
      {isScheduled ? (
        <div className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
          <CalendarClock className="h-3 w-3" /> Scheduled
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 text-[11px] text-white transition-transform group-hover:translate-y-0">
        {isScheduled ? (
          <div className="mb-1 text-[10px] uppercase tracking-wide">
            {formatScheduledLabel((post as FeedScheduled).scheduledAt)}
          </div>
        ) : null}
        <div className="line-clamp-3">{caption || "(no caption)"}</div>
      </div>
    </div>
  );
}

function LegendDot({ variant }: { variant: "scheduled" | "published" }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 rounded-sm",
        variant === "scheduled"
          ? "border-2 border-dashed border-primary"
          : "bg-foreground/40",
      )}
      aria-hidden
    />
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse bg-muted" />
      ))}
    </div>
  );
}

function formatScheduledLabel(value: string | null): string {
  if (!value) return "Scheduled";
  const d = new Date(value);
  return `Scheduled · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * CalendarTab — month + list view of scheduled / published posts.
 *
 * v1 ships month and list. Week view stubbed for v1.1 (the data hooks are
 * identical; only the layout differs).
 *
 * Posts color-stripe by primary platform target. Clicking a post in either
 * view opens a detail popover with caption + scheduled time + platforms.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { SocialAccountPublic, SocialPostListItem } from "@paperclipai/shared";
import { socialApi } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";
import { BlockedBadge, isBlockedStatus } from "./data-honesty";
import { PLATFORM_META } from "./platform-meta";

interface CalendarTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

type View = "month" | "list";

export function CalendarTab({ companyId, accounts: _accounts }: CalendarTabProps) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => firstOfMonth(new Date()));

  const postsQuery = useQuery({
    queryKey: queryKeys.social.posts(companyId, undefined),
    queryFn: () => socialApi.listPosts(companyId),
  });

  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  const byDay = useMemo(() => groupPostsByDay(posts), [posts]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setCursor(shiftMonth(cursor, -1))} title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-2 text-sm font-medium">{monthLabel}</div>
          <Button variant="outline" size="icon-sm" onClick={() => setCursor(shiftMonth(cursor, 1))} title="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(firstOfMonth(new Date()))}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant={view === "month" ? "secondary" : "ghost"} size="sm" onClick={() => setView("month")}>
            Month
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setView("list")}>
            List
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid cursor={cursor} byDay={byDay} />
      ) : (
        <ListView posts={posts} />
      )}
    </div>
  );
}

function MonthGrid({ cursor, byDay }: { cursor: Date; byDay: Map<string, SocialPostListItem[]> }) {
  const cells = buildMonthCells(cursor);
  const todayKey = ymd(new Date());

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          const key = ymd(cell.date);
          const inMonth = cell.date.getMonth() === cursor.getMonth();
          const isToday = key === todayKey;
          const dayPosts = byDay.get(key) ?? [];
          return (
            <div
              key={i}
              className={cn(
                "flex h-28 flex-col gap-1 rounded-md border p-1.5 text-xs",
                inMonth ? "border-border bg-card/60" : "border-transparent bg-transparent text-muted-foreground/60",
                isToday ? "ring-1 ring-primary" : null,
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("font-medium", isToday && "text-primary")}>{cell.date.getDate()}</span>
                {dayPosts.length > 0 ? (
                  <span className="text-[10px] text-muted-foreground">{dayPosts.length}</span>
                ) : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {dayPosts.slice(0, 3).map((post) => {
                  const primaryPlatform = post.platforms[0];
                  const color = primaryPlatform ? PLATFORM_META[primaryPlatform].color : "#a1a1aa";
                  return (
                    <div
                      key={post.id}
                      className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: color }}
                      title={`${post.content.slice(0, 80)} · ${post.platforms.join(", ")}`}
                    >
                      {timeOfDay(post.scheduledAt)} · {post.content.slice(0, 30)}
                    </div>
                  );
                })}
                {dayPosts.length > 3 ? (
                  <div className="text-[10px] text-muted-foreground">+{dayPosts.length - 3} more</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ posts }: { posts: SocialPostListItem[] }) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        <Inbox className="h-5 w-5" />
        Nothing scheduled yet. Compose a post and pick "Schedule for…" to populate this view.
      </div>
    );
  }
  const sorted = [...posts].sort((a, b) => {
    const aT = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bT = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aT - bT;
  });
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {sorted.map((post) => (
        <li key={post.id} className="flex items-start gap-3 px-4 py-3">
          <div className="flex flex-col items-center w-20 shrink-0 text-center">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              {post.scheduledAt ? new Date(post.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Draft"}
            </div>
            <div className="text-xs text-muted-foreground">{timeOfDay(post.scheduledAt)}</div>
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
          <div className="shrink-0 text-[11px] text-muted-foreground">
            {isBlockedStatus(post.status) ? <BlockedBadge /> : post.status}
          </div>
        </li>
      ))}
    </ul>
  );
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function buildMonthCells(cursor: Date): { date: Date }[] {
  const first = firstOfMonth(cursor);
  const startOffset = first.getDay();
  const start = new Date(first);
  start.setDate(start.getDate() - startOffset);
  const cells: { date: Date }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d });
  }
  return cells;
}
function groupPostsByDay(posts: SocialPostListItem[]): Map<string, SocialPostListItem[]> {
  const map = new Map<string, SocialPostListItem[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const key = ymd(new Date(p.scheduledAt));
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}
function timeOfDay(value: string | Date | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

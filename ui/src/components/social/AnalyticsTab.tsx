/**
 * AnalyticsTab — own-account performance dashboard.
 *
 * Top row of KPI tiles (followers, posts this period, avg engagement,
 * top platform). Below: follower sparkline, engagement-over-time
 * stacked area, best-times-to-post heatmap (7 days × 24 hours),
 * top posts grid, top hashtags table.
 *
 * Data-honest (spec §7): the endpoint returns real metrics where keyed
 * (IG Graph Insights / FB Pages Insights / X public_metrics), or an
 * explicit keyed-off state — never mock charts.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Heart, Users } from "lucide-react";
import type { SocialAccountPublic } from "@paperclipai/shared";
import { socialApi } from "../../api/social";
import { cn } from "../../lib/utils";
import { KeyedOffNotice } from "./data-honesty";
import { PLATFORM_META } from "./platform-meta";

interface AnalyticsTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

export function AnalyticsTab({ companyId, accounts }: AnalyticsTabProps) {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    accounts.find((a) => a.status === "connected")?.id ?? null,
  );

  const analyticsQuery = useQuery({
    queryKey: ["social", "analytics", companyId, activeAccountId ?? "default"],
    queryFn: () => socialApi.analytics(companyId, { accountId: activeAccountId ?? undefined }),
    enabled: !!activeAccountId,
  });

  if (accounts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Connect at least one account (Accounts surface → connect wizard) to see analytics.
      </div>
    );
  }

  const result = analyticsQuery.data;
  const keyedOff = result && !result.available ? result : null;
  const data = result?.available ? result.data : undefined;
  const followerStart = data?.followers[0]?.value ?? 0;
  const followerEnd = data?.followers.at(-1)?.value ?? 0;
  const followerDelta = followerEnd - followerStart;
  const totalLikes = (data?.engagement ?? []).reduce((s, e) => s + e.likes, 0);
  const totalComments = (data?.engagement ?? []).reduce((s, e) => s + e.comments, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Account chips */}
      <div className="flex flex-wrap gap-1.5">
        {accounts
          .filter((a) => a.status === "connected")
          .map((account) => {
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
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                style={active ? { backgroundColor: meta.color } : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {account.displayName}
              </button>
            );
          })}
      </div>

      {keyedOff ? (
        <KeyedOffNotice
          icon={BarChart3}
          featurePitch="Analytics will chart follower growth, engagement over time, best times to post, and your top posts and hashtags — from real platform metrics, never mock data."
          state={keyedOff}
        />
      ) : (
        <>
      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Followers"
          value={followerEnd.toLocaleString()}
          delta={followerDelta}
          icon={Users}
        />
        <KpiTile
          label="Total likes (30d)"
          value={totalLikes.toLocaleString()}
          icon={Heart}
        />
        <KpiTile
          label="Total comments (30d)"
          value={totalComments.toLocaleString()}
          icon={BarChart3}
        />
        <KpiTile
          label="Posts (30d)"
          value={String(data?.topPosts.length ?? 0)}
          icon={BarChart3}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Follower growth">
          <Sparkline data={(data?.followers ?? []).map((p) => p.value)} />
        </ChartCard>
        <ChartCard title="Engagement over time">
          <Sparkline
            data={(data?.engagement ?? []).map((e) => e.likes + e.comments + e.shares)}
          />
        </ChartCard>
      </div>

      <ChartCard title="Best times to post">
        <BestTimesHeatmap data={data?.bestTimes ?? []} />
      </ChartCard>

      {data && data.topPosts.length > 0 ? (
        <ChartCard title="Top posts">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {data.topPosts.map((post) => (
              <a
                key={post.platformPostId}
                href="#"
                onClick={(e) => e.preventDefault()}
                className="group block overflow-hidden rounded-md border border-border bg-muted"
                title={post.caption}
              >
                {post.mediaUrl ? (
                  <img src={post.mediaUrl} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="aspect-square w-full" />
                )}
                <div className="p-2 text-[11px]">
                  <div className="truncate font-medium">{post.caption}</div>
                  <div className="mt-0.5 text-muted-foreground">
                    {post.likes.toLocaleString()} ❤ · {post.comments} 💬
                  </div>
                </div>
              </a>
            ))}
          </div>
        </ChartCard>
      ) : null}

      {data && data.topHashtags.length > 0 ? (
        <ChartCard title="Top hashtags">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5">Hashtag</th>
                <th className="py-1.5">Uses</th>
                <th className="py-1.5">Avg engagement</th>
              </tr>
            </thead>
            <tbody>
              {data.topHashtags.map((h) => (
                <tr key={h.tag} className="border-t border-border/60">
                  <td className="py-1.5">#{h.tag}</td>
                  <td className="py-1.5 tabular-nums">{h.uses}</td>
                  <td className="py-1.5 tabular-nums">{h.averageEngagement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
      ) : null}
        </>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {typeof delta === "number" ? (
        <div className={cn("mt-0.5 text-[11px]", delta >= 0 ? "text-emerald-500" : "text-rose-500")}>
          {delta >= 0 ? "+" : ""}
          {delta.toLocaleString()} vs period start
        </div>
      ) : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return <div className="h-20 text-xs text-muted-foreground">No data.</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-20 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
    </svg>
  );
}

function BestTimesHeatmap({ data }: { data: number[][] }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (data.length === 0) return <div className="text-xs text-muted-foreground">No data.</div>;
  const max = Math.max(...data.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px]">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }).map((_, h) => (
              <th key={h} className="px-0.5 font-normal text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, d) => (
            <tr key={d}>
              <td className="pr-1.5 text-right text-muted-foreground">{days[d]}</td>
              {row.map((v, h) => {
                const intensity = v / max;
                return (
                  <td key={h} className="p-px">
                    <div
                      className="h-4 w-4 rounded-sm"
                      style={{ backgroundColor: `rgba(167, 139, 250, ${0.08 + intensity * 0.85})` }}
                      title={`${days[d]} ${h}:00 — score ${v}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

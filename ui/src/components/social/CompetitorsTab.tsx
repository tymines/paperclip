/**
 * CompetitorsTab — public-profile research + side-by-side comparison.
 *
 * Add a competitor by handle + platform, see their followers, posting
 * cadence, avg engagement, top posts. Comparison panel shows the user's
 * own metrics next to a chosen competitor with simple gap insights:
 * "They post 3.2x/wk, you post 1.1x/wk", "Their avg engagement is 4x
 * yours", "Their top hashtag is #foo (you've never used it)".
 *
 * Source: IG Graph Business Discovery for IG, Reddit public data for
 * Reddit. Data-honest (spec §7): platforms without a keyed path return an
 * explicit keyed-off state with the homework that unlocks them — never
 * shaped mock data.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";
import { socialApi, type CompetitorProfile } from "../../api/social";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyedOffNotice } from "./data-honesty";
import { PLATFORM_META, TYLER_PRIORITY_PLATFORMS } from "./platform-meta";
import { cn } from "../../lib/utils";

interface CompetitorsTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

export function CompetitorsTab({ companyId, accounts: _accounts }: CompetitorsTabProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [query, setQuery] = useState("");
  const [watched, setWatched] = useState<CompetitorProfile[]>([]);

  const searchQuery = useQuery({
    queryKey: ["social", "competitor-search", companyId, platform, query],
    queryFn: () => socialApi.competitorSearch(companyId, platform, query),
    enabled: query.trim().length > 0,
  });

  const addCompetitor = (profile: CompetitorProfile) => {
    setWatched((prev) =>
      prev.find((p) => p.platform === profile.platform && p.handle === profile.handle)
        ? prev
        : [...prev, profile],
    );
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Add competitor */}
      <div className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Add a competitor</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste a public handle (with or without @). We'll fetch their recent posts and engagement
          for a side-by-side compare.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {TYLER_PRIORITY_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_META[p].label}
              </option>
            ))}
          </select>
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="@handle"
              className="pl-7"
            />
          </div>
        </div>
        {query.trim() && searchQuery.data && !searchQuery.data.available ? (
          <div className="mt-3">
            <KeyedOffNotice
              icon={Users}
              featurePitch={`Competitor search will look up public ${PLATFORM_META[platform].label} profiles for a side-by-side compare.`}
              state={searchQuery.data}
              compact
            />
          </div>
        ) : null}
        {query.trim() && searchQuery.data?.available !== false ? (
          <ul className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
            {(searchQuery.data?.available ? searchQuery.data.data : []).map((profile) => {
              const meta = PLATFORM_META[profile.platform];
              const Icon = meta.icon;
              return (
                <li
                  key={`${profile.platform}-${profile.handle}`}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{profile.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      @{profile.handle} · {profile.followerCount.toLocaleString()} followers
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => addCompetitor(profile)}>
                    <Plus className="h-3.5 w-3.5" /> Watch
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Watched competitors */}
      {watched.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
          No competitors yet. Add a handle above to start tracking.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {watched.map((profile) => (
            <CompetitorCard
              key={`${profile.platform}-${profile.handle}`}
              companyId={companyId}
              profile={profile}
              onRemove={() =>
                setWatched((prev) =>
                  prev.filter((p) => !(p.platform === profile.platform && p.handle === profile.handle)),
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitorCard({
  companyId,
  profile,
  onRemove,
}: {
  companyId: string;
  profile: CompetitorProfile;
  onRemove: () => void;
}) {
  const meta = PLATFORM_META[profile.platform];
  const Icon = meta.icon;
  const from = useMemo(() => new Date(Date.now() - 30 * 86_400_000), []);
  const to = useMemo(() => new Date(), []);

  const metricsQuery = useQuery({
    queryKey: ["social", "competitor-metrics", companyId, profile.platform, profile.handle],
    queryFn: () => socialApi.competitorMetrics(companyId, profile.platform, profile.handle, from, to),
  });

  const metricsResult = metricsQuery.data;
  const metrics = metricsResult?.available ? metricsResult.data : undefined;
  const followerSeries = metrics?.byDay.map((d) => d.followerCount) ?? [];
  const followerDelta =
    followerSeries.length > 1 ? (followerSeries.at(-1) ?? 0) - (followerSeries[0] ?? 0) : 0;
  const totalEngagement = (metrics?.byDay ?? []).reduce((s, d) => s + d.totalEngagement, 0);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: meta.color }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{profile.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">@{profile.handle}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="Followers" value={profile.followerCount.toLocaleString()} />
            <Stat label="Posts/wk" value={profile.postingCadencePerWeek.toFixed(1)} />
            <Stat label="Avg engagement" value={profile.averageEngagement.toLocaleString()} />
          </div>
          {metricsResult && !metricsResult.available ? (
            <div className="mt-3">
              <KeyedOffNotice
                icon={Users}
                featurePitch="30-day follower trend, total engagement, and top posts for this profile."
                state={metricsResult}
                compact
              />
            </div>
          ) : (
            <>
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  30-day follower trend ({followerDelta >= 0 ? "+" : ""}
                  {followerDelta.toLocaleString()})
                </div>
                <Sparkline data={followerSeries} />
              </div>
              {(metrics?.topPosts.length ?? 0) > 0 ? (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Top posts (30d)
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    {metrics!.topPosts.slice(0, 3).map((post) => (
                      <div
                        key={post.platformPostId}
                        className={cn("aspect-square overflow-hidden rounded-sm bg-muted")}
                        title={post.caption}
                      >
                        {post.mediaUrl ? (
                          <img src={post.mediaUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 text-[11px] text-muted-foreground">
                Total engagement (30d): {totalEngagement.toLocaleString()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return <div className="h-16 text-xs text-muted-foreground">No data.</div>;
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
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full">
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

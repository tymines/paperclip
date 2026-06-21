/**
 * Reels — library + new-reel surface for the Paperclip Short Film module.
 *
 * Sidebar position: between Image Studio and Library (per spec).
 *
 * Three sub-views: Library (grid of reels), Templates (reusable presets),
 * Series (multi-episode narratives). MVP ships with Library only — the rest
 * are placeholder tabs until Phase 5 of the spec.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Film, RefreshCw, Layers, ListVideo } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useCompany } from "@/context/CompanyContext";
import { reelsApi, REEL_STATUS_LABELS, isReelInProgress, reelProgressPercent, type Reel } from "@/api/reels";
import { NewReelDialog } from "@/components/reels/NewReelDialog";
import { ReelStatusBadge } from "@/components/reels/ReelStatusBadge";

export function Reels() {
  const company = useCompany();
  const queryClient = useQueryClient();
  const [newReelOpen, setNewReelOpen] = useState(false);

  const reelsQuery = useQuery({
    queryKey: ["reels", company.id],
    queryFn: () => reelsApi.list(company.id, { limit: 50 }),
    // Auto-refetch while there are in-progress reels — polling for live status
    refetchInterval: (data) => {
      const reels = data?.reels ?? [];
      return reels.some(isReelInProgress) ? 5_000 : false;
    },
  });

  const reels = reelsQuery.data?.reels ?? [];
  const inProgress = useMemo(() => reels.filter(isReelInProgress), [reels]);
  const complete = useMemo(
    () => reels.filter((r) => r.status === "complete"),
    [reels],
  );
  const failed = useMemo(
    () => reels.filter((r) => r.status === "failed"),
    [reels],
  );

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Film className="h-6 w-6 text-indigo-500" />
            Reels
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-generated short films for your personas — keyframes &rarr; image-to-video &rarr; stitched 9:16 reel ready to post.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["reels", company.id] })}
            data-testid="reels-refresh"
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setNewReelOpen(true)} data-testid="reels-new">
            <Plus className="mr-1.5 h-4 w-4" />
            New reel
          </Button>
        </div>
      </header>

      {inProgress.length > 0 && (
        <section className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
          <h2 className="mb-3 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            In progress ({inProgress.length})
          </h2>
          <div className="space-y-2">
            {inProgress.map((r) => (
              <InProgressRow key={r.id} reel={r} />
            ))}
          </div>
        </section>
      )}

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library" data-testid="reels-tab-library">
            <ListVideo className="mr-1.5 h-4 w-4" />
            Library
            <span className="ml-1.5 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
              {complete.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="reels-tab-templates">
            <Layers className="mr-1.5 h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="series" data-testid="reels-tab-series">
            <Film className="mr-1.5 h-4 w-4" />
            Series
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          {reelsQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[9/16] animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : complete.length === 0 ? (
            <EmptyState
              icon={Film}
              title="No reels yet"
              description="Pick a persona, give it a one-line idea, hit generate. Your first reel takes ~5 min."
              action={
                <Button onClick={() => setNewReelOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New reel
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {complete.map((reel) => (
                <ReelCard key={reel.id} reel={reel} />
              ))}
            </div>
          )}

          {failed.length > 0 && (
            <details className="mt-8 rounded border border-red-200 p-3 text-sm dark:border-red-900">
              <summary className="cursor-pointer text-red-700 dark:text-red-300">
                {failed.length} failed
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {failed.map((r) => (
                  <li key={r.id}>
                    <Link to={`/reels/${r.id}`} className="underline">
                      {r.title ?? r.prompt.slice(0, 60)}
                    </Link>
                    {r.errorMessage && (
                      <span className="ml-2 text-red-600">— {r.errorMessage}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <EmptyState
            icon={Layers}
            title="Templates coming soon"
            description="Saved style presets (Day in the Life, Get Ready With Me, How-To, etc) that pre-fill the new-reel form."
          />
        </TabsContent>

        <TabsContent value="series" className="mt-4">
          <EmptyState
            icon={Film}
            title="Series coming soon"
            description="Multi-episode arcs with character continuity tracking — 'Day 1 of', 'Day 2 of' style."
          />
        </TabsContent>
      </Tabs>

      <NewReelDialog
        open={newReelOpen}
        onOpenChange={setNewReelOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["reels", company.id] })}
      />
    </div>
  );
}

function ReelCard({ reel }: { reel: Reel }) {
  return (
    <Link to={`/reels/${reel.id}`} className="group block">
      <Card className="overflow-hidden transition-shadow hover:shadow-md">
        <div className="relative aspect-[9/16] bg-muted">
          {reel.finalVideoUrl ? (
            <video
              src={reel.finalVideoUrl}
              poster={reel.thumbnailUrl ?? undefined}
              className="h-full w-full object-cover"
              muted
              playsInline
              onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
              onMouseLeave={(e) => {
                const v = e.currentTarget as HTMLVideoElement;
                v.pause();
                v.currentTime = 0;
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Film className="h-12 w-12 opacity-30" />
            </div>
          )}
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
            {reel.finalDurationSeconds ? `${parseFloat(reel.finalDurationSeconds).toFixed(0)}s` : `${reel.durationSeconds}s`}
          </div>
          {reel.postedToPlatforms?.length ? (
            <div className="absolute left-2 top-2 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              Posted
            </div>
          ) : null}
        </div>
        <CardContent className="p-3">
          <div className="truncate text-sm font-medium">
            {reel.directorTitle ?? reel.title ?? reel.prompt.slice(0, 40)}
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {reel.prompt}
          </div>
          {reel.totalCostUsd && (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              ${parseFloat(reel.totalCostUsd).toFixed(2)}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function InProgressRow({ reel }: { reel: Reel }) {
  const pct = reelProgressPercent(reel);
  return (
    <Link
      to={`/reels/${reel.id}`}
      className="block rounded border border-indigo-200 bg-white p-3 transition-colors hover:bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950 dark:hover:bg-indigo-900"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {reel.title ?? reel.prompt.slice(0, 60)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {REEL_STATUS_LABELS[reel.status]}
          </div>
        </div>
        <ReelStatusBadge status={reel.status} />
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-indigo-100 dark:bg-indigo-900">
        <div
          className="h-full bg-indigo-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Link>
  );
}

/**
 * ReelDetail — single reel view.
 *
 * Top: 9:16 preview player + post button.
 * Middle: live progress bar if in flight.
 * Bottom: scene-by-scene table with keyframe + clip preview, regenerate per-scene.
 */
import { useMemo } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/context/CompanyContext";
import {
  reelsApi,
  REEL_STATUS_LABELS,
  STYLE_PRESET_LABELS,
  isReelInProgress,
  reelProgressPercent,
  type ReelScene,
} from "@/api/reels";
import { ReelStatusBadge } from "@/components/reels/ReelStatusBadge";

export function ReelDetail() {
  const company = useCompany();
  const queryClient = useQueryClient();
  const { reelId } = useParams<{ reelId: string }>();

  const reelQuery = useQuery({
    queryKey: ["reels", company.id, reelId],
    queryFn: () => reelsApi.get(company.id, reelId!),
    enabled: !!reelId,
    refetchInterval: (data) =>
      data && isReelInProgress(data.reel) ? 4_000 : false,
  });

  const regenMut = useMutation({
    mutationFn: (sceneIndex: number) =>
      reelsApi.regenerateScene(company.id, reelId!, sceneIndex),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["reels", company.id, reelId] }),
  });

  if (!reelId) return null;
  if (reelQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-4 aspect-[9/16] max-w-md animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!reelQuery.data) {
    return <div className="p-6">Reel not found.</div>;
  }

  const { reel, scenes } = reelQuery.data;
  const scenesByIdx = useMemo(
    () => [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex),
    [scenes],
  );
  const inProgress = isReelInProgress(reel);
  const progressPct = reelProgressPercent(reel);

  return (
    <div className="p-6">
      <Link to="/reels" className="mb-3 inline-flex items-center text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        Back to Reels
      </Link>

      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">
            {reel.directorTitle ?? reel.title ?? reel.prompt.slice(0, 80)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{reel.prompt}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <ReelStatusBadge status={reel.status} />
            {reel.stylePreset && (
              <Badge variant="outline">{STYLE_PRESET_LABELS[reel.stylePreset]}</Badge>
            )}
            <Badge variant="outline">{reel.aspectRatio}</Badge>
            <Badge variant="outline">
              {reel.finalDurationSeconds
                ? `${parseFloat(reel.finalDurationSeconds).toFixed(0)}s`
                : `${reel.durationSeconds}s target`}
            </Badge>
            {reel.musicMood && <Badge variant="outline">{reel.musicMood}</Badge>}
            {reel.totalCostUsd && (
              <Badge variant="outline">${parseFloat(reel.totalCostUsd).toFixed(2)}</Badge>
            )}
          </div>
        </div>

        {reel.status === "complete" && reel.finalVideoUrl && (
          <Button data-testid="reel-post-button">
            <Send className="mr-1.5 h-4 w-4" />
            Post to platforms
          </Button>
        )}
      </header>

      {inProgress && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-indigo-900 dark:text-indigo-200">
              {REEL_STATUS_LABELS[reel.status]}
            </span>
            <span className="text-xs text-indigo-700 dark:text-indigo-300">{progressPct}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-indigo-100 dark:bg-indigo-900">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {reel.errorMessage && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {reel.errorMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Preview */}
        <div className="lg:col-span-1">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Preview</h2>
          <div className="aspect-[9/16] overflow-hidden rounded-lg border bg-black">
            {reel.finalVideoUrl ? (
              <video
                src={reel.finalVideoUrl}
                poster={reel.thumbnailUrl ?? undefined}
                controls
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs">{REEL_STATUS_LABELS[reel.status]}</span>
              </div>
            )}
          </div>
        </div>

        {/* Scenes */}
        <div className="lg:col-span-2">
          <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-muted-foreground">
            <span>Scenes ({scenesByIdx.length})</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["reels", company.id, reelId] })
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </h2>
          <div className="space-y-2">
            {scenesByIdx.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Scene director hasn't run yet — refresh in a few seconds.
                </CardContent>
              </Card>
            ) : (
              scenesByIdx.map((scene) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  onRegenerate={() => regenMut.mutate(scene.sceneIndex)}
                  regenerating={regenMut.isPending && regenMut.variables === scene.sceneIndex}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneRow({
  scene,
  onRegenerate,
  regenerating,
}: {
  scene: ReelScene;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Keyframe thumbnail */}
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-muted">
            {scene.keyframeImageUrl ? (
              <img
                src={scene.keyframeImageUrl}
                alt={`Scene ${scene.sceneIndex} keyframe`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                #{scene.sceneIndex}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Scene {scene.sceneIndex}
              </span>
              <SceneStatusBadge status={scene.status} />
            </div>
            <p className="mt-1 line-clamp-2 text-sm">{scene.description}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {scene.cameraFraming && <Badge variant="outline" className="text-[10px]">{scene.cameraFraming}</Badge>}
              {scene.emotion && <Badge variant="outline" className="text-[10px]">{scene.emotion}</Badge>}
              <span>{parseFloat(scene.sceneDurationSeconds).toFixed(1)}s</span>
            </div>
            {scene.errorMessage && (
              <p className="mt-1 text-xs text-red-600">{scene.errorMessage}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            {scene.videoClipUrl && (
              <a
                href={scene.videoClipUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:underline"
              >
                <ExternalLink className="inline h-3 w-3" />
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              disabled={regenerating}
              title="Regenerate this scene"
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SceneStatusBadge({ status }: { status: ReelScene["status"] }) {
  const map: Record<ReelScene["status"], { label: string; color: string }> = {
    pending: { label: "Pending", color: "bg-gray-200 text-gray-700" },
    keyframe_submitted: { label: "Keyframe…", color: "bg-amber-200 text-amber-800" },
    keyframe_ready: { label: "Frame ready", color: "bg-blue-200 text-blue-800" },
    video_submitted: { label: "Animating…", color: "bg-indigo-200 text-indigo-800" },
    video_ready: { label: "✓ Ready", color: "bg-emerald-200 text-emerald-800" },
    failed: { label: "Failed", color: "bg-red-200 text-red-800" },
  };
  const { label, color } = map[status];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

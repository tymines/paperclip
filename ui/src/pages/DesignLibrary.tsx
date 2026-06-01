import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Heart,
  Image as ImageIcon,
  Loader2,
  Star,
  Upload,
  X,
  Film,
  CheckSquare,
  Square,
  DownloadCloud,
} from "lucide-react";
import { useNavigate } from "@/lib/router";
import { designAssetsApi, type DesignAsset } from "../api/design";
import { useCompany } from "../context/CompanyContext";

const PAGE_SIZE = 50;

/** Full-screen preview overlay */
function FullPreview({
  asset,
  onClose,
}: {
  asset: DesignAsset;
  onClose: () => void;
}) {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();

  const toggleFav = useMutation({
    mutationFn: (fav: boolean) =>
      designAssetsApi.toggleFavorite(selectedCompanyId!, asset.id, fav),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-assets"] });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* toolbar */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{asset.skill ?? "unknown"}</span>
            {asset.persona ? (
              <span className="rounded bg-muted px-1.5 py-0.5">{asset.persona}</span>
            ) : null}
            <span>{asset.agentId}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleFav.mutate(!asset.favorited)}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={asset.favorited ? "Unfavorite" : "Favorite"}
            >
              {asset.favorited ? (
                <Heart className="h-4 w-4 fill-red-500 text-red-500" />
              ) : (
                <Heart className="h-4 w-4" />
              )}
            </button>
            <a
              href={asset.url}
              download
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* preview */}
        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          {asset.kind === "video" ? (
            <video
              src={asset.url}
              controls
              autoPlay
              muted
              loop
              className="mx-auto max-h-[70vh] rounded object-contain"
            />
          ) : (
            <img
              src={asset.url}
              alt={asset.skill ?? "design asset"}
              className="mx-auto max-h-[70vh] rounded object-contain"
            />
          )}
        </div>

        {/* metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <div>
            <span className="font-medium">Skill:</span> {asset.skill ?? "—"}
          </div>
          <div>
            <span className="font-medium">Agent:</span> {asset.agentId ?? "—"}
          </div>
          <div>
            <span className="font-medium">Persona:</span> {asset.persona ?? "—"}
          </div>
          <div>
            <span className="font-medium">Created:</span>{" "}
            {new Date(asset.createdAt).toLocaleDateString()}
          </div>
          {asset.width && asset.height ? (
            <div>
              <span className="font-medium">Size:</span> {asset.width}×{asset.height}
            </div>
          ) : null}
          {asset.durationMs ? (
            <div>
              <span className="font-medium">Duration:</span>{" "}
              {(asset.durationMs / 1000).toFixed(1)}s
            </div>
          ) : null}
          {asset.prompt ? (
            <div className="col-span-2">
              <span className="font-medium">Prompt:</span>{" "}
              {asset.prompt.length > 200
                ? asset.prompt.slice(0, 200) + "…"
                : asset.prompt}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Single asset card in the grid */
function AssetCard({
  asset,
  selected,
  onToggleSelect,
  onClick,
}: {
  asset: DesignAsset;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();

  const toggleFav = useMutation({
    mutationFn: (fav: boolean) =>
      designAssetsApi.toggleFavorite(selectedCompanyId!, asset.id, fav),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-assets"] });
    },
  });

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/40">
      {/* selection checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className="absolute left-2 top-2 z-10 rounded bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      >
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* thumbnail */}
      <button
        type="button"
        onClick={onClick}
        className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/30"
      >
        {asset.kind === "video" ? (
          <div className="relative flex h-full w-full items-center justify-center">
            <video
              src={asset.url}
              muted
              preload="metadata"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-black/50 p-2">
                <Film className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <img
            src={asset.url}
            alt={asset.skill ?? "asset"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </button>

      {/* footer */}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          <span className="font-mono">{asset.skill ?? "?"}</span>
          {asset.persona ? (
            <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px]">
              {asset.persona}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFav.mutate(!asset.favorited);
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={asset.favorited ? "Unfavorite" : "Favorite"}
        >
          {asset.favorited ? (
            <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
          ) : (
            <Star className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export default function DesignLibrary() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId!;
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Filters
  const [skillFilter, setSkillFilter] = useState("");
  const [dateRange, setDateRange] = useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [personaFilter, setPersonaFilter] = useState("");
  const [page, setPage] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewAsset, setPreviewAsset] = useState<DesignAsset | null>(null);

  // Fetch filter metadata
  const skillsQ = useQuery({
    queryKey: ["design-assets", "skills", companyId],
    queryFn: () => designAssetsApi.skills(companyId),
    enabled: !!companyId,
  });

  const personasQ = useQuery({
    queryKey: ["design-assets", "personas", companyId],
    queryFn: () => designAssetsApi.personas(companyId),
    enabled: !!companyId,
  });

  // Fetch assets
  const assetsQ = useQuery({
    queryKey: [
      "design-assets",
      "list",
      companyId,
      page,
      skillFilter,
      dateRange,
      favoritesOnly,
      personaFilter,
    ],
    queryFn: () =>
      designAssetsApi.list(companyId, {
        page,
        limit: PAGE_SIZE,
        skill: skillFilter || undefined,
        dateRange: dateRange !== "all" ? dateRange : undefined,
        favorited: favoritesOnly ? "true" : undefined,
        persona: personaFilter || undefined,
      }),
    enabled: !!companyId,
  });

  const assets = assetsQ.data?.assets ?? [];
  const pagination = assetsQ.data?.pagination;

  // Bulk export zip
  const [downloading, setDownloading] = useState(false);

  const handleDownloadZip = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const resp = await fetch(
        `/api/companies/${companyId}/design/assets/export-zip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        },
      );
      if (!resp.ok) throw new Error("download failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `design-assets-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("zip download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [companyId, selectedIds]);

  const handleScheduleSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    // Navigate to social's bulk-upload tab and pass selected assets
    navigate(`/social?tab=bulk-upload&designAssets=${encodeURIComponent(Array.from(selectedIds).join(","))}`);
  }, [navigate, selectedIds]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  }, [assets, selectedIds]);

  // Reset selection on page change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, skillFilter, dateRange, favoritesOnly, personaFilter]);

  const skills = skillsQ.data?.skills ?? [];
  const personas = personasQ.data?.personas ?? [];

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Design Library</h1>
          <p className="text-sm text-muted-foreground">
            {pagination
              ? `${pagination.total} asset${pagination.total === 1 ? "" : "s"}`
              : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk actions */}
          {selectedIds.size > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={downloading}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3 w-3" />
                )}
                Download zip
              </button>
              <button
                type="button"
                onClick={handleScheduleSelected}
                className="flex items-center gap-1 rounded bg-foreground px-2 py-1 text-xs text-background hover:opacity-90"
              >
                <Upload className="h-3 w-3" />
                Schedule selected
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => navigate("/design")}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            New design
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-border bg-background px-2 py-1 text-xs"
          value={skillFilter}
          onChange={(e) => {
            setSkillFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All skills</option>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className="rounded border border-border bg-background px-2 py-1 text-xs"
          value={dateRange}
          onChange={(e) => {
            setDateRange(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>

        <select
          className="rounded border border-border bg-background px-2 py-1 text-xs"
          value={personaFilter}
          onChange={(e) => {
            setPersonaFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All personas</option>
          {personas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => {
              setFavoritesOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded"
          />
          Favorites only
        </label>

        {selectedIds.size > 0 ? (
          <label className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-primary hover:underline"
            >
              {selectedIds.size === assets.length ? "Deselect all" : "Select all"}
            </button>
          </label>
        ) : null}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {assetsQ.isLoading ? (
          <div className="grid h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          <div className="grid h-48 place-items-center">
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="h-10 w-10" />
              <p>No design assets yet.</p>
              <p className="text-xs">
                Run a design skill to generate images and videos.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(asset.id)) next.delete(asset.id);
                      else next.add(asset.id);
                      return next;
                    });
                  }}
                  onClick={() => setPreviewAsset(asset)}
                />
              ))}
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {page} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Full-screen preview modal */}
      {previewAsset ? (
        <FullPreview
          asset={previewAsset}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}
    </div>
  );
}

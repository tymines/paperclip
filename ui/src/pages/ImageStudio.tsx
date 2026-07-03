import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type LoraTrainingJob,
  type PersonaGeneration,
  type GenerationSource,
  type GenerationJob,
} from "../api/imageStudio";
import { useCompany } from "../context/CompanyContext";
import { useSearchParams } from "@/lib/router";
import { relativeTime } from "../lib/utils";
import {
  Plus,
  Sparkles,
  Wand2,
  ImageIcon,
  Video,
  Loader2,
  CheckCircle2,
  Cloud,
  Filter,
  LayoutGrid,
  List as ListIcon,
  Play,
  ChevronDown,
  ChevronUp,
  Settings as SettingsIcon,
  User,
  BookOpen,
  Sliders,
  Server,
  Trash2,
  Star,
  Tag as TagIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PersonaWorkbench,
  GenderFilter,
  personaRating,
} from "@/components/image-studio/PersonaWorkbench";
import { TrainPersonaModal } from "@/components/image-studio/TrainPersonaModal";
import { NewPersonaWizard } from "@/components/personas/NewPersonaWizard";
import { findModel, DEFAULT_MODEL_ID } from "@/components/image-studio/models";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to AI Influencer Studio so the redesign is self-contained  */
/* and matches the Home / War Room / Fleet builds without mutating the global */
/* theme used by other pages.                                                 */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 20,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

const innerCard: CSSProperties = {
  background: DS.surface3,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
};

const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[13px] font-semibold uppercase tracking-[0.12em]"
      style={{ color: DS.textMuted }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Persona status helpers (derived from REAL provider + training-job data)    */
/* -------------------------------------------------------------------------- */
type PersonaStatus = {
  label: string;
  color: string;
  /** 0–100 when training, else null */
  progress: number | null;
  ready: boolean;
};

function personaStatus(
  persona: ImageProvider,
  job: LoraTrainingJob | undefined,
): PersonaStatus {
  // Training-job status takes precedence (it's the live signal).
  if (job) {
    switch (job.status) {
      case "ready":
        return { label: "Ready", color: DS.success, progress: null, ready: true };
      case "training":
        return {
          label: `Training ${job.progress}%`,
          color: DS.warning,
          progress: job.progress,
          ready: false,
        };
      case "downloading":
        return { label: "Installing", color: DS.analytics, progress: job.progress, ready: false };
      case "failed":
        return { label: "Failed", color: DS.critical, progress: null, ready: false };
      default:
        return { label: "Queued", color: DS.textFaint, progress: null, ready: false };
    }
  }
  if (persona.status === "ready")
    return { label: "Ready", color: DS.success, progress: null, ready: true };
  if (persona.status === "training")
    return { label: "Training", color: DS.warning, progress: null, ready: false };
  if (persona.status === "needs_photos")
    return { label: "Needs photos", color: DS.warning, progress: null, ready: false };
  return { label: "Planned", color: DS.textFaint, progress: null, ready: false };
}

/** Real content-rating tag, derived from persona attributes (sfw / explicit). */
function RatingTag({ persona }: { persona: ImageProvider }) {
  const rating = personaRating(persona);
  const explicit = rating === "explicit";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: explicit ? DS.critical : DS.success,
        background: explicit ? "rgba(255,91,91,0.10)" : "rgba(47,227,138,0.10)",
        border: `1px solid ${explicit ? "rgba(255,91,91,0.25)" : "rgba(47,227,138,0.25)"}`,
      }}
    >
      <TagIcon className="h-2.5 w-2.5" />
      {explicit ? "18+" : "SFW"}
    </span>
  );
}

function personaInitial(p: ImageProvider): string {
  return (p.name ?? "?").trim().charAt(0).toUpperCase();
}

function PersonaAvatar({
  persona,
  size = 40,
}: {
  persona: ImageProvider;
  size?: number;
}) {
  const src = persona.avatarPath ? uploadUrl(persona.avatarPath) : null;
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold"
      style={{
        height: size,
        width: size,
        background: DS.surface,
        color: DS.text,
        border: `1px solid ${DS.border2}`,
        fontSize: size * 0.4,
      }}
    >
      {src ? (
        <img src={src} alt={persona.name} className="h-full w-full object-cover" />
      ) : (
        personaInitial(persona)
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Trained Personas row                                                       */
/* -------------------------------------------------------------------------- */
function NewPersonaCard({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-[150px] shrink-0 flex-col items-center justify-center gap-2 rounded-[16px] transition-colors hover:brightness-110 disabled:opacity-60 disabled:cursor-wait"
      style={{ border: `1px dashed ${DS.border3}`, color: DS.textFaint, minHeight: 188 }}
      data-testid="new-persona"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}` }}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: DS.primary }} />
        ) : (
          <Plus className="h-5 w-5" style={{ color: DS.primary }} />
        )}
      </span>
      <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
        {loading ? "Creating…" : "New Persona"}
      </span>
      <span className="text-[11px]" style={{ color: DS.textFaint }}>
        {loading ? "Setting up character" : "Create new character"}
      </span>
    </button>
  );
}

function PersonaRowCard({
  persona,
  status,
  selected,
  onOpen,
  onTrain,
}: {
  persona: ImageProvider;
  status: PersonaStatus;
  selected: boolean;
  onOpen: () => void;
  onTrain: () => void;
}) {
  const avatar = persona.avatarPath ? uploadUrl(persona.avatarPath) : null;
  return (
    <div
      className="relative flex w-[170px] shrink-0 flex-col overflow-hidden rounded-[16px] transition-all"
      style={{
        background: DS.surface3,
        border: `1px solid ${selected ? DS.primary : DS.border}`,
        boxShadow: selected ? `0 0 0 1px ${DS.primary}, 0 8px 24px -16px rgba(59,130,255,0.6)` : undefined,
      }}
      data-testid={`persona-card-${persona.id}`}
    >
      {/* Portrait */}
      <div className="relative h-[108px] w-full overflow-hidden" style={{ background: DS.surface }}>
        {avatar ? (
          <img src={avatar} alt={persona.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ color: DS.textFaint }}>
            {personaInitial(persona)}
          </div>
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-12"
          style={{ background: "linear-gradient(180deg, transparent, rgba(6,9,15,0.85))" }}
        />
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[13px] font-semibold" style={{ color: DS.text }}>
            {persona.name}
          </span>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: status.color }}
            title={status.label}
          />
        </div>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: DS.textFaint }}>
          <Sparkles className="h-2.5 w-2.5" />
          Flux + LoRA
        </span>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-medium" style={{ color: status.color }}>
            {status.label}
          </span>
          <RatingTag persona={persona} />
        </div>

        {status.progress != null ? (
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: DS.surface }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${status.progress}%`, background: status.color }}
            />
          </div>
        ) : status.ready ? (
          <button
            type="button"
            onClick={onOpen}
            className="mt-0.5 w-full rounded-lg py-1.5 text-[11px] font-semibold transition-colors"
            style={
              selected
                ? { background: DS.primary, color: "#04122E" }
                : { background: DS.surface, color: DS.text, border: `1px solid ${DS.border2}` }
            }
            data-testid={`open-studio-${persona.id}`}
          >
            Open Studio
          </button>
        ) : (
          <button
            type="button"
            onClick={onTrain}
            className="mt-0.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors"
            style={{ background: DS.surface, color: DS.text, border: `1px solid ${DS.border2}` }}
            data-testid={`train-${persona.id}`}
          >
            <Cloud className="h-3 w-3" />
            Train
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Generate Content panel (Image = REAL · Video = NEEDS-ENDPOINT, flagged)    */
/* -------------------------------------------------------------------------- */
const DIMENSIONS = [
  { label: "896 × 1152 — Portrait (3:4)", ar: "3:4" },
  { label: "1024 × 1024 — Square (1:1)", ar: "1:1" },
  { label: "1152 × 896 — Landscape (4:3)", ar: "4:3" },
  { label: "1080 × 1920 — Vertical (9:16)", ar: "9:16" },
  { label: "1920 × 1080 — Wide (16:9)", ar: "16:9" },
] as const;

const COUNTS = [1, 2, 4, 8] as const;

/** Compact, DS-styled batch progress. Polls the SAME batch endpoint the legacy
 *  page used, and streams finished images into the gallery as they land. */
function BatchProgress({
  personaId,
  batchId,
  onClear,
}: {
  personaId: string;
  batchId: string;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const lastSucceeded = useRef(-1);
  const batchQ = useQuery({
    queryKey: ["image-studio", "batch", personaId, batchId],
    queryFn: () => imageStudioApi.getBatch(personaId, batchId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.some((j) => j.status !== "succeeded" && j.status !== "failed");
      return active || jobs.length === 0 ? 5_000 : false;
    },
  });
  const jobs: GenerationJob[] = batchQ.data?.jobs ?? [];
  const total = jobs.length;
  const succeeded = jobs.filter((j) => j.status === "succeeded").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const inFlight = total - succeeded - failed;
  const done = total > 0 && inFlight === 0;

  useEffect(() => {
    if (succeeded !== lastSucceeded.current) {
      lastSucceeded.current = succeeded;
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", personaId] });
    }
  }, [succeeded, personaId, queryClient]);

  return (
    <div
      className="mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2"
      style={{ background: "rgba(59,130,255,0.08)", border: `1px solid rgba(59,130,255,0.25)` }}
      data-testid="batch-progress"
    >
      <div className="flex items-center gap-2 text-[12px]">
        {done ? (
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: DS.success }} />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: DS.primary }} />
        )}
        <span className="font-medium" style={{ color: DS.text }}>
          {done ? "Generated" : "Generating"} {succeeded}/{total || "…"}
        </span>
        {failed > 0 && (
          <span style={{ color: DS.critical }}>· {failed} failed</span>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="text-[11px] font-medium"
        style={{ color: DS.textMuted }}
      >
        {done ? "Dismiss" : "Hide"}
      </button>
    </div>
  );
}

function GenerateContentPanel({ persona, advancedOpen: externalAdvancedOpen, onAdvancedChange }: { persona: ImageProvider; advancedOpen?: boolean; onAdvancedChange?: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [aspect, setAspect] = useState<string>("3:4");
  const [count, setCount] = useState<number>(2);
  const [localAdvancedOpen, setLocalAdvancedOpen] = useState(false);
  const advancedOpen = externalAdvancedOpen ?? localAdvancedOpen;
  const [batchId, setBatchId] = useState<string | null>(null);
  const [recentBatchIds, setRecentBatchIds] = useState<string[]>([]);
  const [gender, setGender] = useState<"female" | "male">("female");
  const rating = personaRating(persona);

  const generateMut = useMutation({
    mutationFn: () => {
      const model = findModel(DEFAULT_MODEL_ID);
      return imageStudioApi.generateBatch(persona.id, {
        prompt_text: prompt.trim(),
        lora_scale: loraStrength,
        aspect_ratio: aspect,
        count,
        content_rating: rating,
        provider_host: model.provider,
        model: model.nativeModel,
      });
    },
    onSuccess: (res) => {
      setBatchId(res.batch_id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
    },
  });

  const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em]";

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>Generate Content</SectionLabel>

      {/* Image / Video toggle */}
      <div
        className="grid grid-cols-2 gap-1 rounded-xl p-1"
        style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
        data-testid="mode-toggle"
      >
        {(["image", "video"] as const).map((m) => {
          const active = mode === m;
          const Icon = m === "image" ? ImageIcon : Video;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              data-testid={`mode-${m}`}
              className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-semibold capitalize transition-colors"
              style={
                active
                  ? { background: DS.primary, color: "#04122E" }
                  : { color: DS.textMuted }
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {m}
            </button>
          );
        })}
      </div>

      {mode === "video" ? (
        <div
          className="flex items-center gap-3 rounded-xl p-4"
          style={{ background: DS.surface, border: `1px dashed ${DS.border3}` }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: DS.warning, background: "rgba(244,185,64,0.10)", border: `1px solid rgba(244,185,64,0.3)` }}
          >
            <Server className="h-3 w-3" />
            Coming soon
          </span>
          <span className="text-[12px]" style={{ color: DS.textFaint }}>
            Video generation endpoint not yet wired — the full panel will appear when the backend ships.
          </span>
        </div>
      ) : (
        <>
          {/* Prompt */}
          <div>
            <label className={labelCls} style={{ color: DS.textFaint }}>
              Prompt
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 1000))}
                rows={4}
                placeholder="Describe the scene, pose, lighting, mood, outfit…"
                className="w-full resize-none rounded-lg p-2.5 pr-2.5 text-[13px] focus:outline-none"
                style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.text }}
                data-testid="prompt-input"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <button
                  type="button"
                  disabled
                  title="Prompt enhancement — coming soon"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium opacity-60"
                  style={{ color: DS.textMuted, border: `1px solid ${DS.border}`, cursor: "not-allowed" }}
                >
                  <Wand2 className="h-3 w-3" />
                  Enhance prompt
                </button>
                <span className="text-[10px]" style={{ color: DS.textFaint, fontFamily: FONT_MONO }}>
                  {prompt.length} / 1000
                </span>
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="flex flex-col gap-4">
            <SectionLabel>Settings</SectionLabel>

            {/* LoRA strength */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px]" style={{ color: DS.textMuted }}>
                  LoRA Strength
                </span>
                <span className="text-[12px] font-semibold" style={{ color: DS.text, fontFamily: FONT_MONO }}>
                  {loraStrength.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.2}
                step={0.05}
                value={loraStrength}
                onChange={(e) => setLoraStrength(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: DS.primary }}
                data-testid="lora-strength"
              />
            </div>

            {/* Dimensions */}
            <div>
              <span className="mb-1.5 block text-[12px]" style={{ color: DS.textMuted }}>
                Dimensions
              </span>
              <div className="relative">
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value)}
                  className="w-full appearance-none rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                  style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.text }}
                  data-testid="dimensions"
                >
                  {DIMENSIONS.map((d) => (
                    <option key={d.ar} value={d.ar} style={{ background: DS.surface2 }}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: DS.textFaint }}
                />
              </div>
            </div>

            {/* Count */}
            <div>
              <span className="mb-1.5 block text-[12px]" style={{ color: DS.textMuted }}>
                Count
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {COUNTS.map((c) => {
                  const active = count === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCount(c)}
                      data-testid={`count-${c}`}
                      className="rounded-lg py-1.5 text-[13px] font-semibold transition-colors"
                      style={
                        active
                          ? { background: DS.primary, color: "#04122E" }
                          : { background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }
                      }
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Gender filter */}
            <div>
              <span className="mb-1.5 block text-[12px]" style={{ color: DS.textMuted }}>
                Gender
              </span>
              <GenderFilter value={gender} onChange={setGender} />
            </div>

            {/* Advanced studio — preserves the full existing workbench
                (structured controls, PhotoShoot, Undresser, template Library). */}
            <button
              type="button"
              onClick={() => { const next = !advancedOpen; if (onAdvancedChange) onAdvancedChange(next); else setLocalAdvancedOpen(next); }}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-medium transition-colors"
              style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.textMuted }}
              data-testid="advanced-toggle"
            >
              <span className="flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5" />
                Advanced studio — structured controls, PhotoShoot, templates
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
            </button>
          </div>

          {/* Generate */}
          <button
            type="button"
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending || !prompt.trim()}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: DS.primary, color: "#04122E" }}
            data-testid="generate-submit"
          >
            {generateMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate
          </button>
          {generateMut.isError && (
            <div className="flex items-center gap-2">
              <p className="text-[12px]" style={{ color: DS.critical }}>
                {(generateMut.error as Error)?.message ?? "Failed to start generation."}
              </p>
              <button
                type="button"
                onClick={() => generateMut.mutate()}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                style={{ color: DS.primary, border: `1px solid ${DS.primary}` }}
              >
                Retry
              </button>
            </div>
          )}

          {batchId && (
            <BatchProgress
              personaId={persona.id}
              batchId={batchId}
              onClear={() => {
                setRecentBatchIds((prev) => [batchId, ...prev.filter((id) => id !== batchId)].slice(0, 5));
                setBatchId(null);
              }}
            />
          )}

          {recentBatchIds.length > 0 && !batchId && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: DS.textFaint }}>
              <span className="mr-1">Recent:</span>
              {recentBatchIds.map((bid) => (
                <button
                  key={bid}
                  type="button"
                  onClick={() => setBatchId(bid)}
                  className="rounded px-2 py-0.5 font-medium"
                  style={{ color: DS.primary, border: `1px solid ${DS.border}` }}
                >
                  {bid.slice(0, 8)}
                </button>
              ))}
            </div>
          )}

          {advancedOpen && (
            <div
              className="rounded-xl"
              style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
              data-testid="advanced-workbench"
            >
              <PersonaWorkbench persona={persona} onBatchStarted={(id) => setBatchId(id)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Content Gallery (wired to the EXISTING per-persona generations endpoint)   */
/* -------------------------------------------------------------------------- */
type GalleryFilter = "all" | "test" | "production";

function isVideo(g: PersonaGeneration): boolean {
  const meta = g.generationMetadata as Record<string, unknown> | null;
  const kind = meta?.["kind"] ?? meta?.["type"] ?? meta?.["media_type"];
  if (typeof kind === "string" && /video/i.test(kind)) return true;
  return /\.(mp4|webm|mov)$/i.test(g.imagePath ?? "");
}

function ContentGallery({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [limit, setLimit] = useState(40);
  const [selected, setSelected] = useState<PersonaGeneration | null>(null);

  const genQ = useQuery({
    queryKey: ["image-studio", "generations", persona.id],
    queryFn: () => imageStudioApi.listGenerations(persona.id, { limit: 120 }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => imageStudioApi.deleteGeneration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
      setSelected(null);
    },
  });

  const generations = genQ.data?.generations ?? [];
  const counts = useMemo(() => {
    let test = 0;
    let prod = 0;
    for (const g of generations) {
      if (g.source === "production") prod++;
      else test++;
    }
    return { all: generations.length, test, production: prod };
  }, [generations]);

  const visible = useMemo(() => {
    const rows =
      filter === "all" ? generations : generations.filter((g) => g.source === filter);
    const sorted = [...rows].sort((a, b) => {
      const delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return newestFirst ? delta : -delta;
    });
    return sorted.slice(0, limit);
  }, [generations, filter, newestFirst, limit]);

  const total = filter === "all" ? counts.all : counts[filter];

  const chip = (value: GalleryFilter, label: string, n: number) => {
    const active = filter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setFilter(value)}
        data-testid={`filter-${value}`}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
        style={
          active
            ? { background: DS.primary, color: "#04122E" }
            : { background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }
        }
      >
        {label}
        <span
          className="rounded px-1 text-[10px]"
          style={{
            background: active ? "rgba(4,18,46,0.15)" : DS.surface3,
            color: active ? "#04122E" : DS.textFaint,
            fontFamily: FONT_MONO,
          }}
        >
          {n}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Content Gallery</SectionLabel>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setNewestFirst((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]"
            style={{ background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }}
          >
            {newestFirst ? "Newest" : "Oldest"}
            <ChevronDown className="h-3 w-3" />
          </button>
          <div className="flex overflow-hidden rounded-lg" style={{ border: `1px solid ${DS.border}` }}>
            {(["grid", "list"] as const).map((v) => {
              const active = view === v;
              const Icon = v === "grid" ? LayoutGrid : ListIcon;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className="px-2 py-1.5"
                  style={{ background: active ? DS.primary : DS.surface, color: active ? "#04122E" : DS.textMuted }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mb-3 flex items-center gap-1.5">
        {chip("all", "All", counts.all)}
        {chip("test", "Test", counts.test)}
        {chip("production", "Production", counts.production)}
      </div>

      {genQ.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-[13px]" style={{ color: DS.textMuted }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading gallery…
        </div>
      ) : visible.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl py-16 text-center"
          style={{ border: `1px dashed ${DS.border3}` }}
        >
          <ImageIcon className="h-7 w-7" style={{ color: DS.textFaint }} />
          <p className="text-[13px]" style={{ color: DS.textMuted }}>
            No generations yet
          </p>
          <p className="text-[11px]" style={{ color: DS.textFaint }}>
            Hit Generate to populate this persona's gallery.
          </p>
        </div>
      ) : (
        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "flex flex-col gap-2",
          )}
        >
          {visible.map((g) => {
            const video = isVideo(g);
            const prod = g.source === "production";
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelected(g)}
                className="group relative overflow-hidden rounded-[14px]"
                style={{
                  border: `1px solid ${DS.border}`,
                  background: DS.surface,
                  aspectRatio: view === "grid" ? "3 / 4" : undefined,
                }}
                title={g.prompt ?? undefined}
              >
                <img
                  src={uploadUrl(g.thumbnailPath ?? g.imagePath)}
                  alt={g.prompt ?? "generation"}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  style={view === "list" ? { height: 64, width: 64, borderRadius: 12 } : undefined}
                />
                {/* tag */}
                <span
                  className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                  style={{
                    background: prod ? "rgba(47,227,138,0.85)" : "rgba(6,9,15,0.7)",
                    color: prod ? "#04210F" : DS.text,
                  }}
                >
                  {prod ? "Prod" : "Test"}
                </span>
                {/* gradient + time */}
                <div
                  className="absolute inset-x-0 bottom-0 flex items-end justify-between p-1.5"
                  style={{ background: "linear-gradient(0deg, rgba(6,9,15,0.85), transparent)" }}
                >
                  <span className="text-[10px]" style={{ color: DS.textMuted }}>
                    {relativeTime(g.createdAt)}
                  </span>
                </div>
                {video && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ background: "rgba(6,9,15,0.6)", border: `1px solid ${DS.border2}` }}
                    >
                      <Play className="h-4 w-4" style={{ color: DS.text }} fill={DS.text} />
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!genQ.isLoading && visible.length < total && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + 40)}
            className="rounded-lg px-4 py-2 text-[12px] font-medium"
            style={{ background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }}
          >
            Load more
          </button>
        </div>
      )}

      {/* Lightweight viewer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(6,9,15,0.8)" }}
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl"
            style={surfaceCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ background: DS.surface }}>
              <img
                src={uploadUrl(selected.imagePath)}
                alt={selected.prompt ?? "generation"}
                className="mx-auto max-h-[55vh] w-auto object-contain"
              />
            </div>
            <div className="flex flex-col gap-3 p-4">
              {selected.prompt && (
                <p className="text-[12px] leading-relaxed" style={{ color: DS.textMuted }}>
                  {selected.prompt}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
                <Meta label="Source" value={selected.source} />
                <Meta label="Model" value={selected.model ?? "—"} />
                <Meta label="LoRA" value={selected.loraStrength ?? "—"} />
                <Meta
                  label="Cost"
                  value={selected.costUsd ? `$${parseFloat(selected.costUsd).toFixed(2)}` : "—"}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(selected.id)}
                  disabled={deleteMut.isPending}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
                  style={{ color: DS.critical, border: `1px solid rgba(255,91,91,0.3)` }}
                >
                  {deleteMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ color: DS.textFaint }}>{label}</p>
      <p className="font-medium capitalize" style={{ color: DS.text }}>
        {value}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile / Knowledge / Settings tabs (real persona data via updatePersona)  */
/* -------------------------------------------------------------------------- */
function ProfileTab({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const [bio, setBio] = useState(persona.bio ?? "");
  const saveMut = useMutation({
    mutationFn: () => imageStudioApi.updatePersona(persona.id, { bio }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] }),
  });
  useEffect(() => setBio(persona.bio ?? ""), [persona.id, persona.bio]);

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div className="flex items-center gap-4">
        <PersonaAvatar persona={persona} size={64} />
        <div>
          <div className="text-[18px] font-semibold" style={{ color: DS.text }}>
            {persona.name}
          </div>
          <div className="flex items-center gap-2 text-[12px]" style={{ color: DS.textFaint }}>
            <Sparkles className="h-3 w-3" /> Flux + LoRA · <RatingTag persona={persona} />
          </div>
        </div>
      </div>
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
          Bio
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={5}
          placeholder="Persona bio, personality, and backstory…"
          className="w-full resize-none rounded-lg p-3 text-[13px] focus:outline-none"
          style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.text }}
        />
      </div>
      <button
        type="button"
        onClick={() => saveMut.mutate()}
        disabled={saveMut.isPending}
        className="rounded-lg px-4 py-2 text-[13px] font-semibold"
        style={{ background: DS.primary, color: "#04122E" }}
      >
        {saveMut.isPending ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}

function KnowledgeTab({ persona }: { persona: ImageProvider }) {
  const attrs = (persona.attributes ?? {}) as Record<string, unknown>;
  const entries = Object.entries(attrs);
  return (
    <div className="max-w-2xl space-y-4 p-6">
      <p className="text-[13px]" style={{ color: DS.textMuted }}>
        The trained knowledge backing this persona's model — trigger word and the
        structured attributes baked into its prompts.
      </p>
      <div className="rounded-xl p-4" style={innerCard}>
        <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold" style={{ color: DS.text }}>
          <BookOpen className="h-4 w-4" style={{ color: DS.analytics }} />
          Persona attributes
        </div>
        {entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: DS.textFaint }}>
            No structured attributes recorded for this persona yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: DS.surface }}>
                <span className="text-[12px]" style={{ color: DS.textFaint }}>
                  {k.replace(/_/g, " ")}
                </span>
                <span className="text-[12px] font-medium" style={{ color: DS.text, fontFamily: FONT_MONO }}>
                  {String(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab({
  persona,
  companyId,
}: {
  persona: ImageProvider;
  companyId: string;
}) {
  const queryClient = useQueryClient();
  const favMut = useMutation({
    mutationFn: (fav: boolean) => imageStudioApi.updatePersona(persona.id, { is_favorite: fav }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] }),
  });
  return (
    <div className="max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between rounded-xl p-4" style={innerCard}>
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4" style={{ color: DS.automation }} />
          <div>
            <div className="text-[13px] font-medium" style={{ color: DS.text }}>
              Local generation backend
            </div>
            <div className="text-[11px]" style={{ color: DS.textFaint, fontFamily: FONT_MONO }}>
              ComfyUI :18801 · model {persona.model ?? "Flux + LoRA"}
            </div>
          </div>
        </div>
        <span className="text-[11px]" style={{ color: DS.success }}>
          Configured
        </span>
      </div>

      <div className="flex items-center justify-between rounded-xl p-4" style={innerCard}>
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4" style={{ color: DS.warning }} />
          <div className="text-[13px] font-medium" style={{ color: DS.text }}>
            Favorite persona
          </div>
        </div>
        <button
          type="button"
          onClick={() => favMut.mutate(!persona.isFavorite)}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          style={
            persona.isFavorite
              ? { background: DS.primary, color: "#04122E" }
              : { background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }
          }
        >
          {persona.isFavorite ? "Favorited" : "Mark favorite"}
        </button>
      </div>

      <p className="text-[11px]" style={{ color: DS.textFaint }}>
        Company {companyId} · persona id {persona.id}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Selected persona workspace                                                 */
/* -------------------------------------------------------------------------- */
const WORKSPACE_TABS = [
  { key: "studio", label: "Studio", icon: Wand2 },
  { key: "profile", label: "Profile", icon: User },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["key"];

function PersonaWorkspace({
  persona,
  status,
  companyId,
}: {
  persona: ImageProvider;
  status: PersonaStatus;
  companyId: string;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("studio");
  const [galleryMinimized, setGalleryMinimized] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <section style={surfaceCard} className="overflow-hidden">
      {/* Workspace header */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >
        <div className="flex items-center gap-3">
          <PersonaAvatar persona={persona} size={44} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold" style={{ color: DS.text }}>
                {persona.name}
              </span>
              <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
              <span className="text-[12px] font-medium" style={{ color: status.color }}>
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: DS.textFaint }}>
              <Sparkles className="h-3 w-3" /> Flux + LoRA
              <RatingTag persona={persona} />
            </div>
          </div>
        </div>

      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 pt-3" style={{ borderBottom: `1px solid ${DS.border}` }}>
        {WORKSPACE_TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              data-testid={`ws-tab-${key}`}
              className="flex items-center gap-1.5 px-3 pb-3 text-[13px] font-medium transition-colors"
              style={{
                color: active ? DS.text : DS.textMuted,
                borderBottom: `2px solid ${active ? DS.primary : "transparent"}`,
                marginBottom: -1,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      {tab === "studio" ? (
        <div className={cn("grid grid-cols-1 gap-5 p-5", !advancedOpen && "lg:grid-cols-[380px_minmax(0,1fr)]")}>
          <div
            className={cn("rounded-xl p-4", advancedOpen && "overflow-y-auto max-h-[75vh]")}
            style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
          >
            <GenerateContentPanel persona={persona} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} />
          </div>
          <div
            className={cn("rounded-xl p-4", advancedOpen && "max-h-[75vh] overflow-y-auto")}
            style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold" style={{ color: DS.text }}>Content Gallery</span>
                <button
                  type="button"
                  onClick={() => setGalleryMinimized(!galleryMinimized)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors"
                  style={{ background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }}
                >
                  {galleryMinimized ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {galleryMinimized ? "Show" : "Hide"}
                </button>
              </div>
            </div>
            {!galleryMinimized && <ContentGallery persona={persona} />}
          </div>
        </div>
      ) : tab === "profile" ? (
        <ProfileTab persona={persona} />
      ) : tab === "knowledge" ? (
        <KnowledgeTab persona={persona} />
      ) : (
        <SettingsTab persona={persona} companyId={companyId} />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */
export function ImageStudio() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? null;
  const [searchParams] = useSearchParams();
  const deepLinkPersona = searchParams.get("persona");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [trainingPersona, setTrainingPersona] = useState<ImageProvider | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const queryClient = useQueryClient();

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", companyId],
    queryFn: () => imageStudioApi.listProviders(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const jobsQ = useQuery({
    queryKey: ["image-studio", "training", companyId],
    queryFn: () => imageStudioApi.listTrainingJobs(companyId!),
    enabled: !!companyId,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.some((j) => j.status !== "ready" && j.status !== "failed");
      return active ? 8_000 : false;
    },
  });

  const providers = providersQ.data?.providers ?? [];
  const personas = useMemo(
    () =>
      providers
        .filter((p) => p.type === "local_lora")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [providers],
  );
  const trainers = useMemo(() => providers.filter((p) => p.trainingCapable), [providers]);

  const jobsByPersona = useMemo(() => {
    const map = new Map<string, LoraTrainingJob>();
    for (const job of jobsQ.data?.jobs ?? []) {
      if (!map.has(job.personaId)) map.set(job.personaId, job);
    }
    return map;
  }, [jobsQ.data]);

  // Default selection: deep-link → first ready → first persona.
  useEffect(() => {
    if (activeId && personas.some((p) => p.id === activeId)) return;
    if (personas.length === 0) return;
    if (deepLinkPersona && personas.some((p) => p.id === deepLinkPersona)) {
      setActiveId(deepLinkPersona);
      return;
    }
    const ready = personas.find(
      (p) => personaStatus(p, jobsByPersona.get(p.id)).ready,
    );
    setActiveId((ready ?? personas[0]).id);
  }, [personas, deepLinkPersona, activeId, jobsByPersona]);

  const activePersona = personas.find((p) => p.id === activeId) ?? null;

  return (
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="ai-influencer-studio"
    >
      {/* Header */}
      <div>
        <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
          AI Influencer Studio
        </h1>
        <p className="text-[14px]" style={{ color: DS.textMuted }}>
          Create and run AI personas. Generate images and video for social content.
        </p>
      </div>

      {/* Trained Personas row */}
      <section style={surfaceCard} className="p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <SectionLabel>Trained Personas</SectionLabel>
          <span className="text-[12px] font-medium" style={{ color: DS.textFaint }}>
            · {personas.length} personas · Flux + LoRA
          </span>
        </div>

        {providersQ.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-[13px]" style={{ color: DS.textMuted }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading personas…
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-auto-hide">
            <NewPersonaCard
              onClick={() => setWizardOpen(true)}
            />
            {personas.map((p) => (
              <PersonaRowCard
                key={p.id}
                persona={p}
                status={personaStatus(p, jobsByPersona.get(p.id))}
                selected={p.id === activeId}
                onOpen={() => setActiveId(p.id)}
                onTrain={() => setTrainingPersona(p)}
              />
            ))}
            {personas.length === 0 && (
              <div className="flex items-center text-[13px]" style={{ color: DS.textFaint }}>
                No trained personas yet — train a Flux + LoRA model to get started.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Selected persona workspace */}
      {activePersona && (
        <PersonaWorkspace
          persona={activePersona}
          status={personaStatus(activePersona, jobsByPersona.get(activePersona.id))}
          companyId={companyId ?? ""}
        />
      )}

      {trainingPersona && (
        <TrainPersonaModal
          open={!!trainingPersona}
          onOpenChange={(o) => !o && setTrainingPersona(null)}
          companyId={companyId ?? ""}
          persona={trainingPersona}
          trainers={trainers}
        />
      )}

      <NewPersonaWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

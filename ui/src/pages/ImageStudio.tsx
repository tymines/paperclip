import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type LoraTrainingJob,
  type PersonaGeneration,
  type GenerationSource,
  type GenerationJob,
  type ContentIdea,
} from "../api/imageStudio";
import { ApiError } from "../api/client";
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
  MessageSquare,
  Send,
  TriangleAlert,
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
  ArrowRight,
  Boxes,
  CircleDollarSign,
  CircleUserRound,
  Clock3,
  GraduationCap,
  ShieldCheck,
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
import {
  CreatorOsNavigation,
  type CreatorOsDestination,
} from "@/components/image-studio/creator-os/CreatorOsNavigation";
import { CreatorOperationalLanes } from "@/components/image-studio/creator-os/CreatorOperationalLanes";

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
  primary: "#8B5CF6",
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
      className="flex h-[52px] shrink-0 items-center gap-2 rounded-xl px-3 transition-colors hover:brightness-110 disabled:opacity-60 disabled:cursor-wait"
      style={{ border: `1px dashed ${DS.border3}`, color: DS.textFaint }}
      data-testid="new-persona"
      title={loading ? "Setting up character" : "Create new character"}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}` }}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: DS.primary }} />
        ) : (
          <Plus className="h-3.5 w-3.5" style={{ color: DS.primary }} />
        )}
      </span>
      <span className="whitespace-nowrap text-[12px] font-semibold" style={{ color: DS.text }}>
        {loading ? "Creating…" : "New Persona"}
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
  return (
    <div
      className="relative flex h-[52px] shrink-0 items-center gap-2 rounded-xl pl-2 pr-2.5 transition-all"
      style={{
        background: DS.surface3,
        border: `1px solid ${selected ? DS.primary : DS.border}`,
        boxShadow: selected ? `0 0 0 1px ${DS.primary}` : undefined,
      }}
      data-testid={`persona-card-${persona.id}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={selected}
        aria-label={`${persona.name}, ${status.label}`}
        className="flex min-w-0 items-center gap-2 text-left"
        data-testid={`open-studio-${persona.id}`}
        title={`${persona.name} — ${status.label} · Flux + LoRA`}
      >
        <PersonaAvatar persona={persona} size={36} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="max-w-[120px] truncate text-[12px] font-semibold leading-tight" style={{ color: DS.text }}>
              {persona.name}
            </span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: status.color }}
              title={status.label}
            />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-[10px] font-medium leading-none" style={{ color: status.color }}>
              {status.label}
            </span>
            <RatingTag persona={persona} />
          </span>
        </span>
      </button>

      {status.progress != null ? (
        <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full" style={{ background: DS.surface }}>
          <span
            className="block h-full rounded-full transition-all"
            style={{ width: `${status.progress}%`, background: status.color }}
          />
        </span>
      ) : !status.ready ? (
        <button
          type="button"
          onClick={onTrain}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors"
          style={{ background: DS.surface, color: DS.text, border: `1px solid ${DS.border2}` }}
          data-testid={`train-${persona.id}`}
        >
          <Cloud className="h-3 w-3" />
          Train
        </button>
      ) : null}
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

  if (batchQ.isError) {
    return (
      <div
        className="mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2"
        style={{ background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.25)" }}
        data-testid="batch-progress-error"
      >
        <span className="flex items-center gap-2 text-[12px]" style={{ color: DS.critical }}>
          <TriangleAlert className="h-3.5 w-3.5" /> Batch status unavailable
        </span>
        <button type="button" onClick={() => void batchQ.refetch()} className="text-[11px]" style={{ color: DS.text }}>
          Try again
        </button>
      </div>
    );
  }

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

export function GenerateContentPanel({ persona, advancedOpen: externalAdvancedOpen, onAdvancedChange }: { persona: ImageProvider; advancedOpen?: boolean; onAdvancedChange?: (open: boolean) => void }) {
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
    <div
      className="flex flex-col gap-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"
      data-testid="generate-content-panel"
    >
      <SectionLabel>Generate Content</SectionLabel>

      {/* Image / Video toggle */}
      <div
        className="grid grid-cols-2 gap-1 rounded-xl p-1"
        style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
        data-testid="mode-toggle"
      >
        {(["image", "video"] as const).map((m) => {
          const active = mode === m;
          const disabled = m === "video";
          const Icon = m === "image" ? ImageIcon : Video;
          return (
            <button
              key={m}
              type="button"
              onClick={() => !disabled && setMode(m)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={m === "image" ? "Image generation" : "Video generation unavailable"}
              title={disabled ? "Video generation is not available in the current Studio route." : undefined}
              data-testid={`mode-${m}`}
              className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-semibold capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
          {/* TEMPLATE SHELF SLOT (TYL-194 L3 / Fable Ruling §3 templates-over-prompting):
              the preset/photoshoot template shelf lands HERE, above the prompt box,
              when Phase 2.1 ships. No template features yet — placeholder slot only. */}

          {/* Prompt */}
          <div>
            <label className={labelCls} style={{ color: DS.textFaint }}>
              Prompt
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="Describe the scene, pose, lighting, mood, outfit…"
                className="w-full resize-none rounded-lg p-2.5 pr-2.5 text-[13px] focus:outline-none"
                style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.text }}
                data-testid="prompt-input"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <button
                  type="button"
                  disabled
                  title="Prompt enhancement — no LLM endpoint wired yet"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
                  style={{
                    color: DS.warning,
                    background: "rgba(244,185,64,0.08)",
                    border: `1px solid rgba(244,185,64,0.3)`,
                    cursor: "not-allowed",
                  }}
                >
                  <Wand2 className="h-3 w-3" />
                  Enhance prompt — soon
                </button>
                <span className="text-[10px]" style={{ color: DS.textFaint, fontFamily: FONT_MONO }}>
                  {prompt.length} / 1000
                </span>
              </div>
            </div>
          </div>

          {/* Settings — 2-col compact grid (TYL-194 L3) */}
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Settings</SectionLabel>

            {/* Dimensions + Count — one row */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <span className="mb-1 block text-[11px]" style={{ color: DS.textMuted }}>
                  Dimensions
                </span>
                <div className="relative">
                  <select
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value)}
                    className="w-full appearance-none rounded-lg px-2 py-1.5 text-[12px] focus:outline-none"
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
                    className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                    style={{ color: DS.textFaint }}
                  />
                </div>
              </div>
              <div>
                <span className="mb-1 block text-[11px]" style={{ color: DS.textMuted }}>
                  Count
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {COUNTS.map((c) => {
                    const active = count === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCount(c)}
                        aria-pressed={active}
                        aria-label={`Generate ${c} image${c === 1 ? "" : "s"}`}
                        data-testid={`count-${c}`}
                        className="rounded-lg py-1.5 text-[12px] font-semibold transition-colors"
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
            </div>

            {/* LoRA strength + Gender — one row */}
            <div className="grid grid-cols-2 items-end gap-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: DS.textMuted }}>
                    LoRA Strength
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: DS.text, fontFamily: FONT_MONO }}>
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
              <div>
                <span className="mb-1 block text-[11px]" style={{ color: DS.textMuted }}>
                  Gender
                </span>
                <GenderFilter value={gender} onChange={setGender} />
              </div>
            </div>

            {/* Advanced studio — preserves the full existing workbench
                (structured controls, PhotoShoot, Undresser, template Library). */}
            <button
              type="button"
              onClick={() => { const next = !advancedOpen; if (onAdvancedChange) onAdvancedChange(next); else setLocalAdvancedOpen(next); }}
              aria-expanded={advancedOpen}
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
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-50"
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
              <PersonaWorkbench
                persona={persona}
                onBatchStarted={(id) => setBatchId(id)}
                syncTabToUrl
              />
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

export function ContentGallery({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<PersonaGeneration | null>(null);

  const genQ = useInfiniteQuery({
    queryKey: ["image-studio", "generations", persona.id],
    queryFn: ({ pageParam }) =>
      imageStudioApi.listGenerations(persona.id, { limit: 40, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => imageStudioApi.deleteGeneration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
      setSelected(null);
    },
  });

  const generations = useMemo(() => {
    const seen = new Set<string>();
    return (genQ.data?.pages ?? []).flatMap((page) =>
      page.generations.filter((generation) => {
        if (seen.has(generation.id)) return false;
        seen.add(generation.id);
        return true;
      }),
    );
  }, [genQ.data]);
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
    return sorted;
  }, [generations, filter, newestFirst]);

  const chip = (value: GalleryFilter, label: string, n: number) => {
    const active = filter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setFilter(value)}
        aria-pressed={active}
        data-testid={`filter-${value}`}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors"
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
      {/* Single-row toolbar (TYL-194 L4): filters + sort + view in one ~32px strip */}
      {!genQ.isLoading && !genQ.isError && (
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {chip("all", "All", counts.all)}
        {chip("test", "Test", counts.test)}
        {chip("production", "Production", counts.production)}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setNewestFirst((v) => !v)}
            aria-label={`Sort gallery: ${newestFirst ? "newest first" : "oldest first"}`}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
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
                  aria-label={`${v === "grid" ? "Grid" : "List"} view`}
                  aria-pressed={active}
                  title={`${v === "grid" ? "Grid" : "List"} view`}
                  data-testid={`gallery-view-${v}`}
                  className="px-2 py-1"
                  style={{ background: active ? DS.primary : DS.surface, color: active ? "#04122E" : DS.textMuted }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {genQ.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-[13px]" style={{ color: DS.textMuted }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading gallery…
        </div>
      ) : genQ.isError ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/[0.06] px-4 py-6 text-center"
          data-testid="gallery-error"
        >
          <TriangleAlert className="h-5 w-5" style={{ color: DS.critical }} />
          <p className="text-[13px] font-medium" style={{ color: DS.text }}>
            Gallery unavailable
          </p>
          <p className="text-[11px]" style={{ color: DS.textFaint }}>
            Asset records could not be loaded. No empty gallery is being inferred.
          </p>
          <button
            type="button"
            onClick={() => void genQ.refetch()}
            className="rounded-lg px-3 py-1.5 text-[11px] font-medium"
            style={{ color: DS.text, border: `1px solid ${DS.border2}` }}
          >
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl py-6 text-center"
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
              ? "grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
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
                data-testid={`gallery-item-${g.id}`}
                className="group relative overflow-hidden rounded-[14px]"
                style={{
                  border: `1px solid ${DS.border}`,
                  background: DS.surface,
                  aspectRatio: view === "grid" ? "3 / 4" : undefined,
                }}
                title={g.prompt ?? undefined}
              >
                {video ? (
                  <video
                    src={uploadUrl(g.imagePath)}
                    poster={g.thumbnailPath ? uploadUrl(g.thumbnailPath) : undefined}
                    aria-label={g.prompt ?? "video generation"}
                    muted
                    playsInline
                    preload={g.thumbnailPath ? "none" : "metadata"}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    style={view === "list" ? { height: 64, width: 64, borderRadius: 12 } : undefined}
                  />
                ) : (
                  <img
                    src={uploadUrl(g.thumbnailPath ?? g.imagePath)}
                    alt={g.prompt ?? "generation"}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    style={view === "list" ? { height: 64, width: 64, borderRadius: 12 } : undefined}
                  />
                )}
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

      {!genQ.isLoading && genQ.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void genQ.fetchNextPage()}
            disabled={genQ.isFetchingNextPage}
            className="rounded-lg px-4 py-1.5 text-[12px] font-medium"
            style={{ background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }}
          >
            {genQ.isFetchingNextPage ? "Loadingâ€¦" : "Load more"}
          </button>
        </div>
      )}

      {/* Lightweight viewer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(6,9,15,0.8)" }}
          onClick={() => setSelected(null)}
          data-testid="gallery-viewer"
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl"
            style={surfaceCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ background: DS.surface }}>
              {isVideo(selected) ? (
                <video
                  src={uploadUrl(selected.imagePath)}
                  poster={selected.thumbnailPath ? uploadUrl(selected.thumbnailPath) : undefined}
                  aria-label={selected.prompt ?? "video generation"}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto max-h-[55vh] w-auto object-contain"
                  data-testid="gallery-viewer-video"
                />
              ) : (
                <img
                  src={uploadUrl(selected.imagePath)}
                  alt={selected.prompt ?? "generation"}
                  className="mx-auto max-h-[55vh] w-auto object-contain"
                  data-testid="gallery-viewer-image"
                />
              )}
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
    <div className="max-w-2xl space-y-4 p-4">
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
    <div className="max-w-2xl space-y-4 p-4">
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

export function SettingsTab({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const favMut = useMutation({
    mutationFn: (fav: boolean) => imageStudioApi.updatePersona(persona.id, { is_favorite: fav }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] }),
  });
  return (
    <div className="max-w-2xl space-y-4 p-4">
      {/* Hosted providers per Tyler override (Fable Ruling v2 §4): Replicate /
          Atlas Cloud / WaveSpeed AI — not the local 3090/ComfyUI. */}
      <div className="flex items-center justify-between rounded-xl p-3.5" style={innerCard}>
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4" style={{ color: DS.automation }} />
          <div>
            <div className="text-[13px] font-medium" style={{ color: DS.text }}>
              Hosted generation backend
            </div>
            <div className="text-[11px]" style={{ color: DS.textFaint, fontFamily: FONT_MONO }}>
              Replicate · Atlas Cloud · WaveSpeed AI · model {persona.model ?? "Flux + LoRA"}
            </div>
          </div>
        </div>
        <span className="text-[11px]" style={{ color: DS.success }}>
          Configured
        </span>
      </div>

      <div className="flex items-center justify-between rounded-xl p-3.5" style={innerCard}>
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
    </div>
  );
}

type ContentGeneratorUnavailableBody = {
  code?: unknown;
  retryable?: unknown;
};

function contentGenerationFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as ContentGeneratorUnavailableBody | null;
    if (body?.code === "content_generator_unavailable") {
      if (body.retryable === true) {
        return "Content idea generation is temporarily unavailable. Your existing ideas are preserved. Try again shortly.";
      }
      return "Content idea generation is unavailable because no generator is configured. Your existing ideas are preserved. Configure a content generator, then try again.";
    }
  }
  return error instanceof Error ? error.message : "Failed to generate ideas.";
}

/* Influencer Studio — Content generation + draft scheduling tab */
export function ContentPanel({
  persona,
  companyId,
}: {
  persona: ImageProvider;
  companyId: string;
  status: PersonaStatus;
}) {
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState<ContentIdea[] | null>(null);
  const [schedulingIdea, setSchedulingIdea] = useState<ContentIdea | null>(null);
  const [editedCaption, setEditedCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [draftsMinimized, setDraftsMinimized] = useState(false);
  const queryClient = useQueryClient();
  const contentCapabilityQ = useQuery({
    queryKey: ["influencer", "content-capability", companyId],
    queryFn: () => imageStudioApi.getContentGeneratorCapability(companyId),
  });
  const contentGenerationEnabled = contentCapabilityQ.data?.enabled === true;

  const generateMut = useMutation({
    mutationFn: () =>
      imageStudioApi.generateContent(companyId, persona.id, { topic: topic.trim(), count: 5 }),
    onSuccess: (data) => {
      setIdeas(data.ideas);
    },
  });

  const scheduleMut = useMutation({
    mutationFn: (body: { caption: string; scheduledAt?: string }) =>
      imageStudioApi.schedulePost(companyId, persona.id, body),
    onSuccess: () => {
      setSchedulingIdea(null);
      setEditedCaption("");
      setScheduledAt("");
      queryClient.invalidateQueries({ queryKey: ["influencer", "drafts", companyId, persona.id] });
    },
  });

  const draftsQuery = useQuery({
    queryKey: ["influencer", "drafts", companyId, persona.id],
    queryFn: () => imageStudioApi.listDrafts(companyId, persona.id),
    enabled: persona.status === "ready",
  });

  if (persona.status !== "ready") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10">
        <MessageSquare className="h-10 w-10" style={{ color: DS.textMuted }} />
        <p className="text-[13px]" style={{ color: DS.textMuted }}>
          Complete persona training to access Content Studio
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Topic input */}
      <div
        className="flex flex-col gap-3 rounded-xl p-4"
        style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
      >
        <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
          Generate Content Ideas
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            disabled={!contentGenerationEnabled}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., New collection launch, behind the scenes, Q&A..."
            data-testid="content-topic-input"
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: DS.surface,
              color: DS.text,
              border: `1px solid ${DS.border}`,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && topic.trim() && contentGenerationEnabled) generateMut.mutate();
            }}
          />
          <button
            type="button"
            onClick={() => generateMut.mutate()}
            disabled={!contentGenerationEnabled || generateMut.isPending || !topic.trim()}
            data-testid="content-generate-submit"
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-opacity disabled:opacity-50"
            style={{ background: DS.primary, color: "#fff" }}
          >
            {generateMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {generateMut.isPending ? "Generating..." : "Generate Ideas"}
          </button>
        </div>
        {!contentGenerationEnabled && (
          <p className="flex items-center gap-1.5 text-[12px]" style={{ color: DS.warning }} role="status">
            <TriangleAlert className="h-3 w-3" />
            {contentCapabilityQ.data?.reason ?? (contentCapabilityQ.isError
              ? "Content Ideas capability could not be verified, so generation is disabled."
              : "Checking Content Ideas capability…")}
          </p>
        )}
        {generateMut.isError && (
          <p
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: DS.critical }}
            data-testid="content-generation-error"
          >
            <TriangleAlert className="h-3 w-3" />
            {contentGenerationFailureMessage(generateMut.error)}
          </p>
        )}
      </div>

      {/* Generated ideas */}
      {ideas && ideas.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
            Ideas
          </span>
          {ideas.map((idea, i) => (
            <div
              key={i}
              className="rounded-xl p-4"
              style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
            >
              <span className="text-[14px] font-semibold" style={{ color: DS.text }}>
                {idea.title}
              </span>
              <p
                className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed"
                style={{ color: DS.textMuted }}
              >
                {idea.caption}
              </p>
              {idea.suggestedHashtags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {idea.suggestedHashtags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      style={{ background: DS.surface, color: DS.primary }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSchedulingIdea(idea);
                    setEditedCaption(idea.caption);
                    setScheduledAt("");
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    background: DS.primary,
                    color: "#fff",
                  }}
                >
                  <Send className="h-3 w-3" />
                  Schedule
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state when generate hasn't been called */}
      {!ideas && !generateMut.isPending && (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <span className="text-[13px]" style={{ color: DS.textMuted }}>
            Enter a topic and click Generate Ideas
          </span>
        </div>
      )}

      {/* Schedule form */}
      {schedulingIdea && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSchedulingIdea(null)}
        >
          <div
            className="mx-4 w-full max-w-lg rounded-xl p-5"
            style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[14px] font-semibold" style={{ color: DS.text }}>
              Schedule Post — {schedulingIdea.title}
            </span>
            <textarea
              value={editedCaption}
              onChange={(e) => setEditedCaption(e.target.value)}
              rows={5}
              className="mt-3 w-full resize-none rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{
                background: DS.surface,
                color: DS.text,
                border: `1px solid ${DS.border}`,
              }}
            />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-2 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{
                background: DS.surface,
                color: DS.text,
                border: `1px solid ${DS.border}`,
              }}
              placeholder="Schedule for later (optional)"
            />
            {scheduleMut.isError && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px]" style={{ color: DS.critical }}>
                <TriangleAlert className="h-3 w-3" />
                {(scheduleMut.error as Error)?.message ?? "Failed to schedule."}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSchedulingIdea(null)}
                className="rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
                style={{ color: DS.textMuted }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  scheduleMut.mutate({
                    caption: editedCaption,
                    ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
                  })
                }
                disabled={scheduleMut.isPending || !editedCaption.trim()}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-opacity disabled:opacity-50"
                style={{ background: DS.primary, color: "#fff" }}
              >
                {scheduleMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {scheduleMut.isPending ? "Scheduling..." : "Confirm Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts section */}
      <div
        className="rounded-xl p-4"
        style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
              Drafts
            </span>
            {draftsQuery.data?.drafts && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: DS.surface, color: DS.textMuted }}
              >
                {draftsQuery.data.drafts.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDraftsMinimized(!draftsMinimized)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors"
            style={{ color: DS.textMuted }}
          >
            {draftsMinimized ? "Show" : "Hide"}
          </button>
        </div>
        {!draftsMinimized && (
          <>
            {draftsQuery.isPending ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: DS.textMuted }} />
              </div>
            ) : draftsQuery.data?.drafts && draftsQuery.data.drafts.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {draftsQuery.data.drafts.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-lg p-3"
                    style={{ background: DS.surface, border: `1px solid ${DS.border}` }}
                  >
                    <p className="line-clamp-2 text-[12px] leading-relaxed" style={{ color: DS.text }}>
                      {post.content}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style={{
                          background:
                            post.status === "draft"
                              ? "rgba(251, 191, 36, 0.15)"
                              : "rgba(47, 227, 138, 0.15)",
                          color: post.status === "draft" ? "#F4B940" : "#2FE38A",
                        }}
                      >
                        {post.status}
                      </span>
                      <span className="text-[10px]" style={{ color: DS.textFaint }}>
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12px]" style={{ color: DS.textMuted }}>
                No drafts yet. Generate ideas and schedule them.
              </p>
            )}
          </>
        )}
      </div>
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
  { key: "content", label: "Content", icon: MessageSquare },
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
  const [workspaceSearchParams] = useSearchParams();
  const [tab, setTab] = useState<WorkspaceTab>("studio");
  const [galleryMinimized, setGalleryMinimized] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    ["generate", "photoshoot", "undresser", "library"].includes(
      workspaceSearchParams.get("tab") ?? "",
    ),
  );

  return (
    <section style={surfaceCard} className="overflow-hidden">
      {/* Workspace header + tabs — single ≤48px bar (TYL-194 L5) */}
      <div
        className="flex flex-wrap items-stretch gap-x-2 px-3"
        style={{ borderBottom: `1px solid ${DS.border}`, minHeight: 44 }}
      >
        <div className="flex min-w-0 items-center gap-2 py-1.5">
          <PersonaAvatar persona={persona} size={28} />
          <span className="max-w-[180px] truncate text-[14px] font-semibold" style={{ color: DS.text }}>
            {persona.name}
          </span>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: status.color }} />
          <span className="whitespace-nowrap text-[11px] font-medium" style={{ color: status.color }}>
            {status.label}
          </span>
          <RatingTag persona={persona} />
        </div>
        <div className="ml-auto flex items-stretch gap-0.5">
          {WORKSPACE_TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                data-testid={`ws-tab-${key}`}
                className="flex items-center gap-1.5 px-2.5 text-[12px] font-medium transition-colors"
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
      </div>

      {/* Body */}
      {tab === "studio" ? (
        <div className={cn("grid grid-cols-1 gap-3 p-3", !advancedOpen && "lg:grid-cols-[320px_minmax(0,1fr)]")}>
          <div
            className="rounded-xl p-3"
            style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
          >
            <GenerateContentPanel persona={persona} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} />
          </div>
          <div
            className="rounded-xl p-3"
            style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: DS.text }}>Content Gallery</span>
              <button
                type="button"
                onClick={() => setGalleryMinimized(!galleryMinimized)}
                className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] transition-colors"
                style={{ background: DS.surface, color: DS.textMuted, border: `1px solid ${DS.border}` }}
              >
                {galleryMinimized ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {galleryMinimized ? "Show" : "Hide"}
              </button>
            </div>
            {!galleryMinimized && <ContentGallery persona={persona} />}
          </div>
        </div>
      ) : tab === "profile" ? (
        <ProfileTab persona={persona} />
      ) : tab === "knowledge" ? (
        <KnowledgeTab persona={persona} />
      ) : tab === "content" ? (
        <ContentPanel persona={persona} companyId={companyId} status={status} />
      ) : (
        <SettingsTab persona={persona} />
      )}
    </section>
  );
}

function DestinationHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/15 bg-gradient-to-r from-violet-600/10 via-[#101322] to-fuchsia-500/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold text-white sm:text-2xl">{title}</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-400 sm:text-[13px]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function CreatorOsEmptyState({
  icon: Icon,
  title,
  description,
  examples,
}: {
  icon: typeof Boxes;
  title: string;
  description: string;
  examples?: string[];
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0c1019] p-5 sm:p-7" data-testid="creator-foundation-state">
      <div className="flex max-w-2xl flex-col items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{description}</p>
        </div>
        {examples && (
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <span key={example} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400">
                {example}
              </span>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled
          aria-describedby="creator-foundation-explanation"
          className="mt-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-medium text-slate-500 disabled:cursor-not-allowed"
        >
          Not available in this release
        </button>
        <p id="creator-foundation-explanation" className="text-[10px] text-slate-600">
          This foundation has no current server route and cannot save, run, publish, or spend.
        </p>
      </div>
    </section>
  );
}

function OverviewPanel({
  activePersona,
  activeStatus,
  personas,
  providers,
  jobs,
  loading,
  error,
  onNavigate,
}: {
  activePersona: ImageProvider | null;
  activeStatus: PersonaStatus | null;
  personas: ImageProvider[];
  providers: ImageProvider[];
  jobs: LoraTrainingJob[];
  loading: boolean;
  error: boolean;
  onNavigate: (destination: CreatorOsDestination) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-[#0c1019] text-sm text-slate-400" data-testid="creator-overview-loading">
        <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> Loading Creator OS data…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5" data-testid="creator-overview-error">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-200"><TriangleAlert className="h-4 w-4" /> Creator data could not be loaded</div>
        <p className="mt-2 text-[12px] text-red-200/70">No provider, persona, job, or asset totals are being inferred while the request is unavailable.</p>
      </div>
    );
  }
  if (!activePersona || !activeStatus) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0c1019] p-8 text-center" data-testid="creator-overview-empty">
        <CircleUserRound className="mx-auto h-8 w-8 text-slate-600" />
        <h3 className="mt-3 text-sm font-semibold text-slate-200">No personas yet</h3>
        <p className="mt-1 text-[12px] text-slate-500">Create a persona draft to begin. No generation or training will start automatically.</p>
      </div>
    );
  }

  const readyPersonas = personas.filter((persona) => personaStatus(persona, jobs.find((job) => job.personaId === persona.id)).ready).length;
  const activeTrainingJobs = jobs.filter((job) => !["ready", "failed"].includes(job.status)).length;
  return (
    <div className="space-y-3" data-testid="creator-overview">
      <DestinationHeading
        eyebrow="Creator command center"
        title={`Welcome back — ${activePersona.name} is selected`}
        description="Continue from real persona, provider, training, and asset data. Campaign, approval, and spend totals stay absent until backed by current routes."
        action={(
          <button type="button" onClick={() => onNavigate("create")} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-[12px] font-semibold text-white shadow-lg shadow-violet-950/40">
            <Sparkles className="h-4 w-4" /> Create content
          </button>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active persona", activePersona.name, activeStatus.label, CircleUserRound],
          ["Personas ready", `${readyPersonas} of ${personas.length}`, "From current persona state", ShieldCheck],
          ["Provider entries", String(providers.length), "Configured catalog records", Server],
          ["Training in progress", String(activeTrainingJobs), jobs.length ? `${jobs.length} job records` : "No training jobs", Clock3],
        ].map(([label, value, note, Icon]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-800 bg-gradient-to-b from-[#121725] to-[#0b0f17] p-4">
            <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{String(label)}</span><Icon className="h-4 w-4 text-violet-400" /></div>
            <p className="mt-3 truncate text-lg font-semibold text-slate-100">{String(value)}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{String(note)}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-slate-800 bg-[#0c1019] p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="text-sm font-semibold text-slate-100">Recent assets</h3><p className="text-[10px] text-slate-500">Loaded from {activePersona.name}’s real gallery</p></div>
          <button type="button" onClick={() => onNavigate("library")} className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-300">Open Library <ArrowRight className="h-3 w-3" /></button>
        </div>
        <ContentGallery persona={activePersona} />
      </section>
    </div>
  );
}

function PersonasPanel({ persona, status, onTrain }: { persona: ImageProvider; status: PersonaStatus; onTrain: () => void }) {
  const [tab, setTab] = useState<"profile" | "knowledge" | "settings">("profile");
  return (
    <div className="space-y-3" data-testid="creator-personas">
      <DestinationHeading
        eyebrow="Persona lab"
        title={`${persona.name} — Persona Lab`}
        description="Edit the existing identity definition and knowledge, inspect settings, or enter the current hosted training workflow. No rights or consent checklist is added."
        action={<button type="button" onClick={onTrain} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 text-[12px] font-semibold text-violet-100"><GraduationCap className="h-4 w-4" /> Training options</button>}
      />
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0c1019]">
        <div role="tablist" aria-label="Persona Lab sections" className="flex overflow-x-auto border-b border-slate-800 px-3">
          {(["profile", "knowledge", "settings"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={cn("min-h-11 shrink-0 border-b-2 px-3 text-[12px] font-medium capitalize", tab === item ? "border-violet-400 text-white" : "border-transparent text-slate-500")}>{item}</button>
          ))}
        </div>
        {tab === "profile" ? <ProfileTab persona={persona} /> : tab === "knowledge" ? <KnowledgeTab persona={persona} /> : <SettingsTab persona={persona} />}
      </section>
      <p className="px-1 text-[10px] text-slate-600">Current state: {status.label}. Persona releases, evaluations, and immutable lineage remain later-phase until backed by current routes.</p>
    </div>
  );
}

export function LibraryBatchTracker({
  personaId,
  children,
}: {
  personaId: string;
  children: (onBatchStarted: (batchId: string) => void) => ReactNode;
}) {
  const [batchId, setBatchId] = useState<string | null>(null);
  return (
    <>
      {batchId && (
        <BatchProgress
          personaId={personaId}
          batchId={batchId}
          onClear={() => setBatchId(null)}
        />
      )}
      {children(setBatchId)}
    </>
  );
}

function LibraryPanel({ persona }: { persona: ImageProvider }) {
  return (
    <div className="space-y-3" data-testid="creator-library">
      <DestinationHeading eyebrow="Template & asset library" title="Build from what already works" description="Browse the preserved template catalog, choose a compatible tool/model/persona, and load an editable draft. Selecting a template never submits a job or overwrites the template." />
      <LibraryBatchTracker personaId={persona.id}>
        {(onBatchStarted) => (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <section className="rounded-2xl border border-slate-800 bg-[#0c1019] p-3">
              <div className="mb-2"><h3 className="text-sm font-semibold text-slate-100">All templates</h3><p className="text-[10px] text-slate-500">Current SFW/18+ and tool classifications are preserved.</p></div>
              <PersonaWorkbench persona={persona} onBatchStarted={onBatchStarted} defaultTab="library" />
            </section>
            <section className="rounded-2xl border border-slate-800 bg-[#0c1019] p-3">
              <div className="mb-2"><h3 className="text-sm font-semibold text-slate-100">Persona assets</h3><p className="text-[10px] text-slate-500">Original gallery records for {persona.name}</p></div>
              <ContentGallery persona={persona} />
            </section>
          </div>
        )}
      </LibraryBatchTracker>
    </div>
  );
}

function TrainingPanel({ personas, jobs, jobsByPersona, loading, error, onTrain }: { personas: ImageProvider[]; jobs: LoraTrainingJob[]; jobsByPersona: Map<string, LoraTrainingJob>; loading: boolean; error: boolean; onTrain: (persona: ImageProvider) => void }) {
  return (
    <div className="space-y-3" data-testid="creator-training">
      <DestinationHeading eyebrow="Hosted training" title="Persona training" description="Use the existing guarded hosted-training entry point and current provider capability data." />
      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-[#0c1019] p-5 text-[12px] text-slate-400" data-testid="training-jobs-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading training jobs…</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5" data-testid="training-jobs-error"><p className="flex items-center gap-2 text-[13px] font-medium text-red-200"><TriangleAlert className="h-4 w-4" /> Training jobs unavailable</p><p className="mt-1 text-[11px] text-red-200/70">No zero-job state is being inferred.</p></div>
      ) : <><div className="grid gap-3 md:grid-cols-2">
        {personas.map((persona) => {
          const status = personaStatus(persona, jobsByPersona.get(persona.id));
          return <div key={persona.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-[#0c1019] p-4"><PersonaAvatar persona={persona} size={44} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{persona.name}</p><p className="text-[11px]" style={{ color: status.color }}>{status.label}</p></div><button type="button" onClick={() => onTrain(persona)} className="rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-[11px] font-medium text-violet-200">Open training</button></div>;
        })}
      </div>
      {personas.length === 0 && <CreatorOsEmptyState icon={GraduationCap} title="No personas available for training" description="Create a persona draft first. This page will not create training data or call a provider on its own." />}
      <p className="px-1 text-[10px] text-slate-600">{jobs.length} current training job record{jobs.length === 1 ? "" : "s"}.</p></>}
    </div>
  );
}

function JobsPanel({ jobs, personas, loading, error }: { jobs: LoraTrainingJob[]; personas: ImageProvider[]; loading: boolean; error: boolean }) {
  const names = new Map(personas.map((persona) => [persona.id, persona.name]));
  return (
    <div className="space-y-3" data-testid="creator-jobs">
      <DestinationHeading eyebrow="Operational truth" title="Jobs & Costs" description="Current training job records are shown below. Generation estimates stay in Create; a unified spend ledger is not claimed because this release has no current route for it." />
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0c1019]">
        {loading ? <div className="flex items-center justify-center gap-2 p-8 text-[12px] text-slate-400" data-testid="jobs-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading job records…</div> : error ? <div className="p-8 text-center" data-testid="jobs-error"><TriangleAlert className="mx-auto h-7 w-7 text-red-300" /><p className="mt-2 text-sm text-red-200">Job records unavailable</p><p className="mt-1 text-[11px] text-red-200/70">No zero-job or zero-cost state is being inferred.</p></div> : jobs.length === 0 ? <div className="p-8 text-center"><CircleDollarSign className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-2 text-sm text-slate-300">No training job records</p><p className="mt-1 text-[11px] text-slate-500">Generation activity remains visible in its active Create batch and gallery.</p></div> : jobs.map((job) => <div key={job.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-800 p-4 last:border-0"><div><p className="text-[12px] font-medium text-slate-200">{names.get(job.personaId) ?? "Persona training"}</p><p className="mt-0.5 text-[10px] text-slate-500">Hosted training job</p></div><div className="text-right"><p className="text-[11px] font-semibold capitalize text-violet-300">{job.status}</p><p className="text-[10px] text-slate-500">{job.progress}%</p></div></div>)}
      </section>
    </div>
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
  const legacyToolTab = searchParams.get("tab");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [destination, setDestination] = useState<CreatorOsDestination>(() =>
    legacyToolTab && ["generate", "photoshoot", "undresser", "library"].includes(legacyToolTab)
      ? "create"
      : "overview",
  );
  const [trainingPersona, setTrainingPersona] = useState<ImageProvider | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

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
  const activeStatus = activePersona
    ? personaStatus(activePersona, jobsByPersona.get(activePersona.id))
    : null;
  const operationalDestination = ["flows", "campaigns", "review", "social"].includes(destination);
  const hasCompanyOwnedOperationalPersona = !!activePersona && activePersona.companyId === companyId;

  return (
    <div
      className="min-h-full bg-[#060810] p-2 text-slate-100 sm:p-3 lg:p-4"
      data-pp-page-v2="ai-influencer-studio"
    >
      <div
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[22px] border border-violet-400/15 bg-[#090c14] shadow-2xl shadow-black/40 lg:grid-cols-[210px_minmax(0,1fr)]"
        data-testid="creator-os-shell"
      >
        <aside className="border-b border-slate-800 bg-[#080b12] p-2.5 lg:border-b-0 lg:border-r lg:p-3">
          <div className="mb-3 hidden items-center gap-2 px-2 lg:flex"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600"><Sparkles className="h-4 w-4" /></span><div><p className="text-[9px] uppercase tracking-[0.24em] text-violet-300">Olympus</p><p className="text-[11px] font-semibold text-white">Creator OS</p></div></div>
          <CreatorOsNavigation active={destination} onNavigate={setDestination} />
        </aside>
        <main className="min-w-0 space-y-3 p-2.5 sm:p-3 lg:p-4">
      {/* Header — compact inline band (TYL-194 L1: ≤56px) */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-[20px] font-semibold leading-tight" style={{ color: DS.text }}>
          AI Influencer Studio — Creator OS
        </h1>
        <p className="text-[12px]" style={{ color: DS.textMuted }}>
          Create and run AI personas — images and video for social content.
        </p>
      </div>

      {/* Persona rail — dense chip strip (TYL-194 L2: ≤72px) */}
      <section style={surfaceCard} className="p-2.5">
        {providersQ.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: DS.textMuted }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading personas…
          </div>
        ) : providersQ.isError ? (
          <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: DS.critical }} data-testid="persona-rail-error">
            <TriangleAlert className="h-4 w-4" />
            Personas unavailable — no zero-persona state is being inferred.
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-auto-hide">
            <span className="flex shrink-0 items-center gap-1.5 pl-1 pr-1">
              <SectionLabel>Personas</SectionLabel>
              <span className="text-[11px] font-medium" style={{ color: DS.textFaint, fontFamily: FONT_MONO }}>
                {personas.length}
              </span>
            </span>
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
      {destination === "overview" && (
        <OverviewPanel
          activePersona={activePersona}
          activeStatus={activeStatus}
          personas={personas}
          providers={providers}
          jobs={jobsQ.data?.jobs ?? []}
          loading={providersQ.isLoading || jobsQ.isLoading}
          error={providersQ.isError || jobsQ.isError}
          onNavigate={setDestination}
        />
      )}

      {destination !== "overview" && !activePersona && (
        <CreatorOsEmptyState icon={CircleUserRound} title="Select or create a persona" description="This destination needs a current persona. Creating a draft does not start a hosted job." />
      )}

      {destination === "create" && activePersona && activeStatus && (
        <div className="space-y-3" data-testid="creator-create">
          <DestinationHeading eyebrow="Creation workspace" title={`Create with ${activePersona.name}`} description="Guided generation, advanced structured controls, PhotoShoot, Undresser, capability and cost display, template handoff, and the real gallery remain intact." />
        <PersonaWorkspace
          key={activePersona.id}
          persona={activePersona}
          status={activeStatus}
          companyId={companyId ?? ""}
        />
        </div>
      )}

      {destination === "personas" && activePersona && activeStatus && <PersonasPanel key={activePersona.id} persona={activePersona} status={activeStatus} onTrain={() => setTrainingPersona(activePersona)} />}
      {destination === "library" && activePersona && <LibraryPanel key={activePersona.id} persona={activePersona} />}
      {destination === "training" && activePersona && <TrainingPanel personas={personas} jobs={jobsQ.data?.jobs ?? []} jobsByPersona={jobsByPersona} loading={jobsQ.isLoading} error={jobsQ.isError} onTrain={setTrainingPersona} />}
      {destination === "jobs" && activePersona && <JobsPanel jobs={jobsQ.data?.jobs ?? []} personas={personas} loading={jobsQ.isLoading} error={jobsQ.isError} />}
      {companyId && operationalDestination && hasCompanyOwnedOperationalPersona && activePersona && (
        <CreatorOperationalLanes destination={destination} companyId={companyId} personaId={activePersona.id} />
      )}
      {activePersona && operationalDestination && !hasCompanyOwnedOperationalPersona && (
        <section className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-6 text-sm text-amber-100" role="status">
          Shared personas are read-only templates. Instantiate this persona for the selected company before using operational lanes.
        </section>
      )}

        </main>
      </div>

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

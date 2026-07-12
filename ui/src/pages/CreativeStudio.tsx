// Creative Studio (Fable spec 2026-07-12) — P0: Create surface (prompt bar + model picker +
// job queue/results grid) + Library + Credits, over the Higgsfield/OpenArt MCP providers
// (D1: server-side MCP client). Presets / Ad Studio / Edit / Characters land in P1–P2.
// Data honesty: unconfigured providers render amber keyed-off states — never mock output.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, ImageIcon, Film, Music, Box, RefreshCw, Star, Download, AlertTriangle, Repeat, Wand2, TrendingUp,
} from "lucide-react";
import {
  creativeStudioApi, type CreativeJob, type CreativeMode, type CreativeModel, type CreativeProviderId,
} from "../api/creativeStudio";
import { PresetsBrowser } from "../components/creative-studio/PresetsBrowser";
import { EditTools } from "../components/creative-studio/EditTools";
import { AdStudio } from "../components/creative-studio/AdStudio";
import { creativeToolsApi, type BrowseItem } from "../api/creativeTools";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";

const DS = {
  canvas: "#06090F", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", text: "#F5F8FF", textMuted: "#A3B0C2",
  textFaint: "#68758A", primary: "#3B82FF", success: "#2FE38A", critical: "#FF5B5B",
  amber: "#F4B940",
} as const;

const MONO = "'IBM Plex Mono', monospace";

const MODE_META: Record<CreativeMode, { label: string; icon: typeof ImageIcon }> = {
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: Film },
  audio: { label: "Audio", icon: Music },
  "3d": { label: "3D", icon: Box },
};

const PROVIDER_LABEL: Record<CreativeProviderId, string> = { higgsfield: "Higgsfield", openart: "OpenArt" };

function statusColor(s: CreativeJob["status"]): string {
  return s === "completed" ? DS.success : s === "failed" ? DS.critical : DS.amber;
}

export function CreativeStudio() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [surface, setSurface] = useState<"create" | "presets" | "ads" | "edit" | "library">("create");
  const [mode, setMode] = useState<CreativeMode>("image");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  // P1 reference slots: "Animate this frame" (start_image) vs "Feature this subject" (image_references)
  const [startFrameUrl, setStartFrameUrl] = useState("");
  const [subjectRefUrl, setSubjectRefUrl] = useState("");
  const [activePreset, setActivePreset] = useState<BrowseItem | null>(null);
  const [editSourceUrl, setEditSourceUrl] = useState<string | undefined>(undefined);

  useEffect(() => { setBreadcrumbs([{ label: "Creative Studio" }]); }, [setBreadcrumbs]);

  const statusQ = useQuery({
    queryKey: ["creative-status", cid],
    queryFn: () => creativeStudioApi.status(cid!),
    enabled: !!cid,
    staleTime: 60_000,
  });
  const modelsQ = useQuery({
    queryKey: ["creative-models", cid],
    queryFn: () => creativeStudioApi.models(cid!),
    enabled: !!cid && (statusQ.data?.higgsfield.configured || statusQ.data?.openart.configured) === true,
    staleTime: 300_000,
  });
  const creditsQ = useQuery({
    queryKey: ["creative-credits", cid],
    queryFn: () => creativeStudioApi.credits(cid!),
    enabled: !!cid,
    refetchInterval: 120_000,
  });
  const jobsQ = useQuery({
    queryKey: ["creative-jobs", cid],
    queryFn: () => creativeStudioApi.jobs(cid!, { limit: 60 }),
    enabled: !!cid,
    refetchInterval: 15_000,
  });

  const status = statusQ.data;
  const anyConfigured = !!(status?.higgsfield.configured || status?.openart.configured);
  const models: CreativeModel[] = modelsQ.data?.models ?? [];
  const jobs: CreativeJob[] = jobsQ.data?.jobs ?? [];

  const modelsForMode = useMemo(() => models.filter((m) => m.modes.includes(mode)), [models, mode]);
  const selectedModel = useMemo(
    () => modelsForMode.find((m) => `${m.provider}:${m.id}` === modelId) ?? null,
    [modelsForMode, modelId],
  );

  // default model per mode using D3 default provider, first available otherwise
  useEffect(() => {
    if (selectedModel) return;
    const preferred = status?.defaultProviderByMode?.[mode];
    const pick = modelsForMode.find((m) => m.provider === preferred) ?? modelsForMode[0];
    setModelId(pick ? `${pick.provider}:${pick.id}` : "");
  }, [modelsForMode, selectedModel, status, mode]);

  // poll non-terminal jobs individually (server refreshes from provider on GET)
  const activeJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");
  useQuery({
    queryKey: ["creative-jobs-poll", cid, activeJobs.map((j) => j.id).join(",")],
    queryFn: async () => {
      await Promise.allSettled(activeJobs.map((j) =>
        j.purpose === "shorts" || j.purpose === "clipper"
          ? creativeToolsApi.launcherStatus(cid!, j.id)
          : creativeStudioApi.job(cid!, j.id)));
      qc.invalidateQueries({ queryKey: ["creative-jobs", cid] });
      return true;
    },
    enabled: !!cid && activeJobs.length > 0,
    refetchInterval: 6_000,
  });

  const generateMut = useMutation({
    mutationFn: () => {
      if (!selectedModel) throw new Error("pick a model first");
      const refs: Array<{ role: string; url: string }> = [];
      if (mode === "video" && /^https?:\/\//.test(startFrameUrl)) refs.push({ role: "start_image", url: startFrameUrl });
      if (/^https?:\/\//.test(subjectRefUrl)) refs.push({ role: "image_references", url: subjectRefUrl });
      return creativeStudioApi.generate(cid!, {
        provider: selectedModel.provider, mode, model: selectedModel.id, prompt,
        refs,
        params: activePreset ? { preset_id: activePreset.id } : undefined,
      });
    },
    onSuccess: () => {
      pushToast({ title: "Generation dispatched", tone: "success" });
      qc.invalidateQueries({ queryKey: ["creative-jobs", cid] });
      qc.invalidateQueries({ queryKey: ["creative-credits", cid] });
    },
    onError: (e: any) => pushToast({ title: "Generation failed", body: String(e?.message ?? e).slice(0, 200), tone: "error" }),
  });

  const viralityMut = useMutation({
    mutationFn: (jobId: string) => creativeToolsApi.virality(cid!, jobId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["creative-jobs", cid] });
      pushToast({ title: `Virality: ${r.virality.score ?? "scored"}`, body: r.virality.summary ? String(r.virality.summary).slice(0, 160) : undefined, tone: "success" });
    },
    onError: (e: any) => pushToast({ title: "Virality scoring failed", body: String(e?.message ?? e).slice(0, 160), tone: "error" }),
  });

  const favMut = useMutation({
    mutationFn: ({ job }: { job: CreativeJob }) => creativeStudioApi.patchJob(cid!, job.id, { favorite: job.favorite !== 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["creative-jobs", cid] }),
  });

  const recreate = (job: CreativeJob) => {
    setSurface("create");
    setMode(job.mode);
    setModelId(`${job.provider}:${job.model}`);
    setPrompt(job.prompt);
  };

  const card: CSSProperties = {
    background: DS.surface, border: `1px solid rgba(255,255,255,.06)`, borderRadius: 16, padding: 24,
  };

  return (
    <div style={{ padding: 32, color: DS.text, minHeight: "100%" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={26} color={DS.primary} /> Creative Studio
          </h1>
          <div style={{ color: DS.textFaint, fontSize: 12, marginTop: 4 }}>
            Images · video · audio over Higgsfield + OpenArt — presets, Ad Studio &amp; edit tools arrive in P1–P2
          </div>
        </div>
        {/* credits (IBM Plex Mono) */}
        <div style={{ display: "flex", gap: 12 }}>
          {(["higgsfield", "openart"] as CreativeProviderId[]).map((p) => {
            const c = creditsQ.data?.credits?.[p];
            const configured = status?.[p]?.configured;
            return (
              <div key={p} style={{ ...card, padding: "10px 16px", display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: DS.textFaint }}>{PROVIDER_LABEL[p]}</span>
                <span style={{ fontFamily: MONO, fontSize: 16, color: configured && c?.balance != null ? DS.text : DS.textFaint }}>
                  {!configured ? "keyed off" : c?.balance != null ? `${c.balance} cr` : c?.error ? "—" : "…"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* keyed-off banner (amber, honest) */}
      {status && !anyConfigured && (
        <div style={{ ...card, borderColor: DS.amber, display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
          <AlertTriangle size={18} color={DS.amber} />
          <div style={{ fontSize: 13, color: DS.textMuted }}>
            No creative provider is configured yet. {status.higgsfield.keyedOffHint} {status.openart.keyedOffHint}{" "}
            Generation is disabled until a provider is keyed — nothing here is mocked.
          </div>
        </div>
      )}
      {status && anyConfigured && (!status.higgsfield.configured || !status.openart.configured) && (
        <div style={{ fontSize: 12, color: DS.amber, marginBottom: 16, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={13} />
          {!status.higgsfield.configured ? `Higgsfield keyed off — ${status.higgsfield.keyedOffHint}` : `OpenArt keyed off — ${status.openart.keyedOffHint}`}
        </div>
      )}

      {/* sub-nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {(["create", "presets", "ads", "edit", "library"] as const).map((s) => (
          <button key={s} onClick={() => setSurface(s)} style={{
            background: surface === s ? DS.surface2 : "transparent",
            color: surface === s ? DS.text : DS.textMuted,
            border: `1px solid ${surface === s ? DS.border2 : "transparent"}`,
            borderRadius: 10, padding: "8px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>
            {s === "create" ? "Create" : s === "presets" ? "Presets" : s === "ads" ? "Ad Studio" : s === "edit" ? "Edit" : "Library"}
          </button>
        ))}
      </div>

      {surface === "create" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* mode tabs + prompt bar */}
            <div style={card}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(Object.keys(MODE_META) as CreativeMode[]).map((m) => {
                  const Icon = MODE_META[m].icon;
                  const active = mode === m;
                  return (
                    <button key={m} onClick={() => { setMode(m); setModelId(""); }} style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10,
                      background: active ? "rgba(59,130,255,.12)" : DS.surface2,
                      border: `1px solid ${active ? DS.primary : DS.border}`,
                      color: active ? DS.primary : DS.textMuted, fontSize: 13, cursor: "pointer",
                    }}>
                      <Icon size={14} /> {MODE_META[m].label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={anyConfigured ? `Describe the ${MODE_META[mode].label.toLowerCase()} you want…` : "Configure a provider to enable generation"}
                disabled={!anyConfigured}
                rows={3}
                style={{
                  width: "100%", resize: "vertical", background: DS.surface2, color: DS.text,
                  border: `1px solid ${DS.border}`, borderRadius: 12, padding: 12, fontSize: 14,
                  fontFamily: "inherit", outline: "none", boxSizing: "border-box",
                }}
              />
              {(mode === "video" || mode === "image") && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  {mode === "video" && (
                    <div>
                      <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Animate this frame — exact first frame</label>
                      <input value={startFrameUrl} onChange={(e) => setStartFrameUrl(e.target.value)} placeholder="start image URL (locks framing)"
                        style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "7px 10px", fontSize: 11, outline: "none", marginTop: 4 }} />
                    </div>
                  )}
                  <div style={{ gridColumn: mode === "video" ? undefined : "1 / -1" }}>
                    <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Feature this subject — identity reference</label>
                    <input value={subjectRefUrl} onChange={(e) => setSubjectRefUrl(e.target.value)} placeholder="reference image URL (new scene, same subject)"
                      style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "7px 10px", fontSize: 11, outline: "none", marginTop: 4 }} />
                  </div>
                </div>
              )}
              {activePreset && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: DS.primary }}>
                  Preset: {activePreset.name}
                  <button onClick={() => setActivePreset(null)} style={{ background: "none", border: "none", color: DS.textFaint, cursor: "pointer", fontSize: 11 }}>✕ clear</button>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <div style={{ fontSize: 11, color: DS.textFaint }}>
                  {selectedModel ? `${PROVIDER_LABEL[selectedModel.provider]} · ${selectedModel.displayName}` : modelsQ.isLoading ? "Loading models…" : "No model available for this mode"}
                </div>
                <Button
                  onClick={() => generateMut.mutate()}
                  disabled={!anyConfigured || !selectedModel || prompt.trim() === "" || generateMut.isPending}
                >
                  {generateMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  &nbsp;Generate
                </Button>
              </div>
              {(modelsQ.data?.errors?.length ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: DS.amber, marginTop: 8 }}>
                  Partial model catalog: {modelsQ.data!.errors[0]}
                </div>
              )}
            </div>

            {/* results / job queue */}
            <JobGrid
              jobs={jobs.filter((j) => surfaceFilter(j, mode))}
              emptyText={anyConfigured ? "No generations yet — your jobs will appear here with live progress." : "Keyed off — configure a provider to start generating."}
              onRecreate={recreate}
              onFavorite={(job) => favMut.mutate({ job })}
              onEdit={(job) => { setEditSourceUrl(job.outputs[0]?.url); setSurface("edit"); }}
              onVirality={(job) => viralityMut.mutate(job.id)}
              card={card}
            />
          </div>

          {/* right rail: model picker */}
          <div style={{ ...card, alignSelf: "start" }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, color: DS.textMuted, marginBottom: 12 }}>
              Model
            </div>
            {!anyConfigured && <div style={{ fontSize: 12, color: DS.textFaint }}>Keyed off.</div>}
            {anyConfigured && modelsForMode.length === 0 && !modelsQ.isLoading && (
              <div style={{ fontSize: 12, color: DS.textFaint }}>No models for {MODE_META[mode].label} from configured providers.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
              {modelsForMode.map((m) => {
                const key = `${m.provider}:${m.id}`;
                const active = key === modelId;
                return (
                  <button key={key} onClick={() => setModelId(key)} style={{
                    textAlign: "left", padding: 10, borderRadius: 12, cursor: "pointer",
                    background: active ? "rgba(59,130,255,.10)" : DS.surface2,
                    border: `1px solid ${active ? DS.primary : DS.border}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: active ? DS.primary : DS.text }}>{m.displayName}</span>
                      <span style={{ fontSize: 10, color: DS.textFaint, border: `1px solid ${DS.border2}`, borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>
                        {PROVIDER_LABEL[m.provider]}
                      </span>
                    </div>
                    {m.description && <div style={{ fontSize: 11, color: DS.textFaint, marginTop: 4, lineHeight: 1.4 }}>{m.description.slice(0, 140)}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {surface === "presets" && (
        <PresetsBrowser
          hfConfigured={!!status?.higgsfield.configured}
          onUsePreset={(p) => {
            setActivePreset(p);
            setSurface("create");
            setMode("video");
            if (p.description && !prompt) setPrompt(p.description);
          }}
        />
      )}

      {surface === "ads" && <AdStudio hfConfigured={!!status?.higgsfield.configured} />}

      {surface === "edit" && <EditTools hfConfigured={!!status?.higgsfield.configured} initialSourceUrl={editSourceUrl} />}

      {surface === "library" && (
        <JobGrid
          jobs={jobs}
          emptyText="Library is empty — everything you generate lands here (favorites, Recreate, downloads)."
          onRecreate={recreate}
          onFavorite={(job) => favMut.mutate({ job })}
          onEdit={(job) => { setEditSourceUrl(job.outputs[0]?.url); setSurface("edit"); }}
          onVirality={(job) => viralityMut.mutate(job.id)}
          card={card}
        />
      )}
    </div>
  );
}

function surfaceFilter(j: CreativeJob, mode: CreativeMode): boolean {
  // Create surface shows current-mode jobs; terminal + active alike (most recent already sorted)
  return j.mode === mode;
}

function JobGrid({ jobs, emptyText, onRecreate, onFavorite, onEdit, onVirality, card }: {
  jobs: CreativeJob[];
  emptyText: string;
  onRecreate: (j: CreativeJob) => void;
  onFavorite: (j: CreativeJob) => void;
  onEdit?: (j: CreativeJob) => void;
  onVirality?: (j: CreativeJob) => void;
  card: CSSProperties;
}) {
  if (jobs.length === 0) {
    return <div style={{ ...card, color: DS.textFaint, fontSize: 13, textAlign: "center", padding: 40 }}>{emptyText}</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
      {jobs.map((j) => {
        const out = j.outputs[0];
        const active = j.status === "pending" || j.status === "running";
        return (
          <div key={j.id} style={{ ...card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ aspectRatio: "1 / 1", background: DS.surface2, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              {out && j.mode === "image" && <img src={out.thumbUrl ?? out.url} alt={j.prompt.slice(0, 60)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              {out && j.mode === "video" && <video src={out.url} muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />}
              {out && j.mode === "audio" && <audio src={out.url} controls style={{ width: "90%" }} />}
              {!out && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: DS.textFaint }}>
                  {active ? <RefreshCw size={20} className="animate-spin" color={DS.amber} /> : <AlertTriangle size={20} color={j.status === "failed" ? DS.critical : DS.textFaint} />}
                  <span style={{ fontSize: 11, fontFamily: MONO }}>{j.status}</span>
                </div>
              )}
              <span style={{ position: "absolute", top: 8, left: 8, fontSize: 10, fontFamily: MONO, color: statusColor(j.status), background: "rgba(6,9,15,.75)", borderRadius: 6, padding: "2px 6px" }}>
                {j.status}{j.costCredits != null ? ` · ${j.costCredits}cr` : ""}
              </span>
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 12, color: DS.textMuted, lineHeight: 1.4, minHeight: 32, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {j.prompt || <em style={{ color: DS.textFaint }}>(no prompt)</em>}
              </div>
              {j.status === "failed" && j.error && (
                <div style={{ fontSize: 10, color: DS.critical, marginTop: 6, fontFamily: MONO }}>{j.error.slice(0, 90)}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <span style={{ fontSize: 10, color: DS.textFaint, fontFamily: MONO }}>{PROVIDER_LABEL[j.provider]} · {j.model.slice(0, 18)}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <IconBtn title="Recreate — reopen with this prompt/model" onClick={() => onRecreate(j)}><Repeat size={13} /></IconBtn>
                  {onEdit && out && <IconBtn title="Edit — send to the edit tool grid" onClick={() => onEdit(j)}><Wand2 size={13} /></IconBtn>}
                  {onVirality && j.mode === "video" && j.status === "completed" && (
                    <IconBtn title={(j.params as any)?.virality ? `Virality: ${(j.params as any).virality.score ?? "?"}` : "Score virality (directional)"} onClick={() => onVirality(j)}>
                      <TrendingUp size={13} color={(j.params as any)?.virality ? "#2FE38A" : undefined} />
                    </IconBtn>
                  )}
                  <IconBtn title={j.favorite === 1 ? "Unfavorite" : "Favorite"} onClick={() => onFavorite(j)}>
                    <Star size={13} fill={j.favorite === 1 ? DS.amber : "none"} color={j.favorite === 1 ? DS.amber : DS.textMuted} />
                  </IconBtn>
                  {out && (
                    <a href={out.url} target="_blank" rel="noreferrer" title="Download / open">
                      <IconBtn title="Download / open"><Download size={13} /></IconBtn>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} style={{
      background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 8,
      padding: 5, cursor: "pointer", color: DS.textMuted, display: "inline-flex",
    }}>
      {children}
    </button>
  );
}

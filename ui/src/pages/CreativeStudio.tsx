// Creative Studio (Fable spec 2026-07-12) — Create / Presets / Ad Studio / Edit / Library
// over the Higgsfield/OpenArt MCP providers (D1: server-side MCP client).
// Design pass 2026-07-12 (Tyler review): keyed-off renders as a designed empty state
// (hero + connect card + labeled live-layout preview), density per the Influencer
// L1–L6 standards (compact header band, tight gutters, dense grids).
// Data honesty unchanged: unconfigured providers never mock output.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, ImageIcon, Film, Music, Box, RefreshCw, Star, Download, AlertTriangle,
  Repeat, Wand2, TrendingUp, Clapperboard, Plug, Inbox,
} from "lucide-react";
import {
  creativeStudioApi, type CreativeJob, type CreativeMode, type CreativeModel, type CreativeProviderId,
} from "../api/creativeStudio";
import { PresetsBrowser } from "../components/creative-studio/PresetsBrowser";
import { EditTools } from "../components/creative-studio/EditTools";
import { AdStudio } from "../components/creative-studio/AdStudio";
import { EnvChip } from "../components/creative-studio/EmptyStates";
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
const PROVIDER_ENV: Record<CreativeProviderId, string[]> = {
  higgsfield: ["HIGGSFIELD_MCP_URL", "HIGGSFIELD_MCP_TOKEN"],
  openart: ["OPENART_MCP_URL", "OPENART_MCP_TOKEN"],
};

function statusColor(s: CreativeJob["status"]): string {
  return s === "completed" ? DS.success : s === "failed" ? DS.critical : DS.amber;
}

const card: CSSProperties = {
  background: DS.surface, border: `1px solid rgba(255,255,255,.06)`, borderRadius: 16, padding: 16,
};
const sectionLabel: CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 600, color: DS.textFaint,
};
const refInput: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text,
  border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 9px", fontSize: 11,
  outline: "none", marginTop: 3,
};

export function CreativeStudio() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [surface, setSurface] = useState<"create" | "presets" | "ads" | "edit" | "library">("create");
  const [mode, setMode] = useState<CreativeMode>("image");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
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

  useEffect(() => {
    if (selectedModel) return;
    const preferred = status?.defaultProviderByMode?.[mode];
    const pick = modelsForMode.find((m) => m.provider === preferred) ?? modelsForMode[0];
    setModelId(pick ? `${pick.provider}:${pick.id}` : "");
  }, [modelsForMode, selectedModel, status, mode]);

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

  const sendToEdit = (job: CreativeJob) => { setEditSourceUrl(job.outputs[0]?.url); setSurface("edit"); };

  // ── the Create composition — reused live AND as the keyed-off preview ──────
  const createSurface = (preview: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={card}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(Object.keys(MODE_META) as CreativeMode[]).map((m) => {
              const Icon = MODE_META[m].icon;
              const active = mode === m;
              return (
                <button key={m} onClick={() => { if (!preview) { setMode(m); setModelId(""); } }} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 8,
                  background: active ? "rgba(59,130,255,.12)" : DS.surface2,
                  border: `1px solid ${active ? DS.primary : DS.border}`,
                  color: active ? DS.primary : DS.textMuted, fontSize: 12, cursor: "pointer",
                }}>
                  <Icon size={13} /> {MODE_META[m].label}
                </button>
              );
            })}
          </div>
          <textarea
            value={preview ? "" : prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Describe the ${MODE_META[mode].label.toLowerCase()} you want…`}
            disabled={preview}
            rows={3}
            style={{
              width: "100%", resize: "vertical", background: DS.surface2, color: DS.text,
              border: `1px solid ${DS.border}`, borderRadius: 10, padding: 10, fontSize: 13,
              fontFamily: "inherit", outline: "none", boxSizing: "border-box",
            }}
          />
          {(mode === "video" || mode === "image") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              {mode === "video" && (
                <div>
                  <label style={{ fontSize: 9, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Animate this frame</label>
                  <input value={preview ? "" : startFrameUrl} onChange={(e) => setStartFrameUrl(e.target.value)}
                    placeholder="start image URL — locks framing" disabled={preview} style={refInput} />
                </div>
              )}
              <div style={{ gridColumn: mode === "video" ? undefined : "1 / -1" }}>
                <label style={{ fontSize: 9, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Feature this subject</label>
                <input value={preview ? "" : subjectRefUrl} onChange={(e) => setSubjectRefUrl(e.target.value)}
                  placeholder="identity reference — new scene, same subject" disabled={preview} style={refInput} />
              </div>
            </div>
          )}
          {!preview && activePreset && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: DS.primary }}>
              Preset: {activePreset.name}
              <button onClick={() => setActivePreset(null)} style={{ background: "none", border: "none", color: DS.textFaint, cursor: "pointer", fontSize: 11 }}>✕ clear</button>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <div style={{ fontSize: 11, color: DS.textFaint }}>
              {preview
                ? "models load from your providers"
                : selectedModel ? `${PROVIDER_LABEL[selectedModel.provider]} · ${selectedModel.displayName}` : modelsQ.isLoading ? "Loading models…" : "No model available for this mode"}
            </div>
            <Button
              onClick={() => generateMut.mutate()}
              disabled={preview || !selectedModel || prompt.trim() === "" || generateMut.isPending}
            >
              {generateMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              &nbsp;Generate
            </Button>
          </div>
          {!preview && (modelsQ.data?.errors?.length ?? 0) > 0 && (
            <div style={{ fontSize: 11, color: DS.amber, marginTop: 8 }}>
              Partial model catalog: {modelsQ.data!.errors[0]}
            </div>
          )}
        </div>

        {!preview && (
          <JobGrid
            jobs={jobs.filter((j) => j.mode === mode)}
            emptyText="No generations yet — jobs land here with live progress."
            onRecreate={recreate}
            onFavorite={(job) => favMut.mutate({ job })}
            onEdit={sendToEdit}
            onVirality={(job) => viralityMut.mutate(job.id)}
          />
        )}
      </div>

      {/* model rail */}
      <div style={{ ...card, alignSelf: "start" }}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Model</div>
        {preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 44, borderRadius: 10, background: DS.surface2, border: `1px solid ${DS.border}` }} />
            ))}
            <div style={{ fontSize: 10, color: DS.textFaint, marginTop: 4 }}>Your providers' model catalogs render here.</div>
          </div>
        )}
        {!preview && modelsForMode.length === 0 && !modelsQ.isLoading && (
          <div style={{ fontSize: 11, color: DS.textFaint }}>No models for {MODE_META[mode].label} from configured providers.</div>
        )}
        {!preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "58vh", overflowY: "auto" }}>
            {modelsForMode.map((m) => {
              const key = `${m.provider}:${m.id}`;
              const active = key === modelId;
              return (
                <button key={key} onClick={() => setModelId(key)} style={{
                  textAlign: "left", padding: 8, borderRadius: 10, cursor: "pointer",
                  background: active ? "rgba(59,130,255,.10)" : DS.surface2,
                  border: `1px solid ${active ? DS.primary : DS.border}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: active ? DS.primary : DS.text }}>{m.displayName}</span>
                    <span style={{ fontSize: 9, color: DS.textFaint, border: `1px solid ${DS.border2}`, borderRadius: 5, padding: "0 5px", whiteSpace: "nowrap" }}>
                      {PROVIDER_LABEL[m.provider]}
                    </span>
                  </div>
                  {m.description && (
                    <div style={{ fontSize: 10, color: DS.textFaint, marginTop: 3, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {m.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ── keyed-off: designed empty state (hero + connect + labeled preview) ─────
  if (status && !anyConfigured) {
    return (
      <div style={{ padding: 20, color: DS.text, minHeight: "100%" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* hero */}
          <div style={{ textAlign: "center", padding: "36px 0 8px" }}>
            <div style={{
              width: 52, height: 52, margin: "0 auto 14px", borderRadius: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, rgba(59,130,255,.16), rgba(59,130,255,.04))",
              border: `1px solid ${DS.border2}`,
            }}>
              <Clapperboard size={24} color={DS.primary} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Creative Studio</h1>
            <p style={{ fontSize: 13, color: DS.textMuted, margin: "8px auto 0", maxWidth: 460, lineHeight: 1.55 }}>
              Images, video, and audio from the best models — plus camera presets, one-click
              edit tools, and a UGC ad factory — over your own Higgsfield and OpenArt accounts.
            </p>
          </div>

          {/* connect card */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Plug size={13} color={DS.primary} />
              <span style={{ fontSize: 12, fontWeight: 600, color: DS.text }}>Connect a provider</span>
              <span style={{ fontSize: 10, color: DS.textFaint, marginLeft: "auto" }}>set in the server environment · restart · this tab goes live</span>
            </div>
            {(["higgsfield", "openart"] as CreativeProviderId[]).map((p, i) => (
              <div key={p} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                borderBottom: i === 0 ? `1px solid ${DS.border}` : undefined,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: DS.critical, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: DS.text, width: 84 }}>{PROVIDER_LABEL[p]}</span>
                <span style={{ fontSize: 11, color: DS.textFaint, flex: 1 }}>
                  {p === "higgsfield" ? "video · audio · presets · edit tools · Ad Studio" : "fast image generation (Nano Banana, GPT Image, Seedream)"}
                </span>
                <span style={{ display: "flex", gap: 5 }}>
                  {PROVIDER_ENV[p].map((v) => <EnvChip key={v}>{v}</EnvChip>)}
                </span>
              </div>
            ))}
            <div style={{ padding: "9px 16px", background: DS.surface2, fontSize: 10, color: DS.textFaint }}>
              Nothing in this studio is mocked — every panel waits for real provider data.
            </div>
          </div>

          {/* labeled live-layout preview */}
          <div style={{ position: "relative", border: `1px dashed ${DS.border2}`, borderRadius: 18, padding: 12 }}>
            <span style={{
              position: "absolute", top: -9, right: 14, fontSize: 9, fontFamily: MONO,
              letterSpacing: ".08em", color: DS.textFaint, background: DS.canvas, padding: "0 8px",
              textTransform: "uppercase",
            }}>
              preview — live layout, no data
            </span>
            <div style={{ opacity: 0.45, pointerEvents: "none", userSelect: "none" }} aria-hidden>
              {createSurface(true)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── live studio ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 20, color: DS.text, minHeight: "100%" }}>
      {/* compact header band (≤52px) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, minHeight: 40 }}>
        <Clapperboard size={18} color={DS.primary} />
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Creative Studio</h1>
        <span style={{ fontSize: 11, color: DS.textFaint, borderLeft: `1px solid ${DS.border}`, paddingLeft: 12 }}>
          image · video · audio · ads
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {(["higgsfield", "openart"] as CreativeProviderId[]).map((p) => {
            const c = creditsQ.data?.credits?.[p];
            const configured = status?.[p]?.configured;
            return (
              <div key={p} title={configured ? `${PROVIDER_LABEL[p]} connected` : `${PROVIDER_LABEL[p]} keyed off — ${status?.[p]?.keyedOffHint ?? ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8,
                  background: DS.surface, border: `1px solid ${DS.border}`,
                }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: configured ? DS.success : DS.critical }} />
                <span style={{ fontSize: 10, color: DS.textMuted }}>{PROVIDER_LABEL[p]}</span>
                {configured && (
                  <span style={{ fontFamily: MONO, fontSize: 11, color: c?.balance != null ? DS.text : DS.textFaint }}>
                    {c?.balance != null ? `${c.balance}cr` : c?.error ? "—" : "…"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* sub-nav (compact) */}
      <div style={{ display: "flex", gap: 3, marginBottom: 14, alignItems: "center" }}>
        {(["create", "presets", "ads", "edit", "library"] as const).map((s) => (
          <button key={s} onClick={() => setSurface(s)} style={{
            background: surface === s ? DS.surface2 : "transparent",
            color: surface === s ? DS.text : DS.textMuted,
            border: `1px solid ${surface === s ? DS.border2 : "transparent"}`,
            borderRadius: 8, padding: "5px 13px", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>
            {s === "create" ? "Create" : s === "presets" ? "Presets" : s === "ads" ? "Ad Studio" : s === "edit" ? "Edit" : "Library"}
          </button>
        ))}
        {status && anyConfigured && (!status.higgsfield.configured || !status.openart.configured) && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: DS.amber }}>
            <AlertTriangle size={11} />
            {!status.higgsfield.configured ? "Higgsfield keyed off — video/presets/ads limited" : "OpenArt keyed off — fast image lane limited"}
          </span>
        )}
      </div>

      {surface === "create" && createSurface(false)}

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
          onEdit={sendToEdit}
          onVirality={(job) => viralityMut.mutate(job.id)}
        />
      )}
    </div>
  );
}

function JobGrid({ jobs, emptyText, onRecreate, onFavorite, onEdit, onVirality }: {
  jobs: CreativeJob[];
  emptyText: string;
  onRecreate: (j: CreativeJob) => void;
  onFavorite: (j: CreativeJob) => void;
  onEdit?: (j: CreativeJob) => void;
  onVirality?: (j: CreativeJob) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div style={{
        ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        color: DS.textFaint, fontSize: 12, textAlign: "center", padding: "24px 16px",
      }}>
        <Inbox size={18} color={DS.textFaint} />
        {emptyText}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
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
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: DS.textFaint }}>
                  {active ? <RefreshCw size={18} className="animate-spin" color={DS.amber} /> : <AlertTriangle size={18} color={j.status === "failed" ? DS.critical : DS.textFaint} />}
                  <span style={{ fontSize: 10, fontFamily: MONO }}>{j.status}</span>
                </div>
              )}
              <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontFamily: MONO, color: statusColor(j.status), background: "rgba(6,9,15,.8)", borderRadius: 5, padding: "1px 5px" }}>
                {j.status}{j.costCredits != null ? ` · ${j.costCredits}cr` : ""}
              </span>
            </div>
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 11, color: DS.textMuted, lineHeight: 1.4, minHeight: 30, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {j.prompt || <em style={{ color: DS.textFaint }}>(no prompt)</em>}
              </div>
              {j.status === "failed" && j.error && (
                <div style={{ fontSize: 9, color: DS.critical, marginTop: 4, fontFamily: MONO }}>{j.error.slice(0, 90)}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: 9, color: DS.textFaint, fontFamily: MONO }}>{PROVIDER_LABEL[j.provider]} · {j.model.slice(0, 16)}</span>
                <div style={{ display: "flex", gap: 3 }}>
                  <IconBtn title="Recreate — reopen with this prompt/model" onClick={() => onRecreate(j)}><Repeat size={12} /></IconBtn>
                  {onEdit && out && <IconBtn title="Edit — send to the edit tool grid" onClick={() => onEdit(j)}><Wand2 size={12} /></IconBtn>}
                  {onVirality && j.mode === "video" && j.status === "completed" && (
                    <IconBtn title={(j.params as any)?.virality ? `Virality: ${(j.params as any).virality.score ?? "?"}` : "Score virality (directional)"} onClick={() => onVirality(j)}>
                      <TrendingUp size={12} color={(j.params as any)?.virality ? "#2FE38A" : undefined} />
                    </IconBtn>
                  )}
                  <IconBtn title={j.favorite === 1 ? "Unfavorite" : "Favorite"} onClick={() => onFavorite(j)}>
                    <Star size={12} fill={j.favorite === 1 ? DS.amber : "none"} color={j.favorite === 1 ? DS.amber : DS.textMuted} />
                  </IconBtn>
                  {out && (
                    <a href={out.url} target="_blank" rel="noreferrer" title="Download / open">
                      <IconBtn title="Download / open"><Download size={12} /></IconBtn>
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
      background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 7,
      padding: 4, cursor: "pointer", color: DS.textMuted, display: "inline-flex",
    }}>
      {children}
    </button>
  );
}

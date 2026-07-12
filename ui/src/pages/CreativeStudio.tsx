// Creative Studio R2 (Fable, 2026-07-12) — Higgsfield-grammar layout on DS v1.0:
// left tool/mode rail · big central canvas (composer + latest showcase + gallery)
// · right compact settings rail (one-click provider switcher, models, aspect).
// Five providers behind one GenerationJob flow: Gemini (flagship — key already on
// the box), OpenAI, Replicate (Flux/SD), Higgsfield MCP, OpenArt MCP.
// Per-mode provider default persists in localStorage; override per generation.
// Data honesty: keyed-off providers are visibly disabled with their env var —
// never mocked, never hidden failures.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, ImageIcon, Film, Music, Box, RefreshCw, Star, Download, AlertTriangle,
  Repeat, Wand2, TrendingUp, Clapperboard, Plug, Inbox, LayoutGrid, Megaphone, FolderOpen,
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

const DS = {
  canvas: "#06090F", sidebar: "#080D14", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
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

const PROVIDER_ORDER: CreativeProviderId[] = ["gemini", "openai", "replicate", "higgsfield", "openart"];
const PROVIDER_ENV: Record<CreativeProviderId, string[]> = {
  gemini: ["GEMINI_API_KEY / GOOGLE_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  replicate: ["REPLICATE_API_TOKEN"],
  higgsfield: ["HIGGSFIELD_MCP_URL", "HIGGSFIELD_MCP_TOKEN"],
  openart: ["OPENART_MCP_URL", "OPENART_MCP_TOKEN"],
};
const ASPECTS: Record<CreativeMode, string[]> = {
  image: ["1:1", "16:9", "9:16", "2:3", "3:2"],
  video: ["16:9", "9:16", "1:1"],
  audio: [], "3d": [],
};

function statusColor(s: CreativeJob["status"]): string {
  return s === "completed" ? DS.success : s === "failed" ? DS.critical : DS.amber;
}

const card: CSSProperties = {
  background: DS.surface, border: "1px solid rgba(255,255,255,.06)", borderRadius: 16, padding: 14,
};
const railLabel: CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600,
  color: DS.textFaint, padding: "0 10px", marginBottom: 4,
};

type Surface = "create" | "presets" | "ads" | "edit" | "library";

function providerDefaultKey(mode: CreativeMode) { return `creative-provider-${mode}`; }

export function CreativeStudio() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [surface, setSurface] = useState<Surface>("create");
  const [mode, setMode] = useState<CreativeMode>("image");
  const [provider, setProvider] = useState<CreativeProviderId | "auto">(
    () => (typeof window !== "undefined" && (localStorage.getItem(providerDefaultKey("image")) as CreativeProviderId | null)) || "auto",
  );
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [count, setCount] = useState(1);
  const [startFrameUrl, setStartFrameUrl] = useState("");
  const [subjectRefUrl, setSubjectRefUrl] = useState("");
  const [showRefs, setShowRefs] = useState(false);
  const [activePreset, setActivePreset] = useState<BrowseItem | null>(null);
  const [editSourceUrl, setEditSourceUrl] = useState<string | undefined>(undefined);

  useEffect(() => { setBreadcrumbs([{ label: "Creative Studio" }]); }, [setBreadcrumbs]);

  // persist per-mode provider default; restore on mode switch
  const pickMode = (m: CreativeMode) => {
    setMode(m);
    setModelId("");
    setAspect(ASPECTS[m][0] ?? "1:1");
    const saved = (localStorage.getItem(providerDefaultKey(m)) as CreativeProviderId | null) || "auto";
    setProvider(saved);
    setSurface("create");
  };
  const pickProvider = (p: CreativeProviderId | "auto") => {
    setProvider(p);
    setModelId("");
    localStorage.setItem(providerDefaultKey(mode), p);
  };

  const statusQ = useQuery({ queryKey: ["creative-status", cid], queryFn: () => creativeStudioApi.status(cid!), enabled: !!cid, staleTime: 60_000 });
  const modelsQ = useQuery({ queryKey: ["creative-models", cid], queryFn: () => creativeStudioApi.models(cid!), enabled: !!cid, staleTime: 300_000 });
  const creditsQ = useQuery({ queryKey: ["creative-credits", cid], queryFn: () => creativeStudioApi.credits(cid!), enabled: !!cid, refetchInterval: 120_000 });
  const jobsQ = useQuery({ queryKey: ["creative-jobs", cid], queryFn: () => creativeStudioApi.jobs(cid!, { limit: 80 }), enabled: !!cid, refetchInterval: 15_000 });

  const status = statusQ.data;
  const configuredIds = PROVIDER_ORDER.filter((p) => status?.[p]?.configured);
  const anyConfigured = configuredIds.length > 0;
  const jobs: CreativeJob[] = jobsQ.data?.jobs ?? [];
  const models: CreativeModel[] = modelsQ.data?.models ?? [];

  const effectiveProvider: CreativeProviderId | null = useMemo(() => {
    if (provider !== "auto") return status?.[provider]?.configured ? provider : null;
    const preferred = status?.defaultProviderByMode?.[mode];
    if (preferred && status?.[preferred]?.configured) return preferred;
    const firstWithMode = configuredIds.find((p) => models.some((m) => m.provider === p && m.modes.includes(mode)));
    return firstWithMode ?? configuredIds[0] ?? null;
  }, [provider, status, mode, configuredIds, models]);

  const modelsForPick = useMemo(
    () => models.filter((m) => m.modes.includes(mode) && (provider === "auto" ? true : m.provider === provider)),
    [models, mode, provider],
  );
  const selectedModel = useMemo(
    () => modelsForPick.find((m) => `${m.provider}:${m.id}` === modelId)
      ?? modelsForPick.find((m) => m.provider === effectiveProvider)
      ?? modelsForPick[0]
      ?? null,
    [modelsForPick, modelId, effectiveProvider],
  );

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
      const params: Record<string, unknown> = {};
      if (ASPECTS[mode].length > 0) params.aspect_ratio = aspect;
      if (mode === "image" && count > 1) params.count = count;
      if (activePreset) params.preset_id = activePreset.id;
      return creativeStudioApi.generate(cid!, {
        provider: selectedModel.provider, mode, model: selectedModel.id, prompt, refs, params,
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
    if (PROVIDER_ORDER.includes(job.provider)) pickProvider(job.provider);
    setModelId(`${job.provider}:${job.model}`);
    setPrompt(job.prompt);
  };
  const sendToEdit = (job: CreativeJob) => { setEditSourceUrl(job.outputs[0]?.url); setSurface("edit"); };

  const modeJobs = jobs.filter((j) => j.mode === mode);
  const latest = modeJobs.find((j) => j.status === "completed" && j.outputs[0]);

  // ── all-keyed-off: designed hero (unchanged honesty, Gemini leads) ──────────
  if (status && !anyConfigured) {
    return (
      <div style={{ padding: 20, color: DS.text, minHeight: "100%" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, paddingTop: 40 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, margin: "0 auto 14px", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(59,130,255,.16), rgba(59,130,255,.04))", border: `1px solid ${DS.border2}` }}>
              <Clapperboard size={24} color={DS.primary} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Creative Studio</h1>
            <p style={{ fontSize: 13, color: DS.textMuted, margin: "8px auto 0", maxWidth: 480, lineHeight: 1.55 }}>
              Images, video, and audio from Gemini, OpenAI, Replicate (Flux), Higgsfield, and OpenArt — one studio, one library, switch providers in a click.
            </p>
          </div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Plug size={13} color={DS.primary} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Connect a provider</span>
              <span style={{ fontSize: 10, color: DS.textFaint, marginLeft: "auto" }}>Gemini works with the GOOGLE_API_KEY already on this box</span>
            </div>
            {PROVIDER_ORDER.map((p, i) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < PROVIDER_ORDER.length - 1 ? `1px solid ${DS.border}` : undefined }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: DS.critical, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, width: 82 }}>{status?.[p]?.label ?? p}</span>
                <span style={{ fontSize: 11, color: DS.textFaint, flex: 1 }}>{status?.[p]?.capabilities ?? ""}</span>
                <span style={{ display: "flex", gap: 5 }}>{PROVIDER_ENV[p].map((v) => <EnvChip key={v}>{v}</EnvChip>)}</span>
              </div>
            ))}
            <div style={{ padding: "9px 16px", background: DS.surface2, fontSize: 10, color: DS.textFaint }}>
              Nothing in this studio is mocked — every panel waits for real provider data.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const navItem = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
    padding: "7px 10px", borderRadius: 9, cursor: "pointer", border: "none",
    background: active ? "rgba(59,130,255,.10)" : "transparent",
    color: active ? DS.primary : DS.textMuted, fontSize: 12.5, fontWeight: 500,
  });

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, color: DS.text, background: DS.canvas }}>
      {/* ── left rail: modes + tools (Higgsfield grammar) ── */}
      <aside style={{ width: 176, flexShrink: 0, borderRight: `1px solid ${DS.border}`, padding: "14px 8px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
          <Clapperboard size={16} color={DS.primary} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Creative Studio</span>
        </div>
        <div>
          <div style={railLabel}>Create</div>
          {(Object.keys(MODE_META) as CreativeMode[]).map((m) => {
            const Icon = MODE_META[m].icon;
            return (
              <button key={m} style={navItem(surface === "create" && mode === m)} onClick={() => pickMode(m)}>
                <Icon size={14} /> {MODE_META[m].label}
              </button>
            );
          })}
        </div>
        <div>
          <div style={railLabel}>Tools</div>
          <button style={navItem(surface === "presets")} onClick={() => setSurface("presets")}><LayoutGrid size={14} /> Presets</button>
          <button style={navItem(surface === "edit")} onClick={() => setSurface("edit")}><Wand2 size={14} /> Edit</button>
          <button style={navItem(surface === "ads")} onClick={() => setSurface("ads")}><Megaphone size={14} /> Ad Studio</button>
        </div>
        <div>
          <div style={railLabel}>Assets</div>
          <button style={navItem(surface === "library")} onClick={() => setSurface("library")}><FolderOpen size={14} /> Library</button>
        </div>
        {/* provider dots — compact status, click jumps to settings rail */}
        <div style={{ marginTop: "auto", padding: "8px 10px", borderTop: `1px solid ${DS.border}` }}>
          <div style={{ ...railLabel, padding: 0 }}>Providers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {PROVIDER_ORDER.map((p) => (
              <div key={p} title={status?.[p]?.configured ? `${status?.[p]?.label} connected` : `${status?.[p]?.label} keyed off — ${status?.[p]?.keyedOffHint}`}
                style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: status?.[p]?.configured ? DS.success : DS.border2 }} />
                <span style={{ fontSize: 10, color: status?.[p]?.configured ? DS.textMuted : DS.textFaint }}>{status?.[p]?.label ?? p}</span>
                {status?.[p]?.configured && creditsQ.data?.credits?.[p]?.balance != null && (
                  <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9, color: DS.textFaint }}>{creditsQ.data.credits[p].balance}cr</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── center canvas ── */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 18 }}>
        {surface === "create" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto" }}>
            {/* composer */}
            <div style={{ ...card, padding: 16 }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Describe the ${MODE_META[mode].label.toLowerCase()} you want to create…`}
                rows={3}
                style={{ width: "100%", resize: "vertical", background: "transparent", color: DS.text, border: "none", padding: 0, fontSize: 15, lineHeight: 1.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
              />
              {showRefs && (mode === "video" || mode === "image") && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  {mode === "video" && (
                    <div>
                      <label style={{ fontSize: 9, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Animate this frame</label>
                      <input value={startFrameUrl} onChange={(e) => setStartFrameUrl(e.target.value)} placeholder="start image URL — locks framing"
                        style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 9px", fontSize: 11, outline: "none", marginTop: 3 }} />
                    </div>
                  )}
                  <div style={{ gridColumn: mode === "video" ? undefined : "1 / -1" }}>
                    <label style={{ fontSize: 9, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Feature this subject</label>
                    <input value={subjectRefUrl} onChange={(e) => setSubjectRefUrl(e.target.value)} placeholder="identity reference — new scene, same subject"
                      style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 9px", fontSize: 11, outline: "none", marginTop: 3 }} />
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, borderTop: `1px solid ${DS.border}`, paddingTop: 12 }}>
                {(mode === "image" || mode === "video") && (
                  <button onClick={() => setShowRefs(!showRefs)} style={{ background: showRefs ? "rgba(59,130,255,.10)" : DS.surface2, border: `1px solid ${showRefs ? DS.primary : DS.border}`, borderRadius: 8, color: showRefs ? DS.primary : DS.textMuted, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
                    + refs
                  </button>
                )}
                {activePreset && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: DS.primary }}>
                    {activePreset.name}
                    <button onClick={() => setActivePreset(null)} style={{ background: "none", border: "none", color: DS.textFaint, cursor: "pointer", fontSize: 11 }}>✕</button>
                  </span>
                )}
                <span style={{ fontSize: 11, color: DS.textFaint, marginLeft: "auto" }}>
                  {selectedModel ? `${status?.[selectedModel.provider]?.label ?? selectedModel.provider} · ${selectedModel.displayName}` : modelsQ.isLoading ? "loading models…" : "no model for this mode"}
                </span>
                <button
                  onClick={() => generateMut.mutate()}
                  disabled={!selectedModel || prompt.trim() === "" || generateMut.isPending}
                  style={{ display: "flex", alignItems: "center", gap: 7, background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 600, padding: "9px 22px", cursor: "pointer", opacity: !selectedModel || prompt.trim() === "" || generateMut.isPending ? 0.4 : 1 }}>
                  {generateMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
                </button>
              </div>
            </div>

            {/* latest showcase */}
            {latest && latest.outputs[0] && (
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <div style={{ maxHeight: 440, display: "flex", alignItems: "center", justifyContent: "center", background: DS.surface2 }}>
                  {latest.mode === "image" && <img src={latest.outputs[0].url} style={{ maxWidth: "100%", maxHeight: 440, objectFit: "contain" }} />}
                  {latest.mode === "video" && <video src={latest.outputs[0].url} controls autoPlay muted loop style={{ maxWidth: "100%", maxHeight: 440 }} />}
                  {latest.mode === "audio" && <audio src={latest.outputs[0].url} controls style={{ width: "80%", margin: "40px 0" }} />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
                  <span style={{ fontSize: 11, color: DS.textMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latest.prompt}</span>
                  <span style={{ fontSize: 9, fontFamily: MONO, color: DS.textFaint }}>{status?.[latest.provider]?.label ?? latest.provider} · {latest.model.slice(0, 22)}</span>
                  <IconBtn title="Recreate" onClick={() => recreate(latest)}><Repeat size={12} /></IconBtn>
                  <IconBtn title="Edit" onClick={() => sendToEdit(latest)}><Wand2 size={12} /></IconBtn>
                  <a href={latest.outputs[0].url} target="_blank" rel="noreferrer"><IconBtn title="Download / open"><Download size={12} /></IconBtn></a>
                </div>
              </div>
            )}

            {/* recent gallery */}
            <div>
              <div style={{ ...railLabel, padding: 0, marginBottom: 8 }}>Recent {MODE_META[mode].label.toLowerCase()}</div>
              <JobGrid
                jobs={modeJobs.filter((j) => j !== latest)}
                emptyText={latest ? "Older generations land here." : "No generations yet — your first result renders large, right here."}
                onRecreate={recreate}
                onFavorite={(job) => favMut.mutate({ job })}
                onEdit={sendToEdit}
                onVirality={(job) => viralityMut.mutate(job.id)}
                dense
              />
            </div>
          </div>
        )}

        {surface === "presets" && (
          <PresetsBrowser
            hfConfigured={!!status?.higgsfield.configured}
            onUsePreset={(p) => { setActivePreset(p); setSurface("create"); setMode("video"); if (p.description && !prompt) setPrompt(p.description); }}
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
      </main>

      {/* ── right settings rail (create only) ── */}
      {surface === "create" && (
        <aside style={{ width: 252, flexShrink: 0, borderLeft: `1px solid ${DS.border}`, padding: 14, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          <div>
            <div style={{ ...railLabel, padding: 0, marginBottom: 6 }}>Provider</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={() => pickProvider("auto")} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 8, cursor: "pointer",
                background: provider === "auto" ? "rgba(59,130,255,.10)" : DS.surface2,
                border: `1px solid ${provider === "auto" ? DS.primary : DS.border}`,
                color: provider === "auto" ? DS.primary : DS.textMuted, fontSize: 11.5, fontWeight: 500,
              }}>
                <Sparkles size={12} /> Auto
                <span style={{ marginLeft: "auto", fontSize: 9, color: DS.textFaint }}>best for {MODE_META[mode].label.toLowerCase()}</span>
              </button>
              {PROVIDER_ORDER.map((p) => {
                const st = status?.[p];
                const on = !!st?.configured;
                const active = provider === p;
                const hasMode = models.some((m) => m.provider === p && m.modes.includes(mode));
                return (
                  <button key={p} onClick={() => on && pickProvider(p)} disabled={!on}
                    title={on ? st?.capabilities : `Keyed off — ${st?.keyedOffHint ?? ""}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 8,
                      cursor: on ? "pointer" : "not-allowed",
                      background: active ? "rgba(59,130,255,.10)" : DS.surface2,
                      border: `1px solid ${active ? DS.primary : DS.border}`,
                      color: !on ? DS.textFaint : active ? DS.primary : DS.textMuted,
                      fontSize: 11.5, fontWeight: 500, opacity: on ? 1 : 0.55,
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: on ? DS.success : DS.border2 }} />
                    {st?.label ?? p}
                    {on && !hasMode && <span style={{ marginLeft: "auto", fontSize: 8.5, color: DS.textFaint }}>no {mode}</span>}
                    {!on && <span style={{ marginLeft: "auto", fontSize: 8.5 }}>keyed off</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ ...railLabel, padding: 0, marginBottom: 6 }}>Model</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "34vh", overflowY: "auto" }}>
              {modelsForPick.length === 0 && !modelsQ.isLoading && (
                <div style={{ fontSize: 11, color: DS.textFaint }}>No {MODE_META[mode].label.toLowerCase()} models on {provider === "auto" ? "any configured provider" : status?.[provider]?.label}.</div>
              )}
              {modelsForPick.map((m) => {
                const key = `${m.provider}:${m.id}`;
                const active = selectedModel ? `${selectedModel.provider}:${selectedModel.id}` === key : false;
                return (
                  <button key={key} onClick={() => setModelId(key)} style={{
                    textAlign: "left", padding: 8, borderRadius: 9, cursor: "pointer",
                    background: active ? "rgba(59,130,255,.10)" : DS.surface2,
                    border: `1px solid ${active ? DS.primary : DS.border}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: active ? DS.primary : DS.text }}>{m.displayName}</span>
                      {provider === "auto" && <span style={{ fontSize: 8.5, color: DS.textFaint }}>{status?.[m.provider]?.label ?? m.provider}</span>}
                    </div>
                    {m.description && <div style={{ fontSize: 9.5, color: DS.textFaint, marginTop: 2, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{m.description}</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {ASPECTS[mode].length > 0 && (
            <div>
              <div style={{ ...railLabel, padding: 0, marginBottom: 6 }}>Aspect</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {ASPECTS[mode].map((a) => (
                  <button key={a} onClick={() => setAspect(a)} style={{
                    background: aspect === a ? "rgba(59,130,255,.10)" : DS.surface2,
                    border: `1px solid ${aspect === a ? DS.primary : DS.border}`,
                    borderRadius: 7, color: aspect === a ? DS.primary : DS.textMuted,
                    fontSize: 10.5, fontFamily: MONO, padding: "4px 9px", cursor: "pointer",
                  }}>{a}</button>
                ))}
              </div>
            </div>
          )}

          {mode === "image" && (
            <div>
              <div style={{ ...railLabel, padding: 0, marginBottom: 6 }}>Count</div>
              <div style={{ display: "flex", gap: 5 }}>
                {[1, 2, 4].map((n) => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    background: count === n ? "rgba(59,130,255,.10)" : DS.surface2,
                    border: `1px solid ${count === n ? DS.primary : DS.border}`,
                    borderRadius: 7, color: count === n ? DS.primary : DS.textMuted,
                    fontSize: 10.5, fontFamily: MONO, padding: "4px 11px", cursor: "pointer",
                  }}>{n}</button>
                ))}
              </div>
            </div>
          )}

          {/* compact connect block for anything keyed off — settings surface, not hero */}
          {PROVIDER_ORDER.some((p) => !status?.[p]?.configured) && (
            <div style={{ borderTop: `1px solid ${DS.border}`, paddingTop: 10 }}>
              <div style={{ ...railLabel, padding: 0, marginBottom: 6 }}>Connect more</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {PROVIDER_ORDER.filter((p) => !status?.[p]?.configured).map((p) => (
                  <div key={p} style={{ fontSize: 10, color: DS.textFaint, lineHeight: 1.5 }}>
                    <span style={{ color: DS.textMuted, fontWeight: 600 }}>{status?.[p]?.label ?? p}</span>
                    {" — "}{PROVIDER_ENV[p].map((v, i) => <span key={v}>{i > 0 && " + "}<EnvChip>{v}</EnvChip></span>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function JobGrid({ jobs, emptyText, onRecreate, onFavorite, onEdit, onVirality, dense }: {
  jobs: CreativeJob[];
  emptyText: string;
  onRecreate: (j: CreativeJob) => void;
  onFavorite: (j: CreativeJob) => void;
  onEdit?: (j: CreativeJob) => void;
  onVirality?: (j: CreativeJob) => void;
  dense?: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: DS.textFaint, fontSize: 12, textAlign: "center", padding: "22px 14px" }}>
        <Inbox size={17} color={DS.textFaint} />
        {emptyText}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${dense ? 150 : 190}px, 1fr))`, gap: 10 }}>
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
                  {active ? <RefreshCw size={17} className="animate-spin" color={DS.amber} /> : <AlertTriangle size={17} color={j.status === "failed" ? DS.critical : DS.textFaint} />}
                  <span style={{ fontSize: 10, fontFamily: MONO }}>{j.status}</span>
                </div>
              )}
              <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontFamily: MONO, color: statusColor(j.status), background: "rgba(6,9,15,.8)", borderRadius: 5, padding: "1px 5px" }}>
                {j.status}{j.costCredits != null ? ` · ${j.costCredits}cr` : ""}
              </span>
            </div>
            <div style={{ padding: 9 }}>
              <div style={{ fontSize: 10.5, color: DS.textMuted, lineHeight: 1.4, minHeight: 28, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {j.prompt || <em style={{ color: DS.textFaint }}>(no prompt)</em>}
              </div>
              {j.status === "failed" && j.error && (
                <div style={{ fontSize: 9, color: DS.critical, marginTop: 4, fontFamily: MONO }}>{j.error.slice(0, 80)}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
                <span style={{ fontSize: 8.5, color: DS.textFaint, fontFamily: MONO }}>{j.provider} · {j.model.split("/").pop()?.slice(0, 14)}</span>
                <div style={{ display: "flex", gap: 3 }}>
                  <IconBtn title="Recreate" onClick={() => onRecreate(j)}><Repeat size={11} /></IconBtn>
                  {onEdit && out && <IconBtn title="Edit" onClick={() => onEdit(j)}><Wand2 size={11} /></IconBtn>}
                  {onVirality && j.mode === "video" && j.status === "completed" && (
                    <IconBtn title={(j.params as any)?.virality ? `Virality: ${(j.params as any).virality.score ?? "?"}` : "Score virality (directional)"} onClick={() => onVirality(j)}>
                      <TrendingUp size={11} color={(j.params as any)?.virality ? "#2FE38A" : undefined} />
                    </IconBtn>
                  )}
                  <IconBtn title={j.favorite === 1 ? "Unfavorite" : "Favorite"} onClick={() => onFavorite(j)}>
                    <Star size={11} fill={j.favorite === 1 ? DS.amber : "none"} color={j.favorite === 1 ? DS.amber : DS.textMuted} />
                  </IconBtn>
                  {out && (
                    <a href={out.url} target="_blank" rel="noreferrer" title="Download / open">
                      <IconBtn title="Download / open"><Download size={11} /></IconBtn>
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

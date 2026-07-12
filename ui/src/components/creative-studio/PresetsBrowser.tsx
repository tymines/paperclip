// Creative Studio P1 — presets browser (spec §3.2 P1): card grid with looping
// previews, one click → Create pre-configured. P2 adds the Explainer / Shorts /
// Clipper launchers at the top. Preset catalog is runtime-fetched from the
// Higgsfield MCP (presets_show) — never hardcoded.
import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Youtube, Presentation, Scissors, RefreshCw, AlertTriangle, LayoutGrid } from "lucide-react";
import { SurfaceKeyedOff } from "./EmptyStates";
import { creativeToolsApi, type BrowseItem } from "../../api/creativeTools";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";

const DS = {
  surface: "#0D131D", surface2: "#111926", border: "#1C2635", border2: "#263246",
  text: "#F5F8FF", textMuted: "#A3B0C2", textFaint: "#68758A", primary: "#3B82FF",
  amber: "#F4B940",
} as const;

const card: CSSProperties = {
  background: DS.surface, border: "1px solid rgba(255,255,255,.06)", borderRadius: 16, padding: 14,
};

export function PresetsBrowser({ hfConfigured, onUsePreset }: {
  hfConfigured: boolean;
  onUsePreset: (preset: BrowseItem) => void;
}) {
  const { selectedCompanyId: cid } = useCompany();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>("");

  const presetsQ = useQuery({
    queryKey: ["creative-presets", cid, category],
    queryFn: () => creativeToolsApi.presets(cid!, category || undefined),
    enabled: !!cid && hfConfigured,
    staleTime: 300_000,
  });

  // launchers
  const [explainerPrompt, setExplainerPrompt] = useState("");
  const [shortsPrompt, setShortsPrompt] = useState("");
  const [clipperUrl, setClipperUrl] = useState("");
  const onDone = (title: string) => () => {
    pushToast({ title, tone: "success" });
    qc.invalidateQueries({ queryKey: ["creative-jobs", cid] });
  };
  const onErr = (e: any) => pushToast({ title: "Dispatch failed", body: String(e?.message ?? e).slice(0, 180), tone: "error" });
  const explainerMut = useMutation({ mutationFn: () => creativeToolsApi.explainer(cid!, { prompt: explainerPrompt }), onSuccess: onDone("Explainer dispatched"), onError: onErr });
  const shortsMut = useMutation({ mutationFn: () => creativeToolsApi.shorts(cid!, { prompt: shortsPrompt }), onSuccess: onDone("Shorts session dispatched"), onError: onErr });
  const clipperMut = useMutation({ mutationFn: () => creativeToolsApi.clipper(cid!, { youtubeUrl: clipperUrl }), onSuccess: onDone("Clipper dispatched"), onError: onErr });

  const items = presetsQ.data?.items ?? [];
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean)));
  const inputStyle: CSSProperties = {
    flex: 1, background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`,
    borderRadius: 10, padding: "8px 10px", fontSize: 12, outline: "none",
  };

  if (!hfConfigured) {
    return (
      <SurfaceKeyedOff
        icon={<LayoutGrid size={18} />}
        title="Presets & Launchers"
        promise="Sixty-plus cinematic camera moves, viral VFX scenarios, and one-line launchers for explainers, shorts, and YouTube clipping — browsed live from your Higgsfield account."
        envVars={["HIGGSFIELD_MCP_URL", "HIGGSFIELD_MCP_TOKEN"]}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* launchers (P2) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 600, color: DS.text }}>
            <Presentation size={14} color={DS.primary} /> Explainer
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={explainerPrompt} onChange={(e) => setExplainerPrompt(e.target.value)} placeholder="What should the explainer explain?" />
            <button onClick={() => explainerMut.mutate()} disabled={!explainerPrompt.trim() || explainerMut.isPending}
              style={{ background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 12, padding: "8px 14px", cursor: "pointer", opacity: !explainerPrompt.trim() || explainerMut.isPending ? 0.4 : 1 }}>
              {explainerMut.isPending ? "…" : "Go"}
            </button>
          </div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 600, color: DS.text }}>
            <Scissors size={14} color={DS.primary} /> Shorts Studio
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={shortsPrompt} onChange={(e) => setShortsPrompt(e.target.value)} placeholder="Vertical short concept / style…" />
            <button onClick={() => shortsMut.mutate()} disabled={!shortsPrompt.trim() || shortsMut.isPending}
              style={{ background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 12, padding: "8px 14px", cursor: "pointer", opacity: !shortsPrompt.trim() || shortsMut.isPending ? 0.4 : 1 }}>
              {shortsMut.isPending ? "…" : "Go"}
            </button>
          </div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 600, color: DS.text }}>
            <Youtube size={14} color={DS.primary} /> Clipper
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={clipperUrl} onChange={(e) => setClipperUrl(e.target.value)} placeholder="YouTube URL → vertical clips" />
            <button onClick={() => clipperMut.mutate()} disabled={!/^https?:\/\//.test(clipperUrl) || clipperMut.isPending}
              style={{ background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 12, padding: "8px 14px", cursor: "pointer", opacity: !/^https?:\/\//.test(clipperUrl) || clipperMut.isPending ? 0.4 : 1 }}>
              {clipperMut.isPending ? "…" : "Go"}
            </button>
          </div>
        </div>
      </div>

      {/* preset grid (P1) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, color: DS.textMuted }}>Presets</span>
          <button onClick={() => setCategory("")} style={{ background: category === "" ? "rgba(59,130,255,.12)" : DS.surface2, border: `1px solid ${category === "" ? DS.primary : DS.border}`, borderRadius: 8, color: category === "" ? DS.primary : DS.textMuted, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>All</button>
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} style={{ background: category === c ? "rgba(59,130,255,.12)" : DS.surface2, border: `1px solid ${category === c ? DS.primary : DS.border}`, borderRadius: 8, color: category === c ? DS.primary : DS.textMuted, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>{c}</button>
          ))}
          {presetsQ.isFetching && <RefreshCw size={12} className="animate-spin" style={{ color: DS.textFaint }} />}
        </div>
        {presetsQ.isError && (
          <div style={{ fontSize: 12, color: DS.amber, display: "flex", gap: 6, alignItems: "center" }}>
            <AlertTriangle size={13} /> Preset catalog unavailable: {String((presetsQ.error as any)?.message ?? "provider error").slice(0, 140)}
          </div>
        )}
        {items.length === 0 && !presetsQ.isFetching && !presetsQ.isError && (
          <div style={{ fontSize: 12, color: DS.textFaint }}>No presets returned by the provider for this filter.</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {items.map((p) => (
            <button key={`${p.category}:${p.id}`} onClick={() => onUsePreset(p)} title={p.description}
              style={{ textAlign: "left", background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", padding: 0 }}>
              <div style={{ aspectRatio: "16 / 10", background: "#0A0F17", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {p.previewUrl
                  ? (/\.(mp4|webm)(\?|$)/i.test(p.previewUrl)
                    ? <video src={p.previewUrl} muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
                    : <img src={p.previewUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />)
                  : <span style={{ fontSize: 10, color: DS.textFaint }}>no preview</span>}
              </div>
              <div style={{ padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: DS.text }}>{p.name}</div>
                {p.category && <div style={{ fontSize: 10, color: DS.textFaint, marginTop: 2 }}>{p.category}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

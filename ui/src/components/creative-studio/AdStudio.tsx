// Creative Studio P2 — Ad Studio (spec §3.3): brand kits, product URL → format ×
// hook × setting batch matrix with the D6 spend-confirm threshold, ad-reference
// analyze-and-recreate, and the ad-manager-style variant grid with virality scoring.
import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, AlertTriangle, RefreshCw, TrendingUp, Repeat } from "lucide-react";
import { adStudioApi, creativeToolsApi, AD_FORMATS, type BatchEstimate, type BatchResult } from "../../api/creativeTools";
import { creativeStudioApi, type CreativeJob, type CreativeModel } from "../../api/creativeStudio";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";

const DS = {
  surface: "#0D131D", surface2: "#111926", border: "#1C2635", text: "#F5F8FF",
  textMuted: "#A3B0C2", textFaint: "#68758A", primary: "#3B82FF", amber: "#F4B940",
  success: "#2FE38A", critical: "#FF5B5B",
} as const;
const MONO = "'IBM Plex Mono', monospace";
const card: CSSProperties = { background: DS.surface, border: "1px solid rgba(255,255,255,.06)", borderRadius: 16, padding: 20 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, outline: "none" };

export function AdStudio({ hfConfigured }: { hfConfigured: boolean }) {
  const { selectedCompanyId: cid } = useCompany();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [productUrl, setProductUrl] = useState("");
  const [kitId, setKitId] = useState("");
  const [model, setModel] = useState("");
  const [formats, setFormats] = useState<string[]>(["UGC"]);
  const [hooks, setHooks] = useState("");
  const [settings, setSettings] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [refJobId, setRefJobId] = useState("");
  const [estimate, setEstimate] = useState<BatchEstimate["estimate"] | null>(null);
  const [openBatchId, setOpenBatchId] = useState("");
  const [kitName, setKitName] = useState("");

  const kitsQ = useQuery({ queryKey: ["ad-brand-kits", cid], queryFn: () => adStudioApi.brandKits(cid!), enabled: !!cid && hfConfigured });
  const modelsQ = useQuery({ queryKey: ["creative-models", cid], queryFn: () => creativeStudioApi.models(cid!), enabled: !!cid && hfConfigured, staleTime: 300_000 });
  const charsQ = useQuery({ queryKey: ["creative-characters", cid], queryFn: () => creativeToolsApi.characters(cid!), enabled: !!cid && hfConfigured, retry: false });
  const batchesQ = useQuery({ queryKey: ["ad-batches", cid], queryFn: () => adStudioApi.batches(cid!), enabled: !!cid && hfConfigured, refetchInterval: 15_000 });
  const batchQ = useQuery({
    queryKey: ["ad-batch", cid, openBatchId],
    queryFn: () => adStudioApi.batch(cid!, openBatchId),
    enabled: !!cid && !!openBatchId,
    refetchInterval: 10_000,
  });

  const videoModels: CreativeModel[] = (modelsQ.data?.models ?? []).filter((m) => m.provider === "higgsfield" && m.modes.includes("video"));
  const onErr = (e: any) => pushToast({ title: "Request failed", body: String(e?.message ?? e).slice(0, 180), tone: "error" });

  const kitMut = useMutation({
    mutationFn: () => adStudioApi.createBrandKit(cid!, { name: kitName, productUrl: productUrl || undefined }),
    onSuccess: (r) => { setKitId(r.brandKit.id); setKitName(""); qc.invalidateQueries({ queryKey: ["ad-brand-kits", cid] }); pushToast({ title: "Brand kit saved", tone: "success" }); },
    onError: onErr,
  });
  const refMut = useMutation({
    mutationFn: () => adStudioApi.adReference(cid!, refUrl),
    onSuccess: (r) => { setRefJobId(r.job.id); pushToast({ title: "Ad reference analyzing…", tone: "success" }); },
    onError: onErr,
  });
  const refPollMut = useMutation({ mutationFn: () => adStudioApi.adReferenceRefresh(cid!, refJobId) });

  const batchMut = useMutation({
    mutationFn: (confirm: boolean) => adStudioApi.createBatch(cid!, {
      model, formats,
      hooks: hooks.split(",").map((s) => s.trim()).filter(Boolean),
      settings: settings.split(",").map((s) => s.trim()).filter(Boolean),
      brandKitId: kitId || undefined, productUrl: productUrl || undefined,
      characterId: characterId || undefined, adReferenceJobId: refJobId || undefined,
      confirm,
    }),
    onSuccess: (r) => {
      if ((r as BatchEstimate).requiresConfirm) {
        setEstimate((r as BatchEstimate).estimate);
      } else {
        setEstimate(null);
        setOpenBatchId((r as BatchResult).batchId);
        pushToast({ title: `Batch dispatched (${(r as BatchResult).jobs.length} variants)`, tone: "success" });
        qc.invalidateQueries({ queryKey: ["ad-batches", cid] });
        qc.invalidateQueries({ queryKey: ["creative-credits", cid] });
      }
    },
    onError: onErr,
  });
  const viralityMut = useMutation({
    mutationFn: (jobId: string) => creativeToolsApi.virality(cid!, jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ad-batch", cid, openBatchId] }),
    onError: onErr,
  });

  if (!hfConfigured) {
    return (
      <div style={{ ...card, borderColor: DS.amber, display: "flex", gap: 10, alignItems: "center" }}>
        <AlertTriangle size={16} color={DS.amber} />
        <span style={{ fontSize: 13, color: DS.textMuted }}>Ad Studio runs on the Higgsfield MCP — keyed off (HIGGSFIELD_MCP_URL). Nothing here is mocked.</span>
      </div>
    );
  }

  const variants = batchQ.data?.variants ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px minmax(0,1fr)", gap: 24, alignItems: "start" }}>
      {/* wizard */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 600, color: DS.text }}>
            <Megaphone size={14} color={DS.primary} /> New ad batch
          </div>
          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Product URL</label>
          <input style={{ ...input, margin: "4px 0 10px" }} value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://…" />

          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Brand kit</label>
          <select style={{ ...input, margin: "4px 0 6px" }} value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">No brand kit</option>
            {(kitsQ.data?.brandKits ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input style={input} value={kitName} onChange={(e) => setKitName(e.target.value)} placeholder="New kit name…" />
            <button onClick={() => kitMut.mutate()} disabled={!kitName.trim() || kitMut.isPending}
              style={{ background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 10, color: DS.textMuted, fontSize: 11, padding: "0 12px", cursor: "pointer" }}>Save</button>
          </div>

          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Formats ({formats.length})</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 10px" }}>
            {AD_FORMATS.map((f) => {
              const on = formats.includes(f);
              return (
                <button key={f} onClick={() => setFormats(on ? formats.filter((x) => x !== f) : [...formats, f])}
                  style={{ background: on ? "rgba(59,130,255,.12)" : DS.surface2, border: `1px solid ${on ? DS.primary : DS.border}`, borderRadius: 8, color: on ? DS.primary : DS.textMuted, fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>
                  {f}
                </button>
              );
            })}
          </div>

          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Hooks (comma-separated)</label>
          <input style={{ ...input, margin: "4px 0 10px" }} value={hooks} onChange={(e) => setHooks(e.target.value)} placeholder="object flies into frame, 3 reasons why…" />
          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Settings (comma-separated)</label>
          <input style={{ ...input, margin: "4px 0 10px" }} value={settings} onChange={(e) => setSettings(e.target.value)} placeholder="sunlit kitchen, car interior…" />

          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Avatar / character (optional)</label>
          <select style={{ ...input, margin: "4px 0 10px" }} value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            <option value="">None</option>
            {(charsQ.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label style={{ fontSize: 10, color: DS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>Video model</label>
          <select style={{ ...input, margin: "4px 0 12px" }} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Pick a Higgsfield video model…</option>
            {videoModels.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </select>

          {estimate && (
            <div style={{ border: `1px solid ${DS.amber}`, borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 12, color: DS.amber }}>
              ~<span style={{ fontFamily: MONO }}>{estimate.estimatedCredits}</span> credits for <span style={{ fontFamily: MONO }}>{estimate.variants}</span> variants
              (over the {estimate.thresholdCredits}-credit threshold). {estimate.note}.
              <button onClick={() => batchMut.mutate(true)} disabled={batchMut.isPending}
                style={{ display: "block", width: "100%", marginTop: 8, background: DS.amber, border: "none", borderRadius: 8, color: "#06090F", fontWeight: 700, fontSize: 12, padding: "8px 0", cursor: "pointer" }}>
                Confirm spend & dispatch
              </button>
            </div>
          )}
          <button onClick={() => batchMut.mutate(false)} disabled={!model || formats.length === 0 || batchMut.isPending}
            style={{ width: "100%", background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 12, fontWeight: 600, padding: "9px 0", cursor: "pointer", opacity: !model || formats.length === 0 || batchMut.isPending ? 0.4 : 1 }}>
            {batchMut.isPending ? "Working…" : "Generate batch"}
          </button>
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DS.text, marginBottom: 8 }}>Ad reference (recreate this ad)</div>
          <input style={{ ...input, marginBottom: 8 }} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="URL of an existing ad video…" />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => refMut.mutate()} disabled={!/^https?:\/\//.test(refUrl) || refMut.isPending}
              style={{ flex: 1, background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 10, color: DS.textMuted, fontSize: 11, padding: "7px 0", cursor: "pointer" }}>
              Analyze
            </button>
            {refJobId && (
              <button onClick={() => refPollMut.mutate()} style={{ background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 10, color: DS.textMuted, fontSize: 11, padding: "7px 10px", cursor: "pointer" }}>
                <RefreshCw size={11} />
              </button>
            )}
          </div>
          {refJobId && <div style={{ fontSize: 10, color: DS.textFaint, marginTop: 6, fontFamily: MONO }}>ref job {refJobId.slice(0, 8)} — {String((refPollMut.data as any)?.job?.status ?? "running")}; attached to the next batch</div>}
        </div>
      </div>

      {/* batches + variant grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(batchesQ.data?.batches ?? []).map((b) => (
              <button key={b.id} onClick={() => setOpenBatchId(b.batchId ?? "")}
                style={{ background: openBatchId === b.batchId ? "rgba(59,130,255,.12)" : DS.surface2, border: `1px solid ${openBatchId === b.batchId ? DS.primary : DS.border}`, borderRadius: 10, color: DS.textMuted, fontSize: 11, padding: "6px 10px", cursor: "pointer" }}>
                {new Date(b.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {String((b.params as any)?.config?.formats?.length ?? "?")}fmt
              </button>
            ))}
            {(batchesQ.data?.batches ?? []).length === 0 && <span style={{ fontSize: 12, color: DS.textFaint }}>No batches yet — configure and dispatch on the left.</span>}
          </div>
        </div>

        {openBatchId && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
            {variants.map((v: CreativeJob) => {
              const out = v.outputs[0];
              const virality = (v.params as any)?.virality;
              return (
                <div key={v.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "9 / 16", maxHeight: 260, background: DS.surface2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {out
                      ? <video src={out.url} muted loop playsInline controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : v.status === "failed"
                        ? <AlertTriangle size={18} color={DS.critical} />
                        : <RefreshCw size={18} className="animate-spin" color={DS.amber} />}
                  </div>
                  <div style={{ padding: 10 }}>
                    <div style={{ fontSize: 10, fontFamily: MONO, color: DS.textFaint }}>
                      {String((v.params as any)?.format ?? "")}{(v.params as any)?.hook ? ` · ${String((v.params as any).hook).slice(0, 24)}` : ""}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: MONO, color: v.status === "completed" ? DS.success : v.status === "failed" ? DS.critical : DS.amber }}>
                        {v.status}{v.costCredits != null ? ` · ${v.costCredits}cr` : ""}
                      </span>
                      {v.status === "completed" && (
                        <button onClick={() => viralityMut.mutate(v.id)} disabled={viralityMut.isPending}
                          title={virality ? `Virality: ${virality.score ?? "?"}` : "Score virality (directional — real A/B beats predictions)"}
                          style={{ display: "flex", alignItems: "center", gap: 4, background: DS.surface2, border: `1px solid ${DS.border}`, borderRadius: 8, color: virality ? DS.success : DS.textMuted, fontSize: 10, fontFamily: MONO, padding: "3px 7px", cursor: "pointer" }}>
                          <TrendingUp size={11} /> {virality?.score ?? "score"}
                        </button>
                      )}
                    </div>
                    {v.error && <div style={{ fontSize: 9, color: DS.critical, fontFamily: MONO, marginTop: 4 }}>{v.error.slice(0, 80)}</div>}
                    {virality?.summary && <div style={{ fontSize: 10, color: DS.textMuted, marginTop: 6 }}>{String(virality.summary).slice(0, 140)}</div>}
                  </div>
                </div>
              );
            })}
            {variants.length === 0 && batchQ.isFetching && <div style={{ fontSize: 12, color: DS.textFaint }}>Loading batch…</div>}
          </div>
        )}
        {!openBatchId && (
          <div style={{ ...card, textAlign: "center", color: DS.textFaint, fontSize: 12, padding: 40 }}>
            <Repeat size={16} style={{ marginBottom: 6 }} /> <br />
            Variant grid — pick or dispatch a batch. One config → N ads (formats × hooks × settings).
          </div>
        )}
      </div>
    </div>
  );
}

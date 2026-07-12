// Creative Studio P1 — one-click edit tool grid (spec §3.4): Higgsfield Apps pattern,
// minimal single-purpose forms over upscale / expand / reframe / remove-bg / recast.
// Source = any URL (paste) or a completed library job (deep-linked via initialSourceUrl).
import { useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wand2, AlertTriangle } from "lucide-react";
import { creativeToolsApi, EDIT_TOOL_META } from "../../api/creativeTools";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";

const DS = {
  surface: "#0D131D", surface2: "#111926", border: "#1C2635", text: "#F5F8FF",
  textMuted: "#A3B0C2", textFaint: "#68758A", primary: "#3B82FF", amber: "#F4B940",
} as const;

const card: CSSProperties = {
  background: DS.surface, border: "1px solid rgba(255,255,255,.06)", borderRadius: 16, padding: 20,
};

export function EditTools({ hfConfigured, initialSourceUrl }: {
  hfConfigured: boolean;
  initialSourceUrl?: string;
}) {
  const { selectedCompanyId: cid } = useCompany();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [urls, setUrls] = useState<Record<string, string>>(
    () => Object.fromEntries(EDIT_TOOL_META.map((t) => [t.tool, initialSourceUrl ?? ""])),
  );
  const [prompts, setPrompts] = useState<Record<string, string>>({});

  const editMut = useMutation({
    mutationFn: ({ tool, sourceUrl, prompt }: { tool: string; sourceUrl: string; prompt?: string }) =>
      creativeToolsApi.edit(cid!, tool, { sourceUrl, ...(prompt ? { prompt } : {}) }),
    onSuccess: () => {
      pushToast({ title: "Edit job dispatched", tone: "success" });
      qc.invalidateQueries({ queryKey: ["creative-jobs", cid] });
    },
    onError: (e: any) => pushToast({ title: "Edit failed", body: String(e?.message ?? e).slice(0, 180), tone: "error" }),
  });

  if (!hfConfigured) {
    return (
      <div style={{ ...card, borderColor: DS.amber, display: "flex", gap: 10, alignItems: "center" }}>
        <AlertTriangle size={16} color={DS.amber} />
        <span style={{ fontSize: 13, color: DS.textMuted }}>Edit tools run on the Higgsfield MCP — keyed off (HIGGSFIELD_MCP_URL). Nothing here is mocked.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
      {EDIT_TOOL_META.map((t) => {
        const url = urls[t.tool] ?? "";
        const valid = /^https?:\/\//.test(url);
        const needsPrompt = t.tool === "motion_control" || t.tool === "outpaint_image";
        return (
          <div key={t.tool} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Wand2 size={14} color={DS.primary} />
              <span style={{ fontSize: 13, fontWeight: 600, color: DS.text }}>{t.label}</span>
              <span style={{ fontSize: 9, color: DS.textFaint, border: `1px solid ${DS.border}`, borderRadius: 6, padding: "1px 6px" }}>{t.accepts}</span>
            </div>
            <div style={{ fontSize: 11, color: DS.textFaint, marginBottom: 10 }}>{t.desc}</div>
            <input value={url} onChange={(e) => setUrls({ ...urls, [t.tool]: e.target.value })}
              placeholder={`${t.accepts} URL (or use a library card's Edit action)`}
              style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, outline: "none", marginBottom: 8 }} />
            {needsPrompt && (
              <input value={prompts[t.tool] ?? ""} onChange={(e) => setPrompts({ ...prompts, [t.tool]: e.target.value })}
                placeholder={t.tool === "motion_control" ? "Describe the recast / motion transfer…" : "Target aspect or expansion notes…"}
                style={{ width: "100%", boxSizing: "border-box", background: DS.surface2, color: DS.text, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, outline: "none", marginBottom: 8 }} />
            )}
            <button
              onClick={() => editMut.mutate({ tool: t.tool, sourceUrl: url, prompt: prompts[t.tool] })}
              disabled={!valid || editMut.isPending}
              style={{ width: "100%", background: DS.primary, border: "none", borderRadius: 10, color: "#fff", fontSize: 12, fontWeight: 600, padding: "8px 0", cursor: "pointer", opacity: !valid || editMut.isPending ? 0.4 : 1 }}>
              {editMut.isPending ? "Dispatching…" : "Run"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

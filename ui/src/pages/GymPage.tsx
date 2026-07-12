// Gym Tab (Fable spec) — read-only observability of what the fleet LEARNS + what it
// wants to CHANGE. Learning Feed (vault deep-dreams/session-ends) + Proposed-Changes
// queue (approve/reject/edit) + Skill Evolution Timeline. Nothing auto-executes.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, RefreshCw, Check, X, Pencil, FileText, Crown, TrendingUp, Brain, Eye, EyeOff, ExternalLink,
} from "lucide-react";
import { gymObservabilityApi, type SkillProposal } from "../api/gymObservability";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DS = {
  canvas: "#06090F", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", text: "#F5F8FF", textMuted: "#A3B0C2",
  textFaint: "#68758A", primary: "#3B82FF", success: "#2FE38A", critical: "#FF5B5B",
  amber: "#F5A623", purple: "#8B7BF0",
} as const;

const TARGET_COLOR: Record<string, string> = { skill: DS.primary, soul: DS.purple, workflow: DS.amber };

function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function GymPage() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [agentFilter, setAgentFilter] = useState<string>("All");
  const DISMISS_KEY = "gym-dismissed-reflections";
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]")); } catch { return new Set(); }
  });
  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const [showDismissed, setShowDismissed] = useState(false);
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState<SkillProposal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editDetail, setEditDetail] = useState("");

  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => { setBreadcrumbs([{ label: "Gym" }]); }, [setBreadcrumbs]);

  const feedQ = useQuery({
    queryKey: ["gym-feed", cid],
    queryFn: () => gymObservabilityApi.learningFeed(cid!),
    enabled: !!cid,
  });
  const proposalsQ = useQuery({
    queryKey: ["gym-proposals", cid],
    queryFn: () => gymObservabilityApi.proposals(cid!),
    enabled: !!cid,
    refetchInterval: 8000,
  });
  const timelineQ = useQuery({
    queryKey: ["gym-timeline", cid],
    queryFn: () => gymObservabilityApi.timeline(cid!),
    enabled: !!cid,
  });

  const reflectionQ = useQuery({
    queryKey: ["gym-reflection", cid, viewing?.path],
    queryFn: () => gymObservabilityApi.reflection(cid!, viewing!.path),
    enabled: !!cid && !!viewing,
  });

  const feed = (feedQ.data as any)?.items ?? [];
  const proposals: SkillProposal[] = (proposalsQ.data as any)?.proposals ?? [];
  const migrationPending = Boolean((proposalsQ.data as any)?.migrationPending || (timelineQ.data as any)?.migrationPending);
  const timelines = (timelineQ.data as any)?.timelines ?? [];

  const agents = useMemo(() => {
    const s = new Set<string>();
    feed.forEach((f: any) => f.agent && s.add(f.agent));
    return ["All", ...Array.from(s)];
  }, [feed]);
  const byAgent = agentFilter === "All" ? feed : feed.filter((f: any) => f.agent === agentFilter);
  const filteredFeed = showDismissed ? byAgent : byAgent.filter((f: any) => !dismissed.has(f.id));
  const dismissedCount = byAgent.length - byAgent.filter((f: any) => !dismissed.has(f.id)).length;
  const obsidianHref = (rel: string) =>
    `obsidian://open?vault=${encodeURIComponent("Augi Vault")}&file=${encodeURIComponent(rel.replace(/\.md$/i, ""))}`;

  const pending = proposals.filter((p) => p.status === "pending");
  const reviewed = proposals.filter((p) => p.status !== "pending");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["gym-proposals", cid] });
    qc.invalidateQueries({ queryKey: ["gym-timeline", cid] });
  };

  const generateM = useMutation({
    mutationFn: () => gymObservabilityApi.generate(cid!),
    onSuccess: (d: any) => {
      invalidate();
      pushToast({ title: `Scanned ${d.scanned} — ${d.inserted} new proposal(s)`, variant: "success" } as any);
    },
    onError: () => pushToast({ title: "Scan failed", variant: "destructive" } as any),
  });
  const reviewM = useMutation({
    mutationFn: (a: { id: string; decision: "approve" | "reject" }) => gymObservabilityApi.review(cid!, a.id, a.decision),
    onSuccess: (_d, a) => { invalidate(); pushToast({ title: a.decision === "approve" ? "Approved" : "Rejected", variant: "success" } as any); },
  });
  const editM = useMutation({
    mutationFn: (a: { id: string; title: string; target_name: string; detail: string }) =>
      gymObservabilityApi.edit(cid!, a.id, { title: a.title, target_name: a.target_name, detail: a.detail }),
    onSuccess: () => { invalidate(); setEditing(null); pushToast({ title: "Updated", variant: "success" } as any); },
  });

  const openEdit = (p: SkillProposal) => {
    setEditing(p); setEditTitle(p.title); setEditTarget(p.target_name); setEditDetail(p.detail ?? "");
  };

  if (!cid) return <div style={{ background: DS.canvas, minHeight: "100vh", padding: 24, color: DS.textMuted }}>Select a company.</div>;

  const badge = (label: string, color: string) => (
    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color, background: `${color}1E`, padding: "2px 7px", borderRadius: 6 }}>{label}</span>
  );

  const proposalCard = (p: SkillProposal) => {
    const tc = TARGET_COLOR[p.target_type] ?? DS.textFaint;
    return (
      <div key={p.id} style={{ background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {badge(p.target_type, tc)}
          <span style={{ fontSize: 12, color: DS.textMuted }}>{p.agent_name ?? "Fleet"}</span>
          {p.effort && <span style={{ fontSize: 11, color: DS.textFaint }}>· effort {p.effort}</span>}
          {p.status !== "pending" && (
            <span style={{ marginLeft: "auto" }}>{badge(p.status, p.status === "approved" ? DS.success : DS.critical)}</span>
          )}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>{p.title}</div>
        <div style={{ fontSize: 12, color: DS.textFaint, marginBottom: 8 }}>
          Target: <span style={{ color: DS.textMuted }}>{p.target_name}</span>
          {p.value_note && <> · {p.value_note}</>}
          {p.confidence && <span style={{ marginLeft: 6, color: DS.textMuted, background: DS.surface3, padding: "1px 6px", borderRadius: 5, fontSize: 10.5 }}>confidence: {p.confidence}</span>}
        </div>
        {p.detail && (
          <pre style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: DS.textMuted, background: DS.surface2, border: `1px solid ${DS.border}`, borderLeft: `2px solid ${tc}`, borderRadius: 8, padding: "8px 10px", marginBottom: 8, whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 140, overflowY: "auto" }}>{p.detail}</pre>
        )}
        <div style={{ fontSize: 10.5, color: DS.textFaint, marginBottom: p.status === "pending" ? 12 : 0 }}>
          {p.source_file ? (
            <a href={`obsidian://open?vault=${encodeURIComponent("Augi Vault")}&file=${encodeURIComponent(p.source_file.replace(/\.md$/i, ""))}`}
              style={{ color: DS.primary, textDecoration: "none" }} title="Open source in Obsidian">
              [[{p.source_file.split("/").pop()?.replace(/\.md$/i, "")}]]
            </a>
          ) : null} {p.source_ref ? `· ${p.source_ref}` : ""}
        </div>
        {p.status === "pending" ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" style={{ background: DS.success, color: "#04120B" }} disabled={reviewM.isPending}
              onClick={() => reviewM.mutate({ id: p.id, decision: "approve" })}>
              <Check size={13} style={{ marginRight: 5 }} /> Approve
            </Button>
            <Button size="sm" variant="destructive" disabled={reviewM.isPending}
              onClick={() => reviewM.mutate({ id: p.id, decision: "reject" })}>
              <X size={13} style={{ marginRight: 5 }} /> Reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
              <Pencil size={13} style={{ marginRight: 5 }} /> Edit
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div style={{ background: DS.canvas, minHeight: "100vh", color: DS.text, padding: isMobile ? 16 : 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brain size={20} color={DS.success} />
            <h1 style={{ fontSize: 22, fontWeight: 600 }}>Gym</h1>
          </div>
          <div style={{ fontSize: 13, color: DS.textFaint, marginTop: 4 }}>
            What the fleet is learning and what it wants to change. You review every proposal — nothing auto-executes.
          </div>
        </div>
        <Button onClick={() => generateM.mutate()} disabled={generateM.isPending}
          style={{ background: DS.surface2, border: `1px solid ${DS.border}`, color: DS.text }}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> {generateM.isPending ? "Scanning…" : "Scan for proposals"}
        </Button>
      </div>

      {migrationPending && (
        <div style={{ marginTop: 14, background: `${DS.amber}14`, border: `1px solid ${DS.amber}55`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: DS.amber }}>
          Proposal persistence is offline — migration 0145 (skill_proposals) is held pending journal
          reconciliation. The Learning Feed works; Scan/Approve/Reject unlock once the migration is applied.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 18, marginTop: 18 }}>
        {/* ── Learning Feed ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Sparkles size={15} color={DS.textMuted} />
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Learning Feed</h2>
          </div>
          {/* agent filter */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {agents.map((a) => (
              <button key={a} onClick={() => setAgentFilter(a)}
                style={{
                  fontSize: 11.5, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                  background: agentFilter === a ? DS.primary : DS.surface2,
                  color: agentFilter === a ? "#fff" : DS.textMuted,
                  border: `1px solid ${agentFilter === a ? DS.primary : DS.border}`,
                }}>{a}</button>
            ))}
          </div>
          {feedQ.isLoading && <div style={{ color: DS.textMuted, fontSize: 13 }}>Loading…</div>}
          {feedQ.isError && <div style={{ color: DS.critical, fontSize: 13 }}>Couldn't load the feed.</div>}
          {!feedQ.isLoading && filteredFeed.length === 0 && (
            <div style={{ color: DS.textFaint, fontSize: 13 }}>No reflections yet.</div>
          )}
          {filteredFeed.map((f: any) => (
            <div key={f.id} style={{ background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: 14, marginBottom: 10, opacity: dismissed.has(f.id) ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: DS.text }}>{f.agent}</span>
                {badge(f.type, f.type === "deep-dream" ? DS.purple : f.type === "handoff" ? DS.amber : DS.textFaint)}
                <span style={{ marginLeft: "auto", fontSize: 11, color: DS.textFaint }}>
                  {f.sessionId ? `${f.sessionId} · ` : ""}{fmtDate(f.date)}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>{f.title}</div>
              {f.summary && <div style={{ fontSize: 12, color: DS.textMuted, lineHeight: 1.5 }}>{f.summary}</div>}
              <div style={{ fontSize: 10.5, color: DS.textFaint, marginTop: 8, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <FileText size={11} />
                <a href={obsidianHref(f.path)} style={{ color: DS.primary, textDecoration: "none" }}
                  title="Open in Obsidian">[[{f.path.split("/").pop()?.replace(/\.md$/i, "")}]]</a>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => setViewing({ path: f.path, title: f.title })}
                    style={{ fontSize: 10.5, color: DS.primary, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                    <Eye size={11} /> View full reflection
                  </button>
                  {!dismissed.has(f.id) && (
                    <button onClick={() => dismiss(f.id)}
                      style={{ fontSize: 10.5, color: DS.textFaint, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                      <EyeOff size={11} /> Dismiss
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
          {dismissedCount > 0 && (
            <button onClick={() => setShowDismissed((v) => !v)}
              style={{ fontSize: 11, color: DS.textFaint, background: "none", border: "none", cursor: "pointer", marginTop: 2 }}>
              {showDismissed ? "Hide" : "Show"} {dismissedCount} dismissed
            </button>
          )}
        </div>

        {/* ── Proposed Changes ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Crown size={15} color={DS.amber} />
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Proposed Changes</h2>
            {pending.length > 0 && <span style={{ fontSize: 11, color: DS.amber }}>{pending.length} pending</span>}
          </div>
          {proposalsQ.isLoading && <div style={{ color: DS.textMuted, fontSize: 13 }}>Loading…</div>}
          {proposalsQ.isError && <div style={{ color: DS.critical, fontSize: 13 }}>Couldn't load proposals.</div>}
          {!proposalsQ.isLoading && proposals.length === 0 && (
            <div style={{ color: DS.textFaint, fontSize: 13, background: DS.surface, border: `1px dashed ${DS.border2}`, borderRadius: 12, padding: 16 }}>
              No proposals yet. Hit <strong style={{ color: DS.textMuted }}>Scan for proposals</strong> to pull the latest skill/soul/workflow changes the fleet surfaced in its deep-dreams.
            </div>
          )}
          {pending.map(proposalCard)}
          {reviewed.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: DS.textFaint, margin: "14px 0 8px" }}>
                Reviewed
              </div>
              {reviewed.map(proposalCard)}
            </>
          )}
        </div>
      </div>

      {/* ── Skill Evolution Timeline ── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <TrendingUp size={15} color={DS.success} />
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Skill Evolution Timeline</h2>
        </div>
        {timelines.length === 0 ? (
          <div style={{ color: DS.textFaint, fontSize: 13 }}>No approved changes yet — approve proposals to build the timeline.</div>
        ) : (
          timelines.map((t: any) => (
            <div key={t.target} style={{ background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                {badge(t.type, TARGET_COLOR[t.type] ?? DS.textFaint)}
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.target}</span>
              </div>
              <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 4, position: "relative" }}>
                {t.versions.map((v: any, i: number) => {
                  const dotColor = v.status === "approved" ? DS.primary : DS.amber;
                  const vid = v.id ?? `${t.target}-${i}`;
                  const isOpen = expandedVersion === vid;
                  return (
                    <div key={vid} style={{ minWidth: 150, flexShrink: 0, cursor: "pointer" }}
                      onClick={() => setExpandedVersion(isOpen ? null : vid)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, boxShadow: isOpen ? `0 0 0 3px ${dotColor}33` : "none" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: dotColor, fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>{v.version}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: DS.textMuted, lineHeight: 1.4 }}>{v.title}</div>
                      <div style={{ fontSize: 10.5, color: DS.textFaint, marginTop: 3 }}>{v.agent} · {fmtDate(v.at)}</div>
                    </div>
                  );
                })}
              </div>
              {t.versions.filter((v: any, i: number) => expandedVersion === (v.id ?? `${t.target}-${i}`)).map((v: any) => (
                <div key={`x-${v.id}`} style={{ marginTop: 10, background: DS.surface2, border: `1px solid ${DS.border2}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: v.status === "approved" ? DS.primary : DS.amber }}>{v.version}</span> — {v.title}
                  </div>
                  {v.detail ? (
                    <pre style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: DS.textMuted, whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{v.detail}</pre>
                  ) : (
                    <div style={{ fontSize: 11.5, color: DS.textFaint }}>No diff detail captured for this change.</div>
                  )}
                  {v.sourceFile && (
                    <div style={{ fontSize: 10.5, marginTop: 8 }}>
                      <a href={`obsidian://open?vault=${encodeURIComponent("Augi Vault")}&file=${encodeURIComponent(String(v.sourceFile).replace(/\.md$/i, ""))}`}
                        style={{ color: DS.primary, textDecoration: "none" }}>
                        [[{String(v.sourceFile).split("/").pop()?.replace(/\.md$/i, "")}]] — originating session
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Full-reflection viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent style={{ maxWidth: 720, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
          <DialogHeader><DialogTitle>{viewing?.title}</DialogTitle></DialogHeader>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {reflectionQ.isLoading && <div style={{ fontSize: 13, color: DS.textFaint }}>Loading…</div>}
            {reflectionQ.isError && <div style={{ fontSize: 13, color: DS.critical }}>Couldn't load this reflection.</div>}
            {reflectionQ.data && (
              <pre style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}>{(reflectionQ.data as any).content}</pre>
            )}
          </div>
          {viewing && (
            <div style={{ fontSize: 11, marginTop: 8 }}>
              <a href={obsidianHref(viewing.path)} style={{ color: DS.primary, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ExternalLink size={11} /> Open in Obsidian
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit proposal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div>
              <Label>Target</Label>
              <Input value={editTarget} onChange={(e) => setEditTarget(e.target.value)} />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={editDetail} onChange={(e) => setEditDetail(e.target.value)} placeholder="Any tweak before approving…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={editM.isPending || !editing}
              onClick={() => editing && editM.mutate({ id: editing.id, title: editTitle, target_name: editTarget, detail: editDetail })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

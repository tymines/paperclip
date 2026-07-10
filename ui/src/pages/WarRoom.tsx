// ponytail: War Room — Tyler's manual pipeline dashboard
import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, Plus, Play, XCircle, RotateCcw } from "lucide-react";
import { pipelineApi } from "../api/pipeline";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const DS = {
  canvas: "#06090F", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", text: "#F5F8FF", textMuted: "#A3B0C2",
  textFaint: "#68758A", primary: "#3B82FF", success: "#2FE38A", critical: "#FF5B5B",
  amber: "#F59E0B",
} as const;

const STAGES = ["idea", "spec", "design", "architecture", "build", "review", "ship", "retro"];

export function WarRoom() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sendBack, setSendBack] = useState("");

  useEffect(() => { setBreadcrumbs([{ label: "War Room" }]); }, [setBreadcrumbs]);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ["pipeline-runs", cid],
    queryFn: () => pipelineApi.listRuns(cid!),
    enabled: !!cid,
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery({
    queryKey: ["pipeline-run", cid, selectedRunId],
    queryFn: () => pipelineApi.getRun(cid!, selectedRunId!),
    enabled: !!cid && !!selectedRunId,
  });

  const startM = useMutation({
    mutationFn: (name: string) => pipelineApi.start(cid!, name),
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ["pipeline-runs", cid] }); setCreateOpen(false); setNewName(""); setSelectedRunId(d.runId); },
  });

  const gateM = useMutation({
    mutationFn: (args: { runId: string; decision: "pass" | "fail"; send_back_to?: string }) =>
      pipelineApi.gateDecision(cid!, args.runId, args.decision, args.send_back_to ? { send_back_to: args.send_back_to } : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pipeline-runs", cid] }); qc.invalidateQueries({ queryKey: ["pipeline-run", cid, selectedRunId] }); },
  });

  const runs = (runsData as any)?.runs ?? [];
  const stages = (detail as any)?.stages ?? [];
  const activeStage = stages.find((s: any) => s.status === "active" || s.status === "rework");
  const currentIdx = activeStage ? STAGES.indexOf(activeStage.name) : -1;

  if (!cid) return <div style={{ background: DS.canvas, minHeight: "100vh", padding: 24, color: DS.textMuted }}>Select a company.</div>;

  return (
    <div style={{ background: DS.canvas, minHeight: "100vh", display: "flex" }}>
      {/* Sidebar */}
      <div style={{ width: 280, borderRight: `1px solid ${DS.border}`, padding: 16, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ color: DS.text, fontSize: 18, fontWeight: 600 }}>Pipeline Runs</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3 w-3 mr-1" />New</Button>
        </div>
        {isLoading && <div style={{ color: DS.textMuted, fontSize: 13 }}>Loading...</div>}
        {runs.map((r: any) => (
          <div key={r.id} onClick={() => setSelectedRunId(r.id)}
            style={{
              padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 6,
              background: selectedRunId === r.id ? DS.surface3 : DS.surface,
              border: selectedRunId === r.id ? `1px solid ${DS.primary}` : `1px solid ${DS.border}`,
            }}>
            <div style={{ color: DS.text, fontSize: 13, fontWeight: 500 }}>{r.name}</div>
            <div style={{ color: DS.textFaint, fontSize: 11, marginTop: 2 }}>
              {r.current_stage ?? "—"} · {r.status}
            </div>
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
        {!selectedRunId && <p style={{ color: DS.textMuted }}>Select a run or start a new project.</p>}

        {selectedRunId && detail && (
          <>
            <h1 style={{ color: DS.text, fontSize: 24, fontWeight: 600, marginBottom: 20 }}>
              {(detail as any).run?.name ?? "Untitled"}
            </h1>

            {/* 8-stage tracker */}
            <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
              {STAGES.map((s, i) => {
                const st = stages.find((x: any) => x.name === s && x.status !== "pending");
                const color = st?.status === "passed" ? DS.success
                  : st?.status === "active" ? DS.amber
                  : st?.status === "rework" ? DS.critical
                  : DS.textFaint;
                return (
                  <div key={s} style={{
                    padding: "8px 14px", borderRadius: 8, border: `1px solid ${color}`,
                    background: `${color}18`, color, fontSize: 12, fontWeight: 500,
                    textTransform: "capitalize",
                  }}>
                    {s}{st ? ` (${st.status})` : ""}
                  </div>
                );
              })}
            </div>

            {/* Gate controls */}
            {activeStage && (
              <div style={{ background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: 16, maxWidth: 400 }}>
                <div style={{ color: DS.text, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  Stage: {activeStage.name} ({activeStage.status})
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => gateM.mutate({ runId: selectedRunId, decision: "pass" })}
                    style={{ background: DS.success, color: "#000" }}>
                    <Play className="h-3 w-3 mr-1" />Pass
                  </Button>
                  <Button variant="destructive" onClick={() => {
                    const target = sendBack || STAGES[Math.max(0, currentIdx - 1)];
                    gateM.mutate({ runId: selectedRunId, decision: "fail", send_back_to: target });
                    setSendBack("");
                  }}>
                    <XCircle className="h-3 w-3 mr-1" />Reject
                  </Button>
                  <Select value={sendBack} onValueChange={setSendBack}>
                    <SelectTrigger style={{ width: 160 }}>
                      <SelectValue placeholder="Send back to..." />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.filter((_, i) => i < currentIdx).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* New project dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && newName.trim() && startM.mutate(newName.trim())} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => startM.mutate(newName.trim())} disabled={!newName.trim()}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

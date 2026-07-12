// War Room — Tyler's manual pipeline dashboard (Fable WO-5 design, responsive)
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, XCircle, Send, Lock, FileText, Users, Crown, ChevronLeft } from "lucide-react";
import { pipelineApi } from "../api/pipeline";
import { roomsApi } from "../api/rooms";
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
  amber: "#F5A623", purple: "#8B7BF0",
} as const;

const STAGES = ["idea", "spec", "design", "architecture", "build", "review", "ship", "retro"];
const STAGE_LABEL: Record<string, string> = {
  idea: "Idea", spec: "Spec", design: "Design", architecture: "Arch",
  build: "Build", review: "Review", ship: "Ship", retro: "Retro",
};

function stageColor(status: string | undefined) {
  if (status === "passed") return DS.success;
  if (status === "active") return DS.amber;
  if (status === "rework") return DS.critical;
  if (status === "awaiting_gate") return DS.primary;
  return DS.textFaint;
}

export function WarRoom() {
  const { selectedCompanyId: cid } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [councilName, setCouncilName] = useState("");
  const [sendBack, setSendBack] = useState("");
  const [reason, setReason] = useState("");
  const [chatText, setChatText] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => { setBreadcrumbs([{ label: "War Room" }]); }, [setBreadcrumbs]);

  const { data: runsData, isLoading, isError } = useQuery({
    queryKey: ["pipeline-runs", cid],
    queryFn: () => pipelineApi.listRuns(cid!),
    enabled: !!cid,
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery({
    queryKey: ["pipeline-run", cid, selectedRunId],
    queryFn: () => pipelineApi.getRun(cid!, selectedRunId!),
    enabled: !!cid && !!selectedRunId,
    refetchInterval: 4000,
  });

  const run = (detail as any)?.run;
  const stages = (detail as any)?.stages ?? [];
  const roomId: string | null = run?.room_id ?? null;
  const activeStage = stages.find((s: any) => s.status === "active" || s.status === "rework");
  const currentIdx = activeStage ? STAGES.indexOf(activeStage.name) : -1;

  const { data: msgData } = useQuery({
    queryKey: ["war-room-messages", cid, roomId],
    queryFn: () => roomsApi.listMessages(cid!, roomId!, undefined, 50),
    enabled: !!cid && !!roomId,
    refetchInterval: 4000,
  });
  const messages = (msgData as any)?.messages ?? [];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const startM = useMutation({
    mutationFn: (name: string) => pipelineApi.start(cid!, name),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["pipeline-runs", cid] });
      setCreateOpen(false); setNewName(""); setSelectedRunId(d.runId);
    },
  });

  const gateM = useMutation({
    mutationFn: (args: { runId: string; decision: "pass" | "fail"; send_back_to?: string; reason?: string }) =>
      pipelineApi.gateDecision(cid!, args.runId, args.decision, {
        ...(args.send_back_to ? { send_back_to: args.send_back_to } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
      } as any),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["pipeline-runs", cid] });
      qc.invalidateQueries({ queryKey: ["pipeline-run", cid, selectedRunId] });
      setSendBack(""); setReason("");
      pushToast({ title: vars.decision === "pass" ? "Advanced" : "Sent back", variant: "success" } as any);
    },
  });

  const chatM = useMutation({
    mutationFn: (text: string) => roomsApi.sendMessage(cid!, roomId!, { content: text, senderType: "user" }),
    onSuccess: () => { setChatText(""); qc.invalidateQueries({ queryKey: ["war-room-messages", cid, roomId] }); },
  });

  const councilM = useMutation({
    mutationFn: (name: string) => roomsApi.create(cid!, { name, type: "council" }),
    onSuccess: () => { setCouncilOpen(false); setCouncilName(""); pushToast({ title: "Council created", variant: "success" } as any); },
  });

  const runs = (runsData as any)?.runs ?? [];

  if (!cid) return <div style={{ background: DS.canvas, minHeight: "100vh", padding: 24, color: DS.textMuted }}>Select a company.</div>;

  const showList = !isMobile || !selectedRunId;
  const showDetail = !isMobile || !!selectedRunId;

  return (
    <div style={{ background: DS.canvas, minHeight: "100vh", display: "flex", flexDirection: isMobile ? "column" : "row", color: DS.text }}>
      {/* ── Run list ── */}
      {showList && (
        <div style={{
          width: isMobile ? "100%" : 280, flexShrink: 0,
          borderRight: isMobile ? "none" : `1px solid ${DS.border}`,
          borderBottom: isMobile ? `1px solid ${DS.border}` : "none",
          padding: 16, overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Pipeline Runs</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setCouncilOpen(true)} title="New council"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 8, background: DS.surface2, border: `1px solid ${DS.border}`, color: DS.textMuted, fontSize: 12, cursor: "pointer" }}>
                <Users size={13} />
              </button>
              <button onClick={() => setCreateOpen(true)}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, background: DS.success, border: "none", color: "#04120B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <Plus size={13} /> New
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: DS.textFaint, marginBottom: 12 }}>Start a project — it enters at Idea and holds for your go.</div>
          {isLoading && <div style={{ color: DS.textMuted, fontSize: 13 }}>Loading…</div>}
          {isError && <div style={{ color: DS.critical, fontSize: 13 }}>Couldn't load runs. Retrying…</div>}
          {!isLoading && !isError && runs.length === 0 && (
            <div style={{ color: DS.textFaint, fontSize: 13, padding: "8px 0" }}>No runs yet. Start one with “New”.</div>
          )}
          {runs.map((r: any) => (
            <div key={r.id} onClick={() => setSelectedRunId(r.id)}
              style={{
                padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 6,
                background: selectedRunId === r.id ? DS.surface3 : DS.surface,
                border: `1px solid ${selectedRunId === r.id ? DS.primary : DS.border}`,
              }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: DS.textFaint, marginTop: 3, textTransform: "capitalize" }}>
                {(r.current_stage ?? "—")} · {r.status}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Main ── */}
      {showDetail && (
        <div style={{ flex: 1, minWidth: 0, padding: isMobile ? 16 : 24, overflowY: "auto" }}>
          {isMobile && selectedRunId && (
            <button onClick={() => setSelectedRunId(null)}
              style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 14, background: "none", border: "none", color: DS.textMuted, fontSize: 13, cursor: "pointer", padding: 0 }}>
              <ChevronLeft size={15} /> Runs
            </button>
          )}
          {!selectedRunId || !run ? (
            <div style={{ height: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center", padding: "0 16px" }}>
              <Crown size={28} color={DS.textFaint} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>Select a run or start a new project</div>
              <div style={{ fontSize: 13, color: DS.textFaint, maxWidth: 360 }}>
                Every project enters at the Idea room. You work it with the agents, approve to advance, or reject to send it back to any room.
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 22, fontWeight: 600 }}>{run.name}</h1>
                <span style={{ fontSize: 12, color: DS.textFaint, textTransform: "capitalize" }}>{run.status}</span>
              </div>

              {/* Horizontal 8-stage tracker (scrolls on narrow screens) */}
              <div style={{ overflowX: "auto", marginBottom: 8 }}>
                <div style={{ position: "relative", padding: "6px 8px 20px", minWidth: 520 }}>
                  <div style={{ position: "absolute", left: 22, right: 22, top: 20, height: 2, background: DS.border }} />
                  <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
                    {STAGES.map((s) => {
                      const st = stages.find((x: any) => x.name === s && x.status !== "pending");
                      const c = stageColor(st?.status);
                      return (
                        <div key={s} style={{ flex: 1, textAlign: "center" }}>
                          <div style={{
                            margin: "0 auto", width: 28, height: 28, borderRadius: "50%",
                            background: st ? c : DS.surface2, border: `3px solid ${DS.canvas}`,
                            boxShadow: `0 0 0 1px ${st ? c : DS.border}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, color: st ? "#04120B" : DS.textFaint, fontWeight: 600,
                          }}>{STAGES.indexOf(s) + 1}</div>
                          <div style={{ fontSize: 10.5, marginTop: 6, color: st ? c : DS.textFaint, fontWeight: st?.status === "active" ? 600 : 400 }}>
                            {STAGE_LABEL[s]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Room chat + artifact panel (stack on mobile) */}
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 14, marginBottom: 16 }}>
                {/* Room chat */}
                <div style={{ flex: 1, minWidth: 0, background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, display: "flex", flexDirection: "column", height: 340 }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${DS.border}`, fontSize: 12, color: DS.textMuted, textTransform: "capitalize" }}>
                    {activeStage ? `${activeStage.name} room` : "Room"} · chat with the agents
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {!roomId && <div style={{ fontSize: 12, color: DS.textFaint }}>This run has no room yet — it’s created when the stage activates.</div>}
                    {roomId && messages.length === 0 && <div style={{ fontSize: 12, color: DS.textFaint }}>No messages yet. Say something to kick off the room.</div>}
                    {messages.map((m: any) => (
                      <div key={m.id} style={{ display: "flex", gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: "50%", background: m.senderType === "user" ? `${DS.primary}22` : `${DS.success}18`, color: m.senderType === "user" ? DS.primary : DS.success, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {m.senderType === "user" ? "You" : "AI"}
                        </span>
                        <div style={{ fontSize: 12.5, color: DS.textMuted, lineHeight: 1.45 }}>{m.content}</div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div style={{ padding: 10, borderTop: `1px solid ${DS.border}`, display: "flex", gap: 8 }}>
                    <Input placeholder={roomId ? "Message the room…" : "No room yet"} value={chatText} disabled={!roomId}
                      onChange={(e) => setChatText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && chatText.trim() && chatM.mutate(chatText.trim())} />
                    <Button size="sm" disabled={!roomId || !chatText.trim()} onClick={() => chatText.trim() && chatM.mutate(chatText.trim())}>
                      <Send size={13} />
                    </Button>
                  </div>
                </div>

                {/* Artifact panel */}
                <div style={{ width: isMobile ? "100%" : 220, flexShrink: 0, background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: 14, height: isMobile ? "auto" : 340 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.05em", color: DS.textFaint, textTransform: "uppercase", marginBottom: 10 }}>Artifact</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: DS.textFaint, fontSize: 12.5 }}>
                    <FileText size={15} /> No frozen artifact yet
                  </div>
                  <div style={{ fontSize: 11.5, color: DS.textFaint, marginTop: 8, lineHeight: 1.5 }}>
                    When the room boss finishes this stage, its output freezes here (sha256) and arms the gate.
                  </div>
                  <div style={{ marginTop: 14, textAlign: "center", fontSize: 11, color: DS.textFaint, border: `1px dashed ${DS.border2}`, borderRadius: 8, padding: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Lock size={12} /> freeze available to boss / you
                  </div>
                </div>
              </div>

              {/* Gate control */}
              {activeStage && (
                <div style={{ background: `${DS.primary}0E`, border: `1px solid ${DS.primary}44`, borderRadius: 12, padding: 16, maxWidth: 560 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <Crown size={15} color={DS.primary} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Your gate · {activeStage.name} → {STAGES[currentIdx + 1] ?? "done"}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: DS.textFaint }}>only you can advance</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <Button onClick={() => gateM.mutate({ runId: selectedRunId, decision: "pass" })}
                      style={{ background: DS.success, color: "#04120B" }}>
                      <Play size={13} style={{ marginRight: 6 }} /> Pass
                    </Button>
                    {currentIdx > 0 && (
                      <>
                        <Button variant="destructive"
                          onClick={() => gateM.mutate({ runId: selectedRunId, decision: "fail", send_back_to: sendBack || STAGES[Math.max(0, currentIdx - 1)], reason })}>
                          <XCircle size={13} style={{ marginRight: 6 }} /> Reject
                        </Button>
                        <Select value={sendBack} onValueChange={setSendBack}>
                          <SelectTrigger style={{ width: 170 }}>
                            <SelectValue placeholder="Send back to…" />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.filter((_, i) => i < currentIdx).map((s) => (
                              <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}
                  </div>
                  {currentIdx > 0 && (
                    <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  )}
                </div>
              )}
              {!activeStage && run.status === "completed" && (
                <div style={{ color: DS.success, fontSize: 14, fontWeight: 500 }}>✓ Shipped — this run completed all stages.</div>
              )}
            </>
          )}
        </div>
      )}

      {/* New project dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && startM.mutate(newName.trim())} />
            <p className="text-xs text-muted-foreground">It starts in the Idea room and waits for your approval to advance.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => startM.mutate(newName.trim())} disabled={!newName.trim() || startM.isPending}>Start at Idea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New council dialog */}
      <Dialog open={councilOpen} onOpenChange={setCouncilOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Council</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="e.g. Bosses sync" value={councilName} onChange={(e) => setCouncilName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && councilName.trim() && councilM.mutate(councilName.trim())} />
            <p className="text-xs text-muted-foreground">An ad-hoc room with any roster — free-form, no gates. Output re-enters via Idea/Spec.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCouncilOpen(false)}>Cancel</Button>
            <Button onClick={() => councilM.mutate(councilName.trim())} disabled={!councilName.trim() || councilM.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

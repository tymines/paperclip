import { useState, useEffect, useRef, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Send } from "lucide-react";
import { api } from "../api/client";

const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
} as const;

interface IntentBoxProps {
  companyId: string;
  onPlanReady: (roomId: string, planTitle: string, planText: string, steps: { label: string; duration?: string }[]) => void;
}

export function IntentBox({ companyId, onPlanReady }: IntentBoxProps) {
  const [intent, setIntent] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "planning" | "ready" | "error">("idle");
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const kickoff = useMutation({
    mutationFn: async (intentText: string) => {
      const res = await api.post<{ roomId: string; roomName: string; title: string; brief: string }>(
        "/companies/" + companyId + "/jarvis/zeus/plan",
        { title: intentText.slice(0, 120), brief: intentText.slice(0, 8000) },
      );
      return res;
    },
    onSuccess: (data) => {
      setRoomId(data.roomId);
      setStatus("planning");
      setMessages([]);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setStatus("error");
    },
  });

  useEffect(() => {
    if (!roomId || status !== "planning") return;
    pollRef.current = setInterval(async () => {
      try {
        const msgs = await api.get<any[]>("/companies/" + companyId + "/rooms/" + roomId + "/messages?limit=20");
        const stream = msgs.map((m: any) => ({
          sender: m.senderId === "zeus" ? "Zeus" : m.senderId === "brainstorm" ? "Brainstorm" : "System",
          text: (m.content ?? "").slice(0, 300),
          kind: m.metadata?.kind,
        })).filter((s: any) => s.text);
        setMessages(stream);

        const final = stream.find((s: any) => s.kind === "final-plan");
        if (final) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("ready");
          const steps = parsePlanSteps(final.text);
          onPlanReady(roomId, "", final.text, steps);
        }
      } catch {
        // poll continues
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [roomId, status, companyId, onPlanReady]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;
    setMessages([]);
    kickoff.mutate(intent.trim());
  };

  return (
    <div
      className="rounded-[16px] p-5"
      style={{
        background: "linear-gradient(180deg, " + DS.surface2 + " 0%, " + DS.surface + " 100%)",
        border: "1px solid " + DS.border,
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: DS.primary }} />
        <span className="text-[13px] font-semibold" style={{ color: DS.text }}>
          Fleet Intent
        </span>
        <span className="text-[11px]" style={{ color: DS.textFaint }}>
          State what you want built — Zeus will draft a plan, then Brainstorm critiques it.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. Build a weekly report generator that scrapes our agent logs..."
          disabled={status === "planning"}
          className="min-h-[48px] flex-1 resize-none rounded-[10px] px-4 py-3 text-[13px] outline-none"
          style={{
            background: DS.surface3,
            border: "1px solid " + DS.border,
            color: DS.text,
          }}
          rows={2}
        />
        <button
          type="submit"
          disabled={!intent.trim() || status === "planning"}
          className="flex shrink-0 items-center gap-2 rounded-[10px] px-4 py-3 text-[13px] font-medium transition-opacity disabled:opacity-40"
          style={{ background: DS.primary, color: "#FFFFFF" }}
        >
          {status === "planning" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span>{status === "planning" ? "Zeus Planning..." : "Zeus Plan"}</span>
        </button>
      </form>

      {error && (
        <div className="mt-3 rounded-[10px] px-4 py-3 text-[12px]" style={{ background: "#FF5B5B1F", color: "#FF5B5B", border: "1px solid #FF5B5B3D" }}>
          {error}
        </div>
      )}

      {messages.length > 0 && (
        <div className="mt-4 space-y-2">
          {messages.map((msg, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px]">
              <span className="shrink-0 rounded px-1.5 py-0.5 font-semibold" style={{
                background: msg.sender === "Zeus" ? DS.primary + "1F" : msg.sender === "Brainstorm" ? DS.success + "1F" : DS.textFaint + "1F",
                color: msg.sender === "Zeus" ? DS.primary : msg.sender === "Brainstorm" ? DS.success : DS.textFaint,
              }}>
                {msg.sender}
              </span>
              <span style={{ color: DS.textMuted }} className="line-clamp-2">{msg.text}</span>
            </div>
          ))}
        </div>
      )}

      {status === "ready" && (
        <div className="mt-3 rounded-[10px] px-4 py-2 text-[12px]" style={{ background: DS.success + "1F", color: DS.success, border: "1px solid " + DS.success + "3D" }}>
          {"Plan ready! Review and approve below."}
        </div>
      )}
    </div>
  );
}

function parsePlanSteps(text: string): { label: string; duration?: string }[] {
  const steps: { label: string; duration?: string }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\d+[\.\)]\s+(.+?)(?:\s*\((\d+[hmdw])\))?$/);
    if (match) {
      steps.push({ label: match[1].trim(), duration: match[2] });
    }
  }
  return steps.length > 0 ? steps : [{ label: text.slice(0, 200) }];
}

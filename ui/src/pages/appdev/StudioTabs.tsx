/**
 * Studio tabs (Phases 3–6): PacksTab (reference-pack builder + style tokens),
 * ChatTab (persistent designer chat: pin/promote/stream), FeedbackTab
 * (inbox + auto-drafts + convert), RetroTab (lessons + feed-forward),
 * VisualQcPro (baseline promotion, region editor, comparison modes, history).
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pin, Send, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  appdevStudioApi,
  type AppdevChatMessage,
  type AppdevFeedbackItem,
  type AppdevReferencePack,
  type AppdevRetro,
  type AppdevScreen,
} from "../../api/appdevControl";
import { DS, cardBorder, surfaceCard } from "./ds";

const inputStyle = { color: DS.text, border: cardBorder, background: DS.surface } as const;

/* ═══ Phase 3 — Reference packs ═══════════════════════════════════════════ */

export function PacksTab({ companyId, appId }: { companyId: string; appId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data } = useQuery({
    queryKey: ["appdev", "packs", companyId, appId],
    queryFn: () => appdevStudioApi.referencePacks(companyId, appId),
  });
  const create = useMutation({
    mutationFn: () => appdevStudioApi.createReferencePack(companyId, appId, { name }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["appdev", "packs", companyId, appId] });
    },
  });
  const extract = useMutation({
    mutationFn: (packId: string) => appdevStudioApi.extractStyleTokens(companyId, packId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev", "packs", companyId, appId] }),
  });
  const approve = useMutation({
    mutationFn: (pack: AppdevReferencePack) =>
      appdevStudioApi.createReferencePack(companyId, appId, {
        name: `${pack.name} (approved)`,
        supersedesId: pack.id,
        items: pack.items ?? [],
        styleTokens: pack.styleTokens ?? null,
        approve: true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev", "packs", companyId, appId] }),
  });
  const packs = data?.referencePacks ?? [];

  return (
    <section style={surfaceCard} className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New reference pack name…"
          className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
          style={inputStyle}
        />
        <button
          onClick={() => name.trim() && create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="rounded-xl px-4 py-2 text-[13px] font-semibold"
          style={{ background: DS.primary, color: "#fff", opacity: name.trim() ? 1 : 0.5 }}
        >
          Create pack
        </button>
      </div>
      <p className="text-[11px]" style={{ color: DS.textFaint }}>
        References are contracts (spec 4.2). Packs are immutable once approved — approving creates a
        superseding Tyler-approved copy. Add items by pinning chat images (Chat tab) or via API.
      </p>
      {packs.length === 0 && <div className="text-[13px]" style={{ color: DS.textFaint }}>No packs yet.</div>}
      {packs.map((p) => (
        <div key={p.id} className="rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: DS.text }}>{p.name}</span>
              {p.approvedBy ? (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(47,227,138,0.12)", color: DS.success }}>
                  approved by {p.approvedBy}
                </span>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: DS.surface3, color: DS.textFaint }}>draft</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!p.approvedBy && !(p.styleTokens && Object.keys(p.styleTokens).length) && (
                <button
                  onClick={() => extract.mutate(p.id)}
                  disabled={extract.isPending}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: "rgba(165,110,255,0.12)", color: DS.automation }}
                >
                  <Wand2 className="h-3 w-3" /> Extract style tokens
                </button>
              )}
              {!p.approvedBy && (
                <button
                  onClick={() => approve.mutate(p)}
                  disabled={approve.isPending}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: "rgba(47,227,138,0.12)", color: DS.success }}
                >
                  Approve (Tyler)
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 text-[11px]" style={{ color: DS.textFaint }}>
            {(p.items ?? []).length} items{p.styleTokens && Object.keys(p.styleTokens).length ? " · tokens extracted" : ""}
          </div>
          {p.styleTokens && Array.isArray((p.styleTokens as { palette?: string[] }).palette) && (
            <div className="mt-2 flex items-center gap-1.5">
              {((p.styleTokens as { palette: string[] }).palette ?? []).slice(0, 8).map((hex) => (
                <span key={hex} title={hex} className="h-5 w-5 rounded-md" style={{ background: hex, border: cardBorder }} />
              ))}
            </div>
          )}
        </div>
      ))}
      {extract.isError && <div className="text-[12px]" style={{ color: DS.critical }}>{(extract.error as Error).message}</div>}
    </section>
  );
}

/* ═══ Phase 5 — Designer chat (persistent) ════════════════════════════════ */

export function ChatTab({ companyId, appId }: { companyId: string; appId: string }) {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: threadsData } = useQuery({
    queryKey: ["appdev", "chat-threads", companyId, appId],
    queryFn: () => appdevStudioApi.chatThreads(companyId, appId),
  });
  const threads = threadsData?.threads ?? [];
  const activeThread = threadId ?? threads[0]?.id ?? null;

  const { data: msgsData } = useQuery({
    queryKey: ["appdev", "chat-msgs", companyId, activeThread],
    queryFn: () => appdevStudioApi.chatMessages(companyId, activeThread!),
    enabled: !!activeThread,
  });
  const messages: AppdevChatMessage[] = msgsData?.messages ?? [];

  const newThread = useMutation({
    mutationFn: () => appdevStudioApi.createChatThread(companyId, appId, `Thread ${threads.length + 1}`),
    onSuccess: (r) => {
      setThreadId(r.thread.id);
      qc.invalidateQueries({ queryKey: ["appdev", "chat-threads", companyId, appId] });
    },
  });
  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => appdevStudioApi.pinMessage(companyId, id, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev", "chat-msgs", companyId, activeThread] }),
  });
  const promote = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => appdevStudioApi.promoteMessage(companyId, id, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appdev"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamText]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || streaming || !activeThread) return;
    setStreaming(true);
    setStreamText("");
    setNotice(null);
    setDraft("");
    try {
      const res = await fetch(appdevStudioApi.chatStreamPath(companyId, activeThread), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let ev = "message";
          let dataStr = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            const j = JSON.parse(dataStr);
            if (ev === "delta") setStreamText((t) => t + (j.text ?? ""));
            else if (ev === "model_unconfigured" || ev === "error") setNotice(j.message);
          } catch { /* keep-alive */ }
        }
      }
    } catch (e) {
      setNotice(String((e as Error).message));
    } finally {
      setStreaming(false);
      setStreamText("");
      qc.invalidateQueries({ queryKey: ["appdev", "chat-msgs", companyId, activeThread] });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <section style={surfaceCard} className="flex flex-col gap-2 p-4">
        <button
          onClick={() => newThread.mutate()}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          style={{ background: DS.primary, color: "#fff" }}
        >
          + New thread
        </button>
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => setThreadId(t.id)}
            className="truncate rounded-lg px-2.5 py-1.5 text-left text-[12px]"
            style={t.id === activeThread ? { background: DS.surface3, color: DS.text } : { color: DS.textMuted }}
          >
            {t.title}
          </button>
        ))}
        {threads.length === 0 && <span className="text-[11px]" style={{ color: DS.textFaint }}>No threads yet.</span>}
      </section>

      <section style={surfaceCard} className="flex max-h-[560px] flex-col p-4">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.map((m) => (
            <div key={m.id} className="rounded-xl p-3" style={{ background: m.role === "user" ? DS.surface3 : DS.surface, border: cardBorder }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: m.role === "user" ? DS.primary : DS.automation }}>
                  {m.role}
                </span>
                <div className="flex items-center gap-1.5">
                  {m.promotedTo && (
                    <span className="rounded px-1.5 text-[10px]" style={{ background: "rgba(47,227,138,0.12)", color: DS.success }}>
                      → {m.promotedTo}
                    </span>
                  )}
                  <button title={m.pinned ? "Unpin" : "Pin to app"} onClick={() => pin.mutate({ id: m.id, pinned: !m.pinned })}>
                    <Pin className="h-3.5 w-3.5" style={{ color: m.pinned ? DS.warning : DS.textFaint }} />
                  </button>
                  {m.role === "assistant" && !m.promotedTo && (
                    <>
                      <button
                        title="Promote to reference pack"
                        className="rounded px-1.5 text-[10px] font-semibold"
                        style={{ background: DS.surface3, color: DS.textMuted }}
                        onClick={() => promote.mutate({ id: m.id, to: "reference_pack" })}
                      >
                        pack
                      </button>
                      <button
                        title="Promote to draft work order"
                        className="rounded px-1.5 text-[10px] font-semibold"
                        style={{ background: DS.surface3, color: DS.textMuted }}
                        onClick={() => promote.mutate({ id: m.id, to: "work_order" })}
                      >
                        WO
                      </button>
                      <button
                        title="Save as skill"
                        className="rounded px-1.5 text-[10px] font-semibold"
                        style={{ background: DS.surface3, color: DS.textMuted }}
                        onClick={() => promote.mutate({ id: m.id, to: "skill" })}
                      >
                        skill
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: DS.textMuted }}>{m.content}</p>
            </div>
          ))}
          {streaming && (
            <div className="rounded-xl p-3 text-[13px]" style={{ background: DS.surface, border: cardBorder, color: DS.textMuted }}>
              {streamText || "…"}
            </div>
          )}
          {notice && <div className="text-[12px]" style={{ color: DS.warning }}>{notice}</div>}
          <div ref={bottomRef} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={!activeThread || streaming}
            placeholder={activeThread ? "Design with Gemini — persisted, promotable…" : "Create a thread first"}
            className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
            style={inputStyle}
          />
          <button onClick={send} disabled={!draft.trim() || streaming || !activeThread} className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: DS.primary, color: "#fff", opacity: draft.trim() ? 1 : 0.5 }}>
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}

/* ═══ Phase 5 — Feedback inbox ════════════════════════════════════════════ */

const SEV_COLOR: Record<string, string> = { p0: DS.critical, p1: "#FF9B5B", p2: DS.warning, p3: DS.textFaint };

export function FeedbackTab({ companyId, appId }: { companyId: string; appId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const { data } = useQuery({
    queryKey: ["appdev", "feedback", companyId, appId],
    queryFn: () => appdevStudioApi.feedback(companyId, appId),
    refetchInterval: 30_000,
  });
  const add = useMutation({
    mutationFn: () => appdevStudioApi.addFeedback(companyId, appId, { title }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["appdev", "feedback", companyId, appId] });
    },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => appdevStudioApi.dismissFeedback(companyId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev", "feedback", companyId, appId] }),
  });
  const convert = useMutation({
    mutationFn: (id: string) => appdevStudioApi.convertFeedback(companyId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev"] }),
  });
  const items: AppdevFeedbackItem[] = data?.items ?? [];

  return (
    <section style={surfaceCard} className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && title.trim() && add.mutate()}
          placeholder="Manual feedback entry… (Sentry arrives via webhook, auto-drafted)"
          className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
          style={inputStyle}
        />
        <button onClick={() => title.trim() && add.mutate()} disabled={!title.trim()} className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: DS.primary, color: "#fff", opacity: title.trim() ? 1 : 0.5 }}>
          Add
        </button>
      </div>
      {items.length === 0 && <div className="text-[13px]" style={{ color: DS.textFaint }}>Inbox clear.</div>}
      {items.map((f) => (
        <div key={f.id} className="rounded-xl p-3" style={{ background: DS.surface, border: cardBorder, opacity: f.status === "dismissed" ? 0.5 : 1 }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded px-1.5 text-[10px] font-bold uppercase" style={{ color: SEV_COLOR[f.severity] ?? DS.textFaint, background: `${SEV_COLOR[f.severity] ?? DS.textFaint}1A` }}>
                {f.severity}
              </span>
              <span className="rounded px-1.5 text-[10px]" style={{ background: DS.surface3, color: DS.textFaint }}>{f.source}</span>
              <span className="truncate text-[13px] font-medium" style={{ color: DS.text }}>{f.title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px]" style={{ color: f.status === "auto_drafted" ? DS.success : DS.textFaint }}>{f.status}</span>
              {!f.convertedWorkOrderId && f.status !== "dismissed" && (
                <>
                  <button title="Convert to draft WO" onClick={() => convert.mutate(f.id)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(59,130,255,0.12)", color: DS.primary }}>
                    <Sparkles className="inline h-3 w-3" /> draft WO
                  </button>
                  <button title="Dismiss" onClick={() => dismiss.mutate(f.id)}>
                    <Trash2 className="h-3.5 w-3.5" style={{ color: DS.textFaint }} />
                  </button>
                </>
              )}
            </div>
          </div>
          {f.body && <p className="mt-1 line-clamp-2 text-[12px]" style={{ color: DS.textMuted }}>{f.body}</p>}
        </div>
      ))}
    </section>
  );
}

/* ═══ Phase 6 — Retro + feed-forward ══════════════════════════════════════ */

export function RetroTab({ companyId, appId }: { companyId: string; appId: string }) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState("");
  const [lessons, setLessons] = useState("");
  const { data } = useQuery({
    queryKey: ["appdev", "retros", companyId, appId],
    queryFn: () => appdevStudioApi.retros(companyId, appId),
  });
  const create = useMutation({
    mutationFn: () =>
      appdevStudioApi.createRetro(companyId, appId, {
        doc,
        lessons: lessons.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text })),
      }),
    onSuccess: () => {
      setDoc("");
      setLessons("");
      qc.invalidateQueries({ queryKey: ["appdev", "retros", companyId, appId] });
    },
  });
  const feedForward = useMutation({
    mutationFn: ({ retroId, lesson, kind }: { retroId: string; lesson: string; kind: "idea" | "work_order" }) =>
      appdevStudioApi.feedForward(companyId, retroId, lesson, kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev"] }),
  });
  const retros: AppdevRetro[] = data?.retros ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section style={surfaceCard} className="flex flex-col gap-2 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>New retro</div>
        <textarea value={doc} onChange={(e) => setDoc(e.target.value)} rows={4} placeholder="Retro doc (markdown)…" className="rounded-xl p-3 text-[13px] outline-none" style={inputStyle} />
        <textarea value={lessons} onChange={(e) => setLessons(e.target.value)} rows={3} placeholder="Lessons — one per line" className="rounded-xl p-3 text-[13px] outline-none" style={inputStyle} />
        <button onClick={() => create.mutate()} disabled={!doc.trim() || create.isPending} className="self-start rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: DS.primary, color: "#fff", opacity: doc.trim() ? 1 : 0.5 }}>
          Save retro
        </button>
      </section>
      <section style={surfaceCard} className="flex flex-col gap-3 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
          Retros — each lesson can feed forward (OUROBOROS)
        </div>
        {retros.length === 0 && <div className="text-[13px]" style={{ color: DS.textFaint }}>No retros yet.</div>}
        {retros.map((r) => (
          <div key={r.id} className="rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
            <div className="text-[11px]" style={{ color: DS.textFaint }}>
              {new Date(r.createdAt).toLocaleString()} · fed forward: {(r.fedForwardIds ?? []).length}
            </div>
            {(r.lessons ?? []).map((l, i) => {
              const text = String((l as { text?: string }).text ?? "");
              return (
                <div key={i} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg p-2" style={{ background: DS.surface2 }}>
                  <span className="text-[12px]" style={{ color: DS.textMuted }}>{text}</span>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => feedForward.mutate({ retroId: r.id, lesson: text, kind: "work_order" })} className="rounded px-1.5 text-[10px] font-semibold" style={{ background: DS.surface3, color: DS.primary }}>
                      → WO
                    </button>
                    <button onClick={() => feedForward.mutate({ retroId: r.id, lesson: text, kind: "idea" })} className="rounded px-1.5 text-[10px] font-semibold" style={{ background: DS.surface3, color: DS.analytics }}>
                      → Idea
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

/* ═══ Phase 4 — Visual QC Pro (regions, modes, baselines, history) ════════ */

type RegionDraft = {
  rect: { x: number; y: number; w: number; h: number };
  kind: "ignore" | "floating";
  note?: string;
};

export function VisualQcPro({
  companyId,
  appId,
  screens,
}: {
  companyId: string;
  appId: string;
  screens: AppdevScreen[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const screen = screens.find((s) => s.id === selected) ?? screens[0] ?? null;
  const { data: assetsData } = useQuery({
    queryKey: ["appdev", "assets", companyId, appId],
    queryFn: () => appdevStudioApi.assets(companyId, appId),
  });
  const shots = (assetsData?.assets ?? []).filter((a) => a.kind === "screenshot");
  const latestShot = shots.find((a) => screen && a.storagePath.includes(`${screen.screenTag}.`)) ?? shots[0] ?? null;

  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [drawKind, setDrawKind] = useState<"ignore" | "floating">("ignore");
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragNow, setDragNow] = useState<{ x: number; y: number } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRegions(((screen?.regions ?? []) as unknown as RegionDraft[]) ?? []);
  }, [screen?.id]);

  const save = useMutation({
    mutationFn: (body: { regions?: RegionDraft[]; comparisonMode?: string }) =>
      appdevStudioApi.updateScreen(companyId, screen!.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev", "app", companyId, appId] }),
  });
  const promoteBaseline = useMutation({
    mutationFn: () => appdevStudioApi.promoteBaseline(companyId, screen!.id, latestShot!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appdev"] }),
  });

  function relPos(e: ReactMouseEvent): { x: number; y: number } | null {
    const el = imgWrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * 1000), y: Math.round(((e.clientY - r.top) / r.height) * 1000) };
  }

  if (screens.length === 0) {
    return (
      <section style={surfaceCard} className="p-5 text-[13px]" >
        <span style={{ color: DS.textFaint }}>
          No screens declared — the harness, VFG and baselines all iterate over the screen inventory.
        </span>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <section style={surfaceCard} className="flex flex-col gap-1.5 p-4">
        {screens.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)} className="rounded-lg px-2.5 py-1.5 text-left" style={s.id === (screen?.id ?? "") ? { background: DS.surface3 } : {}}>
            <code className="text-[12px]" style={{ color: DS.text }}>{s.screenTag}</code>
            <div className="text-[10px]" style={{ color: DS.textFaint }}>
              {s.comparisonMode} · {s.baselineAssetId ? "baseline ✓" : "no baseline"}
            </div>
          </button>
        ))}
      </section>

      <section style={surfaceCard} className="flex flex-col gap-3 p-5">
        {screen && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <code className="text-[13px] font-semibold" style={{ color: DS.text }}>{screen.screenTag}</code>
                {/* Comparison mode (spec 4.6) */}
                {["strict", "layout", "content"].map((m) => (
                  <button key={m} onClick={() => save.mutate({ comparisonMode: m })} className="rounded px-2 py-0.5 text-[11px] font-semibold" style={m === screen.comparisonMode ? { background: DS.primary, color: "#fff" } : { background: DS.surface3, color: DS.textFaint }}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDrawKind("ignore")} className="rounded px-2 py-0.5 text-[11px] font-semibold" style={drawKind === "ignore" ? { background: "rgba(255,91,91,0.2)", color: DS.critical } : { background: DS.surface3, color: DS.textFaint }}>
                  draw: ignore
                </button>
                <button onClick={() => setDrawKind("floating")} className="rounded px-2 py-0.5 text-[11px] font-semibold" style={drawKind === "floating" ? { background: "rgba(244,185,64,0.2)", color: DS.warning } : { background: DS.surface3, color: DS.textFaint }}>
                  draw: floating
                </button>
                <button onClick={() => save.mutate({ regions })} disabled={save.isPending} className="flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(47,227,138,0.15)", color: DS.success }}>
                  <Check className="h-3 w-3" /> Save regions
                </button>
                {latestShot && (
                  <button onClick={() => promoteBaseline.mutate()} disabled={promoteBaseline.isPending} className="rounded px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(59,130,255,0.15)", color: DS.primary }} title="Tyler approval promotes this screenshot to baseline (spec 4.6)">
                    Promote latest → baseline
                  </button>
                )}
              </div>
            </div>

            {/* Region editor canvas: coordinates stored in 0–1000 mille units of
                the rendered frame, mapped to pixels by the diff layer. */}
            <div
              ref={imgWrapRef}
              className="relative w-full select-none overflow-hidden rounded-xl"
              style={{ background: DS.surface, border: cardBorder, aspectRatio: "16/10", cursor: "crosshair" }}
              onMouseDown={(e) => { const p = relPos(e); if (p) { setDragStart(p); setDragNow(p); } }}
              onMouseMove={(e) => { if (dragStart) setDragNow(relPos(e)); }}
              onMouseUp={() => {
                if (dragStart && dragNow) {
                  const x = Math.min(dragStart.x, dragNow.x);
                  const y = Math.min(dragStart.y, dragNow.y);
                  const w = Math.abs(dragNow.x - dragStart.x);
                  const h = Math.abs(dragNow.y - dragStart.y);
                  if (w > 5 && h > 5) setRegions((r) => [...r, { rect: { x, y, w, h }, kind: drawKind }]);
                }
                setDragStart(null);
                setDragNow(null);
              }}
            >
              {latestShot ? (
                <img src={`/api/uploads/${latestShot.storagePath}`} alt={screen.screenTag} className="pointer-events-none h-full w-full object-contain" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center text-[12px]" style={{ color: DS.textFaint }}>
                  No screenshots yet — run the harness from a work order.
                </div>
              )}
              {regions.map((r, i) => (
                <div key={i} className="absolute flex items-start justify-end" style={{
                  left: `${r.rect.x / 10}%`, top: `${r.rect.y / 10}%`, width: `${r.rect.w / 10}%`, height: `${r.rect.h / 10}%`,
                  background: r.kind === "ignore" ? "rgba(255,91,91,0.18)" : "rgba(244,185,64,0.18)",
                  border: `1px dashed ${r.kind === "ignore" ? DS.critical : DS.warning}`,
                }}>
                  <button className="m-0.5" onClick={(e) => { e.stopPropagation(); setRegions((rs) => rs.filter((_, j) => j !== i)); }}>
                    <X className="h-3 w-3" style={{ color: DS.text }} />
                  </button>
                </div>
              ))}
              {dragStart && dragNow && (
                <div className="absolute" style={{
                  left: `${Math.min(dragStart.x, dragNow.x) / 10}%`, top: `${Math.min(dragStart.y, dragNow.y) / 10}%`,
                  width: `${Math.abs(dragNow.x - dragStart.x) / 10}%`, height: `${Math.abs(dragNow.y - dragStart.y) / 10}%`,
                  border: `1px dashed ${DS.analytics}`,
                }} />
              )}
            </div>

            {/* History scrubber */}
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
                History — {shots.filter((a) => a.storagePath.includes(`${screen.screenTag}.`)).length} captures
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {shots.filter((a) => a.storagePath.includes(`${screen.screenTag}.`)).slice(0, 12).map((a) => (
                  <img key={a.id} src={`/api/uploads/${a.storagePath}`} alt="capture" title={new Date(a.createdAt).toLocaleString()} className="h-16 rounded-lg" style={{ border: a.id === screen.baselineAssetId ? `2px solid ${DS.success}` : cardBorder }} />
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

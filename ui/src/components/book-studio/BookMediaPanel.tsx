// Book Media panel (Fable, 2026-07-12) — cover, chapter illustrations, book trailer,
// and per-chapter narration over the Creative Studio MCP providers. Self-contained
// slide-over drawer: BookWritingPage integration is one import + one JSX line, keeping
// the diff additive vs fable-book-build. Data-honest amber states when providers are
// keyed off — no mock output, ever.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard, ImageIcon, Film, Mic, RefreshCw, AlertTriangle, X, Download, Sparkles,
} from "lucide-react";
import { bookMediaApi, type BookMediaChapter } from "../../api/bookMedia";
import { creativeStudioApi } from "../../api/creativeStudio";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";

const AMBER = "#F4B940";

export function BookMediaPanel({ bookId }: { bookId: string }) {
  const { selectedCompanyId: cid } = useCompany();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"cover" | "illustrations" | "trailer" | "narration">("cover");
  const [voiceId, setVoiceId] = useState("");
  const [trailerModel, setTrailerModel] = useState("");

  const overviewQ = useQuery({
    queryKey: ["book-media", cid, bookId],
    queryFn: () => bookMediaApi.overview(cid!, bookId),
    enabled: !!cid && !!bookId && open,
    refetchInterval: open ? 8000 : false,
  });
  const voicesQ = useQuery({
    queryKey: ["book-media-voices", cid],
    queryFn: () => bookMediaApi.voices(cid!),
    enabled: !!cid && open && section === "narration" && overviewQ.data?.providerStatus.higgsfield.configured === true,
    staleTime: 600_000,
    retry: false,
  });
  const modelsQ = useQuery({
    queryKey: ["creative-models", cid],
    queryFn: () => creativeStudioApi.models(cid!),
    enabled: !!cid && open && section === "trailer",
    staleTime: 300_000,
  });

  const ov = overviewQ.data;
  const ps = ov?.providerStatus;
  const anyConfigured = !!(ps?.higgsfield.configured || ps?.openart.configured);
  const videoModels = useMemo(
    () => (modelsQ.data?.models ?? []).filter((m) => m.modes.includes("video")),
    [modelsQ.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["book-media", cid, bookId] });
  const onErr = (e: any) => pushToast({ title: "Request failed", description: String(e?.message ?? e).slice(0, 180), variant: "error" });

  const coverMut = useMutation({ mutationFn: () => bookMediaApi.generateCover(cid!, bookId), onSuccess: invalidate, onError: onErr });
  const illMut = useMutation({ mutationFn: (chapterId: string) => bookMediaApi.generateIllustration(cid!, bookId, { chapterId }), onSuccess: invalidate, onError: onErr });
  const trailerMut = useMutation({
    mutationFn: () => bookMediaApi.generateTrailer(cid!, bookId, { model: trailerModel }),
    onSuccess: invalidate, onError: onErr,
  });
  const narrateMut = useMutation({
    mutationFn: (chapterId: string) => bookMediaApi.narrateChapter(cid!, bookId, chapterId, voiceId ? { voiceId } : {}),
    onSuccess: (r) => { invalidate(); pushToast({ title: `Narration dispatched (${r.chunks} chunk${r.chunks === 1 ? "" : "s"})`, variant: "success" }); },
    onError: onErr,
  });
  const stitchMut = useMutation({
    mutationFn: () => bookMediaApi.stitchNarration(cid!, bookId),
    onSuccess: (r) => { invalidate(); pushToast({ title: r.stitched ? "Audiobook stitched" : "Exported per-chapter files (ffmpeg unavailable)", variant: r.stitched ? "success" : "default" }); },
    onError: onErr,
  });

  if (!bookId) return null;

  return (
    <>
      {/* toggle — fixed, layout-independent */}
      <button
        onClick={() => setOpen(!open)}
        title="Book media — cover, illustrations, trailer, narration"
        className="fixed bottom-20 right-5 z-40 flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-4 py-2 text-xs font-semibold text-gray-200 shadow-lg backdrop-blur hover:border-blue-500"
      >
        <Clapperboard size={14} className="text-blue-400" /> Media
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l border-gray-800 bg-gray-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
              <Clapperboard size={15} className="text-blue-400" /> Book Media
              <span className="max-w-[180px] truncate text-xs font-normal text-gray-500">{ov?.book.title ?? ""}</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-200"><X size={16} /></button>
          </div>

          {ps && !anyConfigured && (
            <div className="m-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: AMBER, color: AMBER }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>No creative provider configured. {ps.higgsfield.keyedOffHint} {ps.openart.keyedOffHint} Nothing here is mocked — generation stays disabled until keyed.</span>
            </div>
          )}

          <div className="flex gap-1 border-b border-gray-800 px-3 py-2">
            {([["cover", ImageIcon, "Cover"], ["illustrations", Sparkles, "Illustrations"], ["trailer", Film, "Trailer"], ["narration", Mic, "Narration"]] as const).map(([key, Icon, label]) => (
              <button key={key} onClick={() => setSection(key)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${section === key ? "bg-gray-800 text-gray-100" : "text-gray-500 hover:text-gray-300"}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {overviewQ.isLoading && <div className="text-xs text-gray-500">Loading…</div>}

            {section === "cover" && ov && (
              <div className="space-y-3">
                {ov.book.coverUrl
                  ? <img src={ov.book.coverUrl} alt="Book cover" className="mx-auto w-48 rounded-lg border border-gray-800" />
                  : <div className="mx-auto flex h-64 w-48 items-center justify-center rounded-lg border border-dashed border-gray-700 text-xs text-gray-600">No cover yet</div>}
                <button onClick={() => coverMut.mutate()} disabled={!ps?.openart.configured || coverMut.isPending}
                  className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  {coverMut.isPending ? "Dispatching…" : ov.book.coverUrl ? "Regenerate cover" : "Generate cover"}
                </button>
                {!ps?.openart.configured && ps?.higgsfield.configured && <p className="text-[10px] text-gray-500">OpenArt keyed off — pass provider "higgsfield" via API, or key OpenArt.</p>}
                {ov.coverJobs.filter((j) => j.status !== "completed").slice(0, 2).map((j) => (
                  <div key={j.id} className="flex items-center gap-2 text-[11px] text-gray-400">
                    {j.status === "failed" ? <AlertTriangle size={12} color="#FF5B5B" /> : <RefreshCw size={12} className="animate-spin" style={{ color: AMBER }} />}
                    cover job: {j.status}{j.error ? ` — ${j.error.slice(0, 80)}` : ""}
                  </div>
                ))}
              </div>
            )}

            {section === "illustrations" && ov && (
              <div className="space-y-3">
                {ov.chapters.length === 0 && <div className="text-xs text-gray-500">No chapters yet.</div>}
                {ov.chapters.map((ch) => (
                  <div key={ch.id} className="rounded-lg border border-gray-800 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-200">Ch. {ch.chapterNumber} — {ch.title || "Untitled"}</span>
                      <button onClick={() => illMut.mutate(ch.id)} disabled={!anyConfigured || illMut.isPending}
                        className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-40">
                        Illustrate
                      </button>
                    </div>
                    {ch.illustrations.length > 0 && (
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {ch.illustrations.slice(0, 6).map((j) => j.outputs[0]
                          ? <img key={j.id} src={j.outputs[0].thumbUrl ?? j.outputs[0].url} className="aspect-video rounded object-cover" />
                          : <div key={j.id} className="flex aspect-video items-center justify-center rounded bg-gray-900 text-[9px]" style={{ color: j.status === "failed" ? "#FF5B5B" : AMBER }}>{j.status}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {section === "trailer" && ov && (
              <div className="space-y-3">
                <label className="block text-[10px] uppercase tracking-wide text-gray-500">Video model (Higgsfield default)</label>
                <select value={trailerModel} onChange={(e) => setTrailerModel(e.target.value)}
                  className="w-full rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-200">
                  <option value="">Pick a video model…</option>
                  {videoModels.map((m) => <option key={`${m.provider}:${m.id}`} value={m.id}>{m.displayName} ({m.provider})</option>)}
                </select>
                <p className="text-[10px] text-gray-500">Uses the book premise plus the cover and up to 3 illustrations as visual references.</p>
                <button onClick={() => trailerMut.mutate()} disabled={!ps?.higgsfield.configured || !trailerModel || trailerMut.isPending}
                  className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  {trailerMut.isPending ? "Dispatching…" : "Generate trailer"}
                </button>
                {ov.trailerJobs.slice(0, 3).map((j) => (
                  <div key={j.id} className="rounded-lg border border-gray-800 p-2">
                    {j.outputs[0] && j.status === "completed"
                      ? <video src={j.outputs[0].url} controls className="w-full rounded" />
                      : <div className="flex items-center gap-2 text-[11px] text-gray-400">
                          {j.status === "failed" ? <AlertTriangle size={12} color="#FF5B5B" /> : <RefreshCw size={12} className="animate-spin" style={{ color: AMBER }} />}
                          trailer: {j.status}{j.error ? ` — ${j.error.slice(0, 80)}` : ""}
                        </div>}
                  </div>
                ))}
              </div>
            )}

            {section === "narration" && ov && (
              <div className="space-y-3">
                <label className="block text-[10px] uppercase tracking-wide text-gray-500">Narrator voice (Higgsfield)</label>
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}
                  className="w-full rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-200">
                  <option value="">Default voice</option>
                  {(voicesQ.data?.voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {voicesQ.data?.warning && <p className="text-[10px]" style={{ color: AMBER }}>{voicesQ.data.warning}</p>}

                {ov.chapters.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-gray-200">Ch. {ch.chapterNumber} — {ch.title || "Untitled"}</div>
                      <div className="text-[10px]" style={{ color: ch.narration.state === "failed" ? "#FF5B5B" : ch.narration.state === "completed" ? "#2FE38A" : ch.narration.state === "running" ? AMBER : "#68758A" }}>
                        {ch.narration.state === "none" ? `${ch.contentChars.toLocaleString()} chars — not narrated`
                          : ch.narration.state === "completed" ? `narrated (${ch.narration.chunksTotal} chunk${ch.narration.chunksTotal === 1 ? "" : "s"})`
                          : ch.narration.state === "running" ? `narrating ${ch.narration.chunksDone}/${ch.narration.chunksTotal}`
                          : `failed (${ch.narration.chunksFailed}/${ch.narration.chunksTotal} chunks)`}
                      </div>
                    </div>
                    <button onClick={() => narrateMut.mutate(ch.id)}
                      disabled={!ps?.higgsfield.configured || narrateMut.isPending || ch.contentChars === 0 || ch.narration.state === "running"}
                      className="ml-2 shrink-0 rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-40">
                      {ch.narration.state === "none" ? "Narrate" : "Re-narrate"}
                    </button>
                  </div>
                ))}

                <button onClick={() => stitchMut.mutate()}
                  disabled={stitchMut.isPending || !ov.chapters.some((c) => c.narration.state === "completed")}
                  className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  {stitchMut.isPending ? "Stitching…" : "Stitch audiobook (completed chapters)"}
                </button>

                {ov.narrationExports.map((ex) => {
                  const exportId = ex.metadata?.exportId;
                  const stitched = ex.metadata?.stitched;
                  return (
                    <div key={ex.id} className="rounded-lg border border-gray-800 p-2 text-[11px] text-gray-300">
                      <div className="flex items-center justify-between">
                        <span>Audiobook export · {ex.metadata?.chapterCount ?? "?"} ch · {stitched ? "stitched" : "per-chapter files"}</span>
                        {exportId && stitched && (
                          <a className="flex items-center gap-1 text-blue-400 hover:underline"
                            href={bookMediaApi.narrationAudioUrl(cid!, ov.book.slug, exportId, "audiobook.mp3")} target="_blank" rel="noreferrer">
                            <Download size={11} /> mp3
                          </a>
                        )}
                      </div>
                      {exportId && stitched && (
                        <audio controls className="mt-1 w-full" src={bookMediaApi.narrationAudioUrl(cid!, ov.book.slug, exportId, "audiobook.mp3")} />
                      )}
                      {exportId && !stitched && (ex.metadata?.individualChapters ?? []).map((f) => (
                        <a key={f.filename} className="mr-2 text-blue-400 hover:underline"
                          href={bookMediaApi.narrationAudioUrl(cid!, ov.book.slug, exportId, f.filename)} target="_blank" rel="noreferrer">
                          Ch.{f.number}
                        </a>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

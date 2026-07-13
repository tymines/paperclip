// Book Media panel (Fable, 2026-07-12) — cover, chapter illustrations, book trailer,
// and per-chapter narration over the Creative Studio MCP providers. Self-contained
// slide-over drawer: BookWritingPage integration is one import + one JSX line, keeping
// the diff additive vs fable-book-build. Data-honest amber states when providers are
// keyed off — no mock output, ever.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard, ImageIcon, Film, Mic, RefreshCw, AlertTriangle, X, Download, Sparkles,
  // eslint-disable-next-line no-duplicate-imports
} from "lucide-react";
import { FolderOpen, ImagePlus, BookImage, Lock, Unlock } from "lucide-react";
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
  const [section, setSection] = useState<"cover" | "illustrations" | "trailer" | "narration" | "library">("cover");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [iconTarget, setIconTarget] = useState<Record<string, string>>({}); // jobId -> characterId
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
  // Book Media image lane (cover + illustrations) works with ANY of OpenArt,
  // Higgsfield, or Replicate (Flux) — the server prefers the MCPs but falls back
  // to the configured 'replicate' key. The amber wall only shows when none exist.
  const imageProviderConfigured = !!(ps?.higgsfield.configured || ps?.openart.configured || ps?.replicate?.configured);
  const videoModels = useMemo(
    () => (modelsQ.data?.models ?? []).filter((m) => m.modes.includes("video")),
    [modelsQ.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["book-media", cid, bookId] });
  const onErr = (e: any) => pushToast({ title: "Request failed", body: String(e?.message ?? e).slice(0, 180), tone: "error" });

  const coverMut = useMutation({ mutationFn: () => bookMediaApi.generateCover(cid!, bookId), onSuccess: invalidate, onError: onErr });
  const illMut = useMutation({ mutationFn: (chapterId: string) => bookMediaApi.generateIllustration(cid!, bookId, { chapterId }), onSuccess: invalidate, onError: onErr });
  const trailerMut = useMutation({
    mutationFn: () => bookMediaApi.generateTrailer(cid!, bookId, { model: trailerModel }),
    onSuccess: invalidate, onError: onErr,
  });
  const narrateMut = useMutation({
    mutationFn: (chapterId: string) => bookMediaApi.narrateChapter(cid!, bookId, chapterId, voiceId ? { voiceId } : {}),
    onSuccess: (r) => { invalidate(); pushToast({ title: `Narration dispatched (${r.chunks} chunk${r.chunks === 1 ? "" : "s"})`, tone: "success" }); },
    onError: onErr,
  });
  const applyMut = useMutation({
    mutationFn: ({ jobId, action, characterId }: { jobId: string; action: "set-cover" | "set-character-icon"; characterId?: string }) =>
      bookMediaApi.applyAsset(cid!, bookId, jobId, { action, characterId }),
    onSuccess: (r) => {
      invalidate();
      pushToast({
        title: r.applied === "set-cover" ? "Cover updated" : "Character icon updated",
        body: r.persisted === false ? "Warning: could not save a permanent copy — the source URL may expire." : "Saved permanently.",
        tone: r.persisted === false ? "info" : "success",
      });
    },
    onError: onErr,
  });
  const lockMut = useMutation({
    mutationFn: (body: { target: "cover" | "character-icon"; characterId?: string; locked: boolean }) =>
      bookMediaApi.setLock(cid!, bookId, body),
    onSuccess: (r) => { invalidate(); pushToast({ title: r.locked ? "Locked — won't be auto-replaced" : "Unlocked", tone: "success" }); },
    onError: onErr,
  });
  const [coverImgBroken, setCoverImgBroken] = useState(false);
  // A new cover URL gets a fresh chance to load (e.g. after self-heal to local storage).
  useEffect(() => { setCoverImgBroken(false); }, [overviewQ.data?.book.coverUrl]);

  const stitchMut = useMutation({
    mutationFn: () => bookMediaApi.stitchNarration(cid!, bookId),
    onSuccess: (r) => { invalidate(); pushToast({ title: r.stitched ? "Audiobook stitched" : "Exported per-chapter files (ffmpeg unavailable)", tone: r.stitched ? "success" : "info" }); },
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

          {ps && !imageProviderConfigured && (
            <div className="m-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: AMBER, color: AMBER }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>No image provider configured for Book Media. Add a Replicate key (Settings → Provider Keys, or set REPLICATE_API_TOKEN) to generate covers and illustrations with Flux — or key OpenArt/Higgsfield (OAuth pending). Nothing here is mocked — generation stays disabled until keyed.</span>
            </div>
          )}

          <div className="flex gap-1 border-b border-gray-800 px-3 py-2">
            {([["cover", ImageIcon, "Cover"], ["illustrations", Sparkles, "Illustrations"], ["trailer", Film, "Trailer"], ["narration", Mic, "Narration"], ["library", FolderOpen, "Library"]] as const).map(([key, Icon, label]) => (
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
                {ov.book.coverUrl && !coverImgBroken
                  ? <img src={ov.book.coverUrl} alt="Book cover" onError={() => setCoverImgBroken(true)}
                      className="mx-auto w-48 rounded-lg border border-gray-800" />
                  : ov.book.coverUrl && coverImgBroken
                  ? <div className="mx-auto flex h-64 w-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center text-[11px]" style={{ borderColor: AMBER, color: AMBER }}>
                      <AlertTriangle size={16} />
                      Cover image unavailable — its source URL has expired. Regenerate, or pick one from the Library (new picks are saved permanently).
                    </div>
                  : <div className="mx-auto flex h-64 w-48 items-center justify-center rounded-lg border border-dashed border-gray-700 text-xs text-gray-600">No cover yet</div>}
                {ov.book.coverUrl && (
                  <button onClick={() => lockMut.mutate({ target: "cover", locked: !ov.book.coverLocked })} disabled={lockMut.isPending}
                    title={ov.book.coverLocked ? "Locked: this cover is never auto-replaced. Click to unlock." : "Lock this cover so nothing auto-replaces it"}
                    className={`mx-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] ${ov.book.coverLocked ? "border-amber-500/50 text-amber-400" : "border-gray-700 text-gray-400 hover:text-gray-200"}`}>
                    {ov.book.coverLocked ? <Lock size={11} /> : <Unlock size={11} />}
                    {ov.book.coverLocked ? "Cover locked" : "Lock cover"}
                  </button>
                )}
                <button onClick={() => coverMut.mutate()} disabled={!imageProviderConfigured || coverMut.isPending}
                  className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  {coverMut.isPending ? "Dispatching…" : ov.book.coverUrl ? "Regenerate cover" : "Generate cover"}
                </button>
                {ov.book.coverUrl && !ov.book.coverLocked && (
                  <p className="text-center text-[10px] text-gray-600">Regenerating adds to the Library — your current cover only changes when you pick "Set as cover".</p>
                )}
                {!ps?.openart.configured && !ps?.higgsfield.configured && ps?.replicate?.configured && (
                  <p className="text-[10px] text-gray-500">Using Replicate (Flux) — OpenArt/Higgsfield not keyed.</p>
                )}
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
                      <button onClick={() => illMut.mutate(ch.id)} disabled={!imageProviderConfigured || illMut.isPending}
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

            {section === "library" && ov && (
              <div className="space-y-3">
                {/* per-book asset library: every asset generated for this book */}
                <div className="flex flex-wrap gap-1.5">
                  {["all", "cover", "character-icon", "illustration", "trailer", "narration"].map((f) => (
                    <button key={f} onClick={() => setAssetFilter(f)}
                      className={`rounded px-2 py-1 text-[10px] ${assetFilter === f ? "bg-blue-600/20 text-blue-400 border border-blue-500/50" : "bg-gray-800 text-gray-400 border border-gray-700"}`}>
                      {f === "character-icon" ? "icons" : f}
                    </button>
                  ))}
                </div>
                {(ov.assets ?? [])
                  .filter((a) => assetFilter === "all"
                    || (assetFilter === "narration" ? a.purpose.startsWith("narration") : a.purpose === assetFilter))
                  .map((a) => {
                    const out = a.outputs[0];
                    const ch = a.characterId ? ov.characters?.find((c) => c.id === a.characterId) : null;
                    const isImage = a.mode === "image" && a.status === "completed" && !!out;
                    return (
                      <div key={a.id} className="flex gap-2.5 rounded-lg border border-gray-800 p-2">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-gray-900 flex items-center justify-center">
                          {out && a.mode === "image" && <img src={out.thumbUrl ?? out.url} className="h-full w-full object-cover" />}
                          {out && a.mode === "video" && <video src={out.url} muted className="h-full w-full object-cover" />}
                          {(!out || a.mode === "audio") && <span className="text-[9px] text-gray-600">{a.status}</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-400">{a.purpose}</span>
                            {ch && <span className="truncate text-[10px] text-gray-500">{ch.name}</span>}
                            <span className="ml-auto text-[9px]" style={{ color: a.status === "completed" ? "#2FE38A" : a.status === "failed" ? "#FF5B5B" : AMBER }}>{a.status}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-gray-500">{a.prompt || "(no prompt)"}</div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            {out && (
                              <a href={out.url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[9px] text-gray-300 hover:bg-gray-700">
                                <Download size={9} /> download
                              </a>
                            )}
                            {isImage && (
                              <button onClick={() => applyMut.mutate({ jobId: a.id, action: "set-cover" })}
                                disabled={applyMut.isPending}
                                className="flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[9px] text-gray-300 hover:bg-gray-700 disabled:opacity-40">
                                <BookImage size={9} /> set cover
                              </button>
                            )}
                            {isImage && (ov.characters?.length ?? 0) > 0 && (
                              <span className="flex items-center gap-1">
                                <select value={iconTarget[a.id] ?? ""} onChange={(e) => setIconTarget({ ...iconTarget, [a.id]: e.target.value })}
                                  className="rounded border border-gray-800 bg-gray-900 px-1 py-0.5 text-[9px] text-gray-300">
                                  <option value="">icon for…</option>
                                  {ov.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <button
                                  onClick={() => iconTarget[a.id] && applyMut.mutate({ jobId: a.id, action: "set-character-icon", characterId: iconTarget[a.id] })}
                                  disabled={!iconTarget[a.id] || applyMut.isPending}
                                  className="flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[9px] text-gray-300 hover:bg-gray-700 disabled:opacity-40">
                                  <ImagePlus size={9} /> set
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {(ov.assets ?? []).length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-[11px] text-gray-600">
                    No assets yet — covers, icons, illustrations, trailers, and narration all land here.
                  </div>
                )}
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

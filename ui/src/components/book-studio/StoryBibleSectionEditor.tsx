import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { GenerateDraftPanel } from "./GenerateDraftPanel";
import type { LegacyStoryBibleSectionId } from "./storyBibleSections";
import {
  apiFetch,
  CharacterCardComponent,
  CreateCharacterForm,
  CreateLocationForm,
  CreateStyleForm,
  LocationCardComponent,
  OverviewEditor,
  StyleCardComponent,
  type BookData,
  type CharacterEntity,
  type StyleEntity,
  type WorldLocationEntity,
} from "../../pages/BookWritingPage";

export interface StoryBibleSectionEditorProps {
  companySlug: string;
  book: BookData;
  section: LegacyStoryBibleSectionId;
  onBookUpdated: (book: BookData) => void;
  onChanged?: () => void;
}

export function StoryBibleSectionEditor({ companySlug, book, section, onBookUpdated, onChanged }: StoryBibleSectionEditorProps) {
  const [characters, setCharacters] = useState<CharacterEntity[]>([]);
  const [locations, setLocations] = useState<WorldLocationEntity[]>([]);
  const [styles, setStyles] = useState<StyleEntity[]>([]);
  const [loading, setLoading] = useState(section !== "overview");
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const requestScopeRef = useRef(0);

  const prefix = `/companies/${companySlug}/book-studio/books/${book.id}`;

  const load = useCallback(async () => {
    const requestScope = ++requestScopeRef.current;
    setCharacters([]);
    setLocations([]);
    setStyles([]);
    setShowCreate(false);
    setShowGenerate(false);
    setError(null);
    if (section === "overview") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (section === "characters") {
        const result = await apiFetch<{ characters: CharacterEntity[] }>(`${prefix}/characters`);
        if (requestScopeRef.current === requestScope) setCharacters(result.characters ?? []);
      } else if (section === "world-locations") {
        const result = await apiFetch<{ "world-locations": WorldLocationEntity[] }>(`${prefix}/world-locations`);
        if (requestScopeRef.current === requestScope) setLocations(result["world-locations"] ?? []);
      } else {
        const result = await apiFetch<{ style: StyleEntity[] }>(`${prefix}/style`);
        if (requestScopeRef.current === requestScope) setStyles(result.style ?? []);
      }
    } catch (err) {
      if (requestScopeRef.current === requestScope) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestScopeRef.current === requestScope) setLoading(false);
    }
  }, [prefix, section]);

  useEffect(() => {
    void load();
    return () => { requestScopeRef.current += 1; };
  }, [load]);

  const run = async (operation: () => Promise<void>) => {
    setError(null);
    try {
      await operation();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateBook = async (data: { title?: string; metadata?: Record<string, unknown> }) => {
    const result = await apiFetch<{ book: BookData }>(prefix, { method: "PATCH", body: JSON.stringify(data) });
    onBookUpdated(result.book);
    onChanged?.();
  };

  if (section === "overview") {
    return <div data-story-bible-section={section}>
      <OverviewEditor key={book.id} book={book} loading={false} onUpdate={updateBook} />
      <div className="px-4 pb-4">
        <button onClick={() => setShowGenerate((value) => !value)} className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-purple-400 hover:text-purple-200">
          <Sparkles className="h-3 w-3" /> Generate with Calliope
        </button>
        {showGenerate && <GenerateDraftPanel entityType="overview" bookId={book.id} companySlug={companySlug}
          onDiscard={() => setShowGenerate(false)}
          onAccept={(draft) => void run(async () => {
            await updateBook({
              title: typeof draft.title === "string" && draft.title.trim() ? draft.title.trim() : book.title,
              metadata: { description: typeof draft.description === "string" ? draft.description : "" },
            });
            setShowGenerate(false);
          })} />}
      </div>
    </div>;
  }

  const empty = section === "characters" ? characters.length === 0 : section === "world-locations" ? locations.length === 0 : styles.length === 0;
  const label = section === "characters" ? "Character" : section === "world-locations" ? "Location" : "Style Entry";
  const bookSlug = book.slug;

  return (
    <div className="min-h-full p-4" data-story-bible-section={section}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-lg text-gray-100">{section === "world-locations" ? "Locations" : section === "characters" ? "Characters" : "Style"}</h2>
          <p className="text-[11px] text-gray-500">Edits are saved to this book and locked records stay protected.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 rounded border border-white/15 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5">
          <Plus className="h-3 w-3" /> Add {label}
        </button>
      </div>

      {error && <div role="alert" className="mb-3 rounded border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {loading && <div className="py-8 text-center text-xs text-gray-500">Loading {label.toLowerCase()} data…</div>}

      {!loading && showCreate && section === "characters" && (
        <CreateCharacterForm onCancel={() => setShowCreate(false)} onSave={(data) => void run(async () => {
          const result = await apiFetch<{ character: CharacterEntity }>(`${prefix}/characters`, { method: "POST", body: JSON.stringify(data) });
          setCharacters((current) => [...current, result.character]); setShowCreate(false);
        })} />
      )}
      {!loading && showCreate && section === "world-locations" && (
        <CreateLocationForm onCancel={() => setShowCreate(false)} onSave={(data) => void run(async () => {
          const result = await apiFetch<{ "world-location": WorldLocationEntity }>(`${prefix}/world-locations`, { method: "POST", body: JSON.stringify(data) });
          setLocations((current) => [...current, result["world-location"]]); setShowCreate(false);
        })} />
      )}
      {!loading && showCreate && section === "style" && (
        <CreateStyleForm onCancel={() => setShowCreate(false)} onSave={(data) => void run(async () => {
          const result = await apiFetch<{ "style-entry": StyleEntity }>(`${prefix}/style`, { method: "POST", body: JSON.stringify(data) });
          setStyles((current) => [...current, result["style-entry"]]); setShowCreate(false);
        })} />
      )}

      {!loading && empty && !showCreate && <div className="rounded border border-dashed border-gray-800 px-4 py-8 text-center text-xs text-gray-500">No {label.toLowerCase()} records yet.</div>}
      {!loading && section === "characters" && characters.map((character) => (
        <div className="mb-2" key={character.id}><CharacterCardComponent char={character} bookId={book.id} companySlug={companySlug} bookSlug={bookSlug}
          onUpdate={(id, data) => void run(async () => { await apiFetch(`${prefix}/characters/${id}`, { method: "PATCH", body: JSON.stringify(data) }); setCharacters((rows) => rows.map((row) => row.id === id ? { ...row, ...data } : row)); })}
          onDelete={(id) => void run(async () => { await apiFetch(`${prefix}/characters/${id}`, { method: "DELETE" }); setCharacters((rows) => rows.filter((row) => row.id !== id)); })} /></div>
      ))}
      {!loading && section === "world-locations" && locations.map((location) => (
        <div className="mb-2" key={location.id}><LocationCardComponent loc={location} bookId={book.id} companySlug={companySlug} bookSlug={bookSlug}
          onUpdate={(id, data) => void run(async () => { await apiFetch(`${prefix}/world-locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }); setLocations((rows) => rows.map((row) => row.id === id ? { ...row, ...data } : row)); })}
          onDelete={(id) => void run(async () => { await apiFetch(`${prefix}/world-locations/${id}`, { method: "DELETE" }); setLocations((rows) => rows.filter((row) => row.id !== id)); })} /></div>
      ))}
      {!loading && section === "style" && styles.map((entry) => (
        <div className="mb-2" key={entry.id}><StyleCardComponent entry={entry} bookId={book.id} companySlug={companySlug} bookSlug={bookSlug}
          onUpdate={(id, data) => void run(async () => { await apiFetch(`${prefix}/style/${id}`, { method: "PATCH", body: JSON.stringify(data) }); setStyles((rows) => rows.map((row) => row.id === id ? { ...row, ...data } : row)); })}
          onDelete={(id) => void run(async () => { await apiFetch(`${prefix}/style/${id}`, { method: "DELETE" }); setStyles((rows) => rows.filter((row) => row.id !== id)); })} /></div>
      ))}

      {!loading && (
        <div className="mt-3">
          <button onClick={() => setShowGenerate((value) => !value)} className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-purple-400 hover:text-purple-200">
            <Sparkles className="h-3 w-3" /> Generate with Calliope
          </button>
          {showGenerate && (
            <GenerateDraftPanel entityType={section === "world-locations" ? "location" : section === "characters" ? "character" : "style"} bookId={book.id} companySlug={companySlug}
              onDiscard={() => setShowGenerate(false)}
              onAccept={(draft) => {
                setShowGenerate(false);
                if (section === "characters") void run(async () => { const result = await apiFetch<{ character: CharacterEntity }>(`${prefix}/characters`, { method: "POST", body: JSON.stringify({ name: draft.name || "New Character", role: draft.role || "", description: draft.description || "", voiceCard: draft.voiceCard || {}, source: "co_created" }) }); setCharacters((rows) => [...rows, result.character]); });
                else if (section === "world-locations") void run(async () => { const result = await apiFetch<{ "world-location": WorldLocationEntity }>(`${prefix}/world-locations`, { method: "POST", body: JSON.stringify({ name: draft.name || "New Location", description: draft.description || "", rules: draft.rules || {}, sensoryNotes: draft.sensoryNotes || {}, source: "co_created" }) }); setLocations((rows) => [...rows, result["world-location"]]); });
                else void run(async () => { const result = await apiFetch<{ "style-entry": StyleEntity }>(`${prefix}/style`, { method: "POST", body: JSON.stringify({ pov: draft.pov || "", tense: draft.tense || "", comps: draft.comps || "", sampleParagraph: draft.sampleParagraph || "", bannedCliches: Array.isArray(draft.bannedCliches) ? draft.bannedCliches : [], tropes: Array.isArray(draft.tropes) ? draft.tropes : [], source: "co_created" }) }); setStyles((rows) => [...rows, result["style-entry"]]); });
              }} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Prompts — a categorized, filterable prompt library.
 *
 * A place to collect reusable prompts (superpowers patterns, dev prompts from
 * GitHub research, agent role prompts) plus imported CC0 prompts from
 * f/prompts.chat. Features: full-text search, category + tag filters, a detail
 * view with one-click copy, template fill for {{variables}}, and add/edit of
 * your own prompts. Themed to the re-locked blue Design System.
 *
 * Phase 2 (scoped, not built): "send this prompt to an agent" action, and
 * wiring the prompts.chat MCP for live sync. See report.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  Library,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { promptsApi, type Prompt, type PromptCategory } from "../api/prompts";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "../components/EmptyState";

const PROMPTS_QUERY_KEY = (companyId: string) => ["prompts", "list", companyId];

function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (full, name: string) => {
    const v = values[name.trim()];
    return v && v.length ? v : full;
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

type EditorDraft = {
  id: string | null;
  title: string;
  category: string;
  tags: string;
  body: string;
};

const EMPTY_DRAFT: EditorDraft = {
  id: null,
  title: "",
  category: "misc",
  tags: "",
  body: "",
};

export function Prompts() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft>(EMPTY_DRAFT);

  useEffect(() => {
    setBreadcrumbs([{ label: "Prompts" }]);
  }, [setBreadcrumbs]);

  const query = useQuery({
    queryKey: PROMPTS_QUERY_KEY(selectedCompanyId ?? "__none__"),
    queryFn: () => promptsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const allPrompts = query.data?.prompts ?? [];
  const categories: PromptCategory[] = query.data?.categories ?? [];
  const tagFacet = query.data?.tags ?? [];

  const categoryLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.key, c.label);
    return (key: string) => map.get(key) ?? key;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPrompts.filter((p) => {
      if (activeCategory !== "all" && p.category !== activeCategory) return false;
      if (activeTags.length && !activeTags.every((t) => p.tags.includes(t))) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        (p.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [allPrompts, search, activeCategory, activeTags]);

  const selected = useMemo(
    () => allPrompts.find((p) => p.id === selectedId) ?? null,
    [allPrompts, selectedId],
  );

  // Reset template inputs whenever a different prompt is opened.
  useEffect(() => {
    if (selected) {
      const init: Record<string, string> = {};
      for (const v of selected.variables) init[v] = "";
      setTemplateValues(init);
      setCopied(false);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: PROMPTS_QUERY_KEY(selectedCompanyId ?? "__none__"),
    });

  const createMutation = useMutation({
    mutationFn: (input: { title: string; body: string; category: string; tags: string[] }) =>
      promptsApi.create(selectedCompanyId!, input),
    onSuccess: ({ prompt }) => {
      pushToast({ title: `Saved "${prompt.title}"`, tone: "success" });
      setEditorOpen(false);
      setDraft(EMPTY_DRAFT);
      invalidate();
      setSelectedId(prompt.id);
    },
    onError: (err: Error) => pushToast({ title: "Failed to save prompt", body: err.message, tone: "error" }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; title: string; body: string; category: string; tags: string[] }) =>
      promptsApi.update(selectedCompanyId!, input.id, input),
    onSuccess: ({ prompt }) => {
      pushToast({ title: `Updated "${prompt.title}"`, tone: "success" });
      setEditorOpen(false);
      setDraft(EMPTY_DRAFT);
      invalidate();
    },
    onError: (err: Error) => pushToast({ title: "Failed to update prompt", body: err.message, tone: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => promptsApi.remove(selectedCompanyId!, id),
    onSuccess: () => {
      pushToast({ title: "Prompt deleted", tone: "info" });
      setSelectedId(null);
      invalidate();
    },
    onError: (err: Error) => pushToast({ title: "Failed to delete prompt", body: err.message, tone: "error" }),
  });

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT, category: activeCategory !== "all" ? activeCategory : "misc" });
    setEditorOpen(true);
  }
  function openEdit(p: Prompt) {
    setDraft({ id: p.id, title: p.title, category: p.category, tags: p.tags.join(", "), body: p.body });
    setEditorOpen(true);
  }
  function saveDraft() {
    const tags = draft.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const payload = { title: draft.title.trim(), body: draft.body.trim(), category: draft.category, tags };
    if (!payload.title || !payload.body) {
      pushToast({ title: "Title and body are required", tone: "error" });
      return;
    }
    if (draft.id) updateMutation.mutate({ id: draft.id, ...payload });
    else createMutation.mutate(payload);
  }

  const filledBody = selected ? fillTemplate(selected.body, templateValues) : "";

  async function handleCopy() {
    if (!selected) return;
    const ok = await copyText(filledBody);
    if (ok) {
      setCopied(true);
      pushToast({ title: "Copied to clipboard", tone: "success" });
      setTimeout(() => setCopied(false), 1800);
    } else {
      pushToast({ title: "Copy failed — select and copy manually", tone: "error" });
    }
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Library}
        message="No company selected — pick a company to view its prompt library."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background/60">
            <Library className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Prompts</h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              A reusable prompt library — superpowers patterns, agent roles and dev prompts, plus
              community prompts. Filter, fill templates, and copy in one click.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> New prompt
        </Button>
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prompts by title, text, tag or source"
          className="pl-9"
          aria-label="Search prompts"
        />
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        <CategoryPill
          active={activeCategory === "all"}
          label="All"
          count={allPrompts.length}
          onClick={() => setActiveCategory("all")}
        />
        {categories
          .filter((c) => c.count > 0)
          .map((c) => (
            <CategoryPill
              key={c.key}
              active={activeCategory === c.key}
              label={c.label}
              count={c.count}
              onClick={() => setActiveCategory(c.key)}
            />
          ))}
      </div>

      {/* Tag filter */}
      {tagFacet.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {(showAllTags ? tagFacet : tagFacet.slice(0, 14)).map(({ tag, count }) => {
            const on = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setActiveTags((prev) =>
                    on ? prev.filter((t) => t !== tag) : [...prev, tag],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  on
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {tag} <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
          {tagFacet.length > 14 && (
            <button
              type="button"
              onClick={() => setShowAllTags((s) => !s)}
              className="rounded-full px-2 py-0.5 text-[11px] text-primary hover:underline"
            >
              {showAllTags ? "Show less" : `+${tagFacet.length - 14} more`}
            </button>
          )}
          {activeTags.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTags([])}
              className="ml-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="text-xs text-muted-foreground">
        {query.isLoading ? "Loading…" : `${filtered.length} prompt${filtered.length === 1 ? "" : "s"}`}
      </div>

      {filtered.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={Sparkles}
          message="No prompts match — try clearing filters or search, or add your own prompt."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              categoryLabel={categoryLabel(p.category)}
              onOpen={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  {selected.title}
                  {selected.isTemplate && (
                    <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                      <Wand2 className="h-3 w-3" /> Template
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {categoryLabel(selected.category)}
                  </Badge>
                  {selected.source && (
                    <span className="text-[11px] text-muted-foreground">
                      Source: {selected.sourceUrl ? (
                        <a
                          href={selected.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        >
                          {selected.source} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        selected.source
                      )}
                      {selected.license ? ` · ${selected.license}` : ""}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
                {selected.variables.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Wand2 className="h-3.5 w-3.5 text-primary" /> Fill the template
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {selected.variables.map((v) => (
                        <div key={v} className="space-y-1">
                          <Label className="text-[11px] font-mono text-muted-foreground">{`{{${v}}}`}</Label>
                          <Input
                            value={templateValues[v] ?? ""}
                            onChange={(e) =>
                              setTemplateValues((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            placeholder={v}
                            className="h-8 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-3 text-xs leading-relaxed text-foreground">
                  {filledBody}
                </pre>

                {selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((t) => (
                      <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <div className="flex gap-2">
                  {selected.editable && (
                    <>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(selected)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(selected.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </>
                  )}
                </div>
                <Button onClick={handleCopy} className="gap-1.5">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy to clipboard"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Editor dialog (create / edit) */}
      <Dialog open={editorOpen} onOpenChange={(o) => { setEditorOpen(o); if (!o) setDraft(EMPTY_DRAFT); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {draft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {draft.id ? "Edit prompt" : "New prompt"}
            </DialogTitle>
            <DialogDescription>
              Use <code className="font-mono text-primary">{`{{placeholders}}`}</code> for template
              variables — they become fill-in fields before copy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="p-title">Title</Label>
              <Input
                id="p-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Weekly status update"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="p-cat">Category</Label>
                <select
                  id="p-cat"
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-tags">Tags (comma-separated)</Label>
                <Input
                  id="p-tags"
                  value={draft.tags}
                  onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                  placeholder="status, weekly"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-body">Prompt body</Label>
              <Textarea
                id="p-body"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder="Write your prompt. Use {{variables}} for fill-in fields."
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditorOpen(false); setDraft(EMPTY_DRAFT); }}>
              Cancel
            </Button>
            <Button onClick={saveDraft} disabled={createMutation.isPending || updateMutation.isPending}>
              {draft.id ? "Save changes" : "Create prompt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {label} <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function PromptCard({
  prompt,
  categoryLabel,
  onOpen,
}: {
  prompt: Prompt;
  categoryLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-4 text-left shadow-sm transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-foreground">{prompt.title}</h3>
        {prompt.isTemplate && (
          <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Template" />
        )}
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">{prompt.body}</p>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase text-muted-foreground">
          {categoryLabel}
        </Badge>
        {prompt.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
            {t}
          </Badge>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        <span className="truncate">{prompt.source ?? "Custom"}</span>
        {prompt.editable && <span className="text-primary/70">yours</span>}
      </div>
    </button>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  designApi,
  type DesignPreset,
  type DesignRun,
  type DesignSkill,
} from "../api/design";
import { useCompany } from "../context/CompanyContext";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const PRESET_TERMINAL = new Set(["completed", "failed", "partial"]);

export default function Design() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? null;
  const qc = useQueryClient();

  const skillsQ = useQuery({
    queryKey: ["design", "skills"],
    queryFn: () => designApi.skills(),
    staleTime: 5 * 60_000,
  });
  const agentsQ = useQuery({
    queryKey: ["design", "agents"],
    queryFn: () => designApi.agents(),
    staleTime: 60_000,
  });
  const runsQ = useQuery({
    queryKey: ["design", "runs", companyId],
    queryFn: () => designApi.listRuns(companyId, 25),
    refetchInterval: (q) => {
      const runs = q.state.data?.runs ?? [];
      return runs.some((r) => !TERMINAL.has(r.status)) ? POLL_INTERVAL_MS : false;
    },
  });

  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<string>("");
  const [selectedSkill, setSelectedSkill] = useState<DesignSkill | null>(null);
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("claude");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Preset state
  const [activePreset, setActivePreset] = useState<DesignPreset | null>(null);
  const [presetBrief, setPresetBrief] = useState("");
  const [presetVoice, setPresetVoice] = useState("");
  const [activePresetRunId, setActivePresetRunId] = useState<string | null>(null);

  const presetsQ = useQuery({
    queryKey: ["design", "presets"],
    queryFn: () => designApi.presets(),
    staleTime: 5 * 60_000,
  });

  const presetRunQ = useQuery({
    queryKey: ["design", "preset-run", activePresetRunId],
    queryFn: () => designApi.getPresetRun(activePresetRunId!),
    enabled: !!activePresetRunId,
    refetchInterval: (q) => {
      const s = q.state.data?.preset.status;
      return s && PRESET_TERMINAL.has(s) ? false : POLL_INTERVAL_MS;
    },
  });

  const startPresetMutation = useMutation({
    mutationFn: () => {
      if (!activePreset) throw new Error("pick a preset");
      if (!presetBrief.trim()) throw new Error("brief required");
      return designApi.startPresetRun(activePreset.slug, {
        companyId,
        brief: presetBrief,
        voice: presetVoice.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setActivePresetRunId(data.preset.id);
      qc.invalidateQueries({ queryKey: ["design", "runs"] });
    },
  });

  useEffect(() => {
    if (selectedSkill?.examplePrompt && !prompt) setPrompt(selectedSkill.examplePrompt);
  }, [selectedSkill, prompt]);

  useEffect(() => {
    const agents = agentsQ.data?.agents ?? [];
    if (agents.length > 0 && !agents.find((a) => a.id === agentId && a.available)) {
      const fallback = agents.find((a) => a.available);
      if (fallback) setAgentId(fallback.id);
    }
  }, [agentsQ.data, agentId]);

  const startMutation = useMutation({
    mutationFn: () => {
      if (!selectedSkill) throw new Error("pick a skill");
      if (!prompt.trim()) throw new Error("prompt required");
      return designApi.startRun(companyId, {
        skill: selectedSkill.id,
        prompt,
        agentId,
      });
    },
    onSuccess: (data) => {
      setSelectedRunId(data.run.id);
      qc.invalidateQueries({ queryKey: ["design", "runs"] });
    },
  });

  const skills = skillsQ.data?.skills ?? [];
  const modes = useMemo(() => {
    const s = new Set<string>();
    for (const sk of skills) s.add(sk.mode);
    return Array.from(s).sort();
  }, [skills]);
  const filtered = useMemo(() => {
    const lc = search.toLowerCase();
    return skills.filter(
      (s) =>
        (!mode || s.mode === mode) &&
        (lc === "" ||
          s.id.toLowerCase().includes(lc) ||
          s.name.toLowerCase().includes(lc) ||
          s.description.toLowerCase().includes(lc)),
    );
  }, [skills, search, mode]);

  const runs = runsQ.data?.runs ?? [];
  const activeRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) ?? null : null;

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Design</h1>
          <p className="text-sm text-muted-foreground">
            {skills.length > 0
              ? `${skills.length} skills · pick one, write a brief, hit Run.`
              : skillsQ.isLoading
                ? "Loading skills…"
                : "Daemon offline. Start open-design on :18800."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">
            agent: {agentId}
          </span>
          {agentsQ.data?.agents
            .filter((a) => a.available)
            .slice(0, 4)
            .map((a) => (
              <button
                key={a.id}
                onClick={() => setAgentId(a.id)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  a.id === agentId ? "border-foreground" : "border-border opacity-60 hover:opacity-100"
                }`}
                title={a.path}
              >
                {a.name}
              </button>
            ))}
        </div>
      </header>

      <PresetCardsRow
        presets={presetsQ.data?.presets ?? []}
        activeSlug={activePreset?.slug ?? null}
        onPick={(p) => {
          setActivePreset((cur) => (cur?.slug === p.slug ? null : p));
          setPresetBrief("");
          setActivePresetRunId(null);
        }}
      />

      {activePreset ? (
        <PresetBriefPanel
          preset={activePreset}
          brief={presetBrief}
          onBriefChange={setPresetBrief}
          voice={presetVoice}
          onVoiceChange={setPresetVoice}
          onRun={() => startPresetMutation.mutate()}
          submitting={startPresetMutation.isPending}
          error={
            startPresetMutation.isError
              ? (startPresetMutation.error as Error).message
              : null
          }
          presetRun={presetRunQ.data ?? null}
          onClose={() => {
            setActivePreset(null);
            setActivePresetRunId(null);
          }}
        />
      ) : null}

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Picker + history column */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
              placeholder="Filter skills"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="">all modes</option>
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
            <ul className="divide-y divide-border">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSkill(s)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted ${
                      selectedSkill?.id === s.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-xs">{s.id}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {s.mode}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {s.description}
                    </span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && !skillsQ.isLoading ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">No skills match.</li>
              ) : null}
            </ul>
          </div>

          <details className="rounded border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              History ({runs.length})
            </summary>
            <ul className="max-h-72 divide-y divide-border overflow-auto">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(r.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted ${
                      selectedRunId === r.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2 text-xs">
                      <span className="font-mono">{r.skill}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                          r.status === "completed"
                            ? "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-200"
                            : r.status === "failed"
                              ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200"
                              : "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-200"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {r.prompt}
                    </span>
                  </button>
                </li>
              ))}
              {runs.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">No runs yet.</li>
              ) : null}
            </ul>
          </details>
        </div>

        {/* Brief + preview column */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded border border-border p-3">
            {selectedSkill ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-mono text-sm">{selectedSkill.id}</h2>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {selectedSkill.mode}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{selectedSkill.description}</p>
                <textarea
                  className="min-h-[120px] rounded border border-border bg-background p-2 text-sm"
                  placeholder={selectedSkill.examplePrompt ?? "Describe the artifact you want…"}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {selectedSkill.examplePrompt ? "Example prompt prefilled" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending || !prompt.trim()}
                    className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
                  >
                    {startMutation.isPending ? "Starting…" : "Run"}
                  </button>
                </div>
                {startMutation.isError ? (
                  <p className="text-xs text-red-600">
                    {(startMutation.error as Error).message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Pick a skill on the left.</p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
              <span className="font-mono">
                {activeRun ? activeRun.id : "preview"}
              </span>
              <div className="flex items-center gap-2">
                {activeRun?.status && (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {activeRun.status}
                  </span>
                )}
                {activeRun?.assetUrl ? (
                  <a
                    href={activeRun.assetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                  >
                    open
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-muted/30">
              {activeRun?.assetUrl ? (
                <iframe
                  title="design preview"
                  src={activeRun.assetUrl}
                  sandbox="allow-scripts allow-same-origin"
                  className="h-full w-full border-0"
                />
              ) : activeRun?.status && !TERMINAL.has(activeRun.status) ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  {activeRun.status}… the agent is working on it.
                </div>
              ) : activeRun?.error ? (
                <div className="grid h-full place-items-center px-4 text-center text-sm text-red-600">
                  {activeRun.error}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  Run a skill to see the preview here.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Preset surface — Marketing kit / Landing page / Influencer post pack /
// Brand kit / Email blast. One brief → 1–N skill runs aggregated together.
// ─────────────────────────────────────────────────────────────────────────

interface PresetCardsRowProps {
  presets: DesignPreset[];
  activeSlug: string | null;
  onPick: (preset: DesignPreset) => void;
}

function PresetCardsRow({ presets, activeSlug, onPick }: PresetCardsRowProps) {
  if (presets.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Presets</h2>
        <span className="text-xs text-muted-foreground">
          One brief in, full kit out · {presets.length} curated macros
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {presets.map((p) => {
          const active = activeSlug === p.slug;
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => onPick(p)}
              className={`group flex h-full flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-foreground bg-accent/30"
                  : "border-border bg-card hover:border-foreground/60 hover:bg-accent/20"
              }`}
              data-testid={`preset-card-${p.slug}`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.cardEmoji}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {p.stepCount} step{p.stepCount === 1 ? "" : "s"} · {p.estimateMin}
                </span>
              </div>
              <span className="text-sm font-medium leading-tight">{p.name}</span>
              <span className="line-clamp-3 text-xs text-muted-foreground">
                {p.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PresetBriefPanelProps {
  preset: DesignPreset;
  brief: string;
  onBriefChange: (v: string) => void;
  voice: string;
  onVoiceChange: (v: string) => void;
  onRun: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
  presetRun: { preset: { id: string; status: string; brief: string }; runs: DesignRun[] } | null;
}

function PresetBriefPanel({
  preset,
  brief,
  onBriefChange,
  voice,
  onVoiceChange,
  onRun,
  onClose,
  submitting,
  error,
  presetRun,
}: PresetBriefPanelProps) {
  const runsByLabel = useMemo(() => {
    if (!presetRun) return new Map<string, DesignRun>();
    // The preset definition steps and child runs are in the same order; map
    // by index → label so the grid lines up regardless of skill-id reuse.
    const map = new Map<string, DesignRun>();
    presetRun.runs.forEach((r, idx) => {
      const label = preset.steps[idx]?.label ?? r.skill;
      map.set(label, r);
    });
    return map;
  }, [preset, presetRun]);

  const progress = useMemo(() => {
    if (!presetRun) return { done: 0, total: preset.stepCount };
    const done = presetRun.runs.filter((r) =>
      ["completed", "failed", "cancelled"].includes(r.status),
    ).length;
    return { done, total: preset.stepCount };
  }, [preset, presetRun]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/40 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{preset.name}</h2>
          <p className="text-xs text-muted-foreground">{preset.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          close
        </button>
      </div>

      <textarea
        className="min-h-[100px] rounded border border-border bg-background p-2 text-sm"
        placeholder="One brief — audience, angle, tone, what you want out the other side."
        value={brief}
        onChange={(e) => onBriefChange(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="flex-1 min-w-[180px] rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="Persona / brand voice (optional) — e.g. 'For Sidney — warm, contemporary'"
          value={voice}
          onChange={(e) => onVoiceChange(e.target.value)}
        />
        <button
          type="button"
          onClick={onRun}
          disabled={submitting || !brief.trim()}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {submitting ? "Starting…" : `Run preset (${preset.stepCount} skill${preset.stepCount === 1 ? "" : "s"})`}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {presetRun ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono">{presetRun.preset.id}</span>
            <span>
              {progress.done} / {progress.total} done · status: {presetRun.preset.status}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {preset.steps.map((step) => {
              const r = runsByLabel.get(step.label);
              const status = r?.status ?? "queued";
              return (
                <div
                  key={step.label}
                  className="flex flex-col gap-1 rounded border border-border bg-background p-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium">{step.label}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        status === "completed"
                          ? "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-200"
                          : status === "failed"
                            ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200"
                            : "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-200"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="h-32 overflow-hidden rounded bg-muted/30">
                    {r && r.rasterStatus === "completed" && r.pngPaths.length > 0 ? (
                      <img
                        src={`/api/design/runs/${r.id}/asset.png?slide=1`}
                        alt={step.label}
                        className="h-full w-full object-cover"
                      />
                    ) : r?.mp4Path ? (
                      <video
                        src={`/api/design/runs/${r.id}/asset.mp4`}
                        muted
                        autoPlay
                        loop
                        className="h-full w-full object-cover"
                      />
                    ) : r?.assetUrl ? (
                      <iframe
                        title={step.label}
                        src={r.assetUrl}
                        sandbox="allow-scripts allow-same-origin"
                        className="h-full w-full border-0"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[10px] text-muted-foreground">
                        {status === "queued" ? "queued" : `${status}…`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-mono">{step.skill}</span>
                    {r?.assetUrl ? (
                      <a
                        href={r.assetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        open
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

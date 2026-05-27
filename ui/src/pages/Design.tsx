import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { designApi, type DesignSkill } from "../api/design";
import { useCompany } from "../context/CompanyContext";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

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

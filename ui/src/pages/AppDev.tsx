import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Send,
  ArrowRight,
  Check,
  ShieldCheck,
  Rocket,
  Bell,
  Search,
  Hammer,
  Eye,
  Palette,
  Heart,
  LayoutGrid,
  ShoppingBag,
  Users,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { appDevApi, type AppDevApp, type AppDevBlueprint } from "../api/appDev";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import type { Agent, Issue } from "@paperclipai/shared";

/* Paperclip Design System v1.0 tokens (locked) — applied locally. */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};
const cardBorder = `1px solid rgba(255,255,255,0.06)`;

const BLUEPRINT_ICONS: Record<string, typeof Heart> = {
  lifestyle: Heart,
  dashboard: LayoutGrid,
  marketplace: ShoppingBag,
  social: Users,
};
const BLUEPRINT_HUE: Record<string, string> = {
  lifestyle: DS.success,
  dashboard: DS.analytics,
  marketplace: DS.warning,
  social: DS.automation,
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function agentStatusColor(status?: string): string {
  switch (status) {
    case "active":
      return DS.success;
    case "error":
      return DS.critical;
    case "running":
      return DS.primary;
    case "paused":
      return DS.warning;
    default:
      return DS.textFaint;
  }
}
function parseFeedback(issue: Issue) {
  const rawTitle = issue.title ?? "";
  const m = rawTitle.match(/^\[[^\]]*•\s*(bug|feature)\]\s*(.*)$/i);
  const kind = (m?.[1]?.toLowerCase() as "bug" | "feature") || "feedback";
  const title = m ? m[2] : rawTitle;
  const desc = issue.description ?? "";
  const attMatch = desc.match(/\[attachments\]\s*(.+)\s*$/m);
  const photos = attMatch
    ? attMatch[1].split("|").map((s) => s.trim()).filter(Boolean).map((rel) => `/api/uploads/${rel}`)
    : [];
  let body = desc.replace(/\n?\[attachments\][^\n]*/m, "");
  body = body.replace(/\n+-\s.*v\d+.*$/m, "").trim();
  return { title, body, kind, photos };
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: DS.textFaint }}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
export function AppDev() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "App Dev" }]);
  }, [setBreadcrumbs]);

  /* REAL — app registry endpoint (app_dev_apps + live aggregates). */
  const { data: appsResp, isLoading: appsLoading } = useQuery({
    queryKey: ["app-dev", "apps", selectedCompanyId],
    queryFn: () => appDevApi.listApps(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const apps: AppDevApp[] = appsResp?.apps ?? [];

  /* REAL — all app feedback (per-app panel). */
  const { data: feedbackAll, isLoading: feedbackLoading } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "app-feedback"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { originKind: "app-feedback" }),
    enabled: !!selectedCompanyId,
  });

  /* REAL — fleet (Designer identity/status). */
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  /* REAL — blueprint catalog endpoint. */
  const { data: blueprintsResp } = useQuery({
    queryKey: ["app-dev", "blueprints", selectedCompanyId],
    queryFn: () => appDevApi.blueprints(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const blueprints = blueprintsResp?.blueprints ?? [];

  const selectedApp = useMemo(
    () => apps.find((a) => a.key === selectedKey) ?? apps.find((a) => a.openFeedback > 0) ?? apps[0] ?? null,
    [apps, selectedKey],
  );

  /* REAL — builds (heartbeat runs) + releases (feedback-by-version). */
  const { data: builds } = useQuery({
    queryKey: ["app-dev", "builds", selectedCompanyId, selectedApp?.key],
    queryFn: () => appDevApi.builds(selectedCompanyId!, selectedApp!.key),
    enabled: !!selectedCompanyId && !!selectedApp,
  });
  const { data: releases } = useQuery({
    queryKey: ["app-dev", "releases", selectedCompanyId, selectedApp?.key],
    queryFn: () => appDevApi.releases(selectedCompanyId!, selectedApp!.key),
    enabled: !!selectedCompanyId && !!selectedApp,
  });

  const completeMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.update(issueId, { status: "done" }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.issues.list(selectedCompanyId!), "app-feedback"],
      }),
  });

  const appFeedback = useMemo(
    () =>
      (feedbackAll ?? []).filter(
        (i) => (i.originId || "").toLowerCase() === (selectedApp?.feedbackOriginId || "").toLowerCase() && selectedApp?.feedbackOriginId,
      ),
    [feedbackAll, selectedApp],
  );
  const totalOpenFeedback = useMemo(
    () => (feedbackAll ?? []).filter((i) => i.status !== "done").length,
    [feedbackAll],
  );

  const designer = (agents ?? []).find((a) => a.role === "designer");
  const hermes = (agents ?? []).find((a) => a.name === "Hermes" || (a.role as string) === "orchestrator");

  return (
    <div className="flex min-h-full flex-col gap-6 p-8" style={{ background: DS.canvas }} data-pp-page-v2="app-dev">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
            App Dev
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: DS.textMuted }}>
            Build and ship better apps with your AI agent fleet.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]" style={{ background: DS.surface, border: cardBorder, color: DS.textFaint }}>
            <Search className="h-4 w-4" />
            <span>Ask Hermes anything…</span>
            <kbd className="ml-2 rounded px-1.5 py-0.5 text-[11px]" style={{ background: DS.surface3, color: DS.textFaint }}>⌘/</kbd>
          </div>
          <button className="relative flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: DS.surface, border: cardBorder, color: DS.textMuted }} aria-label="Notifications">
            <Bell className="h-4 w-4" />
            {totalOpenFeedback > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ background: DS.primary, color: "#fff" }}>
                {totalOpenFeedback}
              </span>
            )}
          </button>
          {hermes && (
            <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: DS.surface, border: cardBorder }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-bold" style={{ background: DS.primary, color: "#fff" }}>H</span>
              <div className="leading-tight">
                <div className="text-[12px] font-semibold" style={{ color: DS.text }}>{hermes.name}</div>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: agentStatusColor(hermes.status) }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: agentStatusColor(hermes.status) }} />
                  {hermes.status}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* App selector */}
      <section>
        <div className="mb-3 flex items-center gap-2.5">
          <SectionLabel>Your apps</SectionLabel>
          <span className="text-[12px]" style={{ color: DS.textFaint }}>· {apps.length} live app{apps.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
          {appsLoading && apps.length === 0
            ? Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="min-w-[210px] animate-pulse rounded-2xl p-4" style={{ background: DS.surface, border: cardBorder, height: 104 }} />
              ))
            : apps.map((app) => {
                const active = selectedApp?.key === app.key;
                const statusColor = app.openFeedback > 0 ? DS.analytics : DS.success;
                const statusLabel = app.openFeedback > 0 ? "In Development" : "Live";
                const hue = app.accent || DS.analytics;
                return (
                  <button key={app.key} onClick={() => setSelectedKey(app.key)}
                    className="flex min-w-[210px] flex-col items-start gap-2.5 rounded-2xl p-4 text-left transition-colors"
                    style={{
                      background: active ? `linear-gradient(180deg, ${DS.surface3} 0%, ${DS.surface2} 100%)` : DS.surface,
                      border: active ? `1px solid ${DS.primary}` : cardBorder,
                      boxShadow: active ? `0 0 0 1px ${DS.primary}, 0 8px 24px -16px rgba(0,0,0,0.8)` : "none",
                    }}>
                    <div className="flex w-full items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold" style={{ background: `linear-gradient(135deg, ${hue} 0%, ${hue}99 100%)`, color: "#fff" }}>
                        {app.key === "missioncontrol" ? "MC" : initials(app.name)}
                      </span>
                      {app.latestVersion && <span className="font-mono text-[11px]" style={{ color: DS.textFaint }}>{app.latestVersion}</span>}
                    </div>
                    <span className="text-[14px] font-semibold" style={{ color: DS.text }}>{app.name}</span>
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[12px]" style={{ color: statusColor }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />{statusLabel}
                      </span>
                      <span className="text-[11px]" style={{ color: DS.textFaint }}>{app.feedbackCount} feedback</span>
                    </div>
                  </button>
                );
              })}
        </div>
        <p className="mt-1 text-[11px]" style={{ color: DS.textFaint }}>
          Source: <code>app_dev_apps</code> registry — cockpit (MissionControl) + one row per real in-app feedback origin.
        </p>
      </section>

      {selectedApp && (
        <>
          <section style={surfaceCard} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[15px] font-bold" style={{ background: `linear-gradient(135deg, ${selectedApp.accent || DS.primary} 0%, ${(selectedApp.accent || DS.primary)}99 100%)`, color: "#fff" }}>
                {selectedApp.key === "missioncontrol" ? "MC" : initials(selectedApp.name)}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[18px] font-semibold" style={{ color: DS.text }}>{selectedApp.name}</span>
                  {selectedApp.latestVersion && (
                    <span className="rounded-md px-1.5 py-0.5 font-mono text-[11px]" style={{ background: DS.surface3, color: DS.textMuted }}>{selectedApp.latestVersion}</span>
                  )}
                </div>
                <div className="line-clamp-1 max-w-[520px] text-[13px]" style={{ color: DS.textMuted }}>{selectedApp.tagline || "Live app."}</div>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <div className="leading-tight">
                <div className="text-[11px] uppercase tracking-wide" style={{ color: DS.textFaint }}>Open feedback</div>
                <div className="text-[13px] font-medium" style={{ color: DS.text }}>{selectedApp.openFeedback} of {selectedApp.feedbackCount}</div>
              </div>
              <button className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: DS.primary, color: "#fff" }}>
                <Rocket className="h-4 w-4" />
                Promote to {hermes?.name ?? "Hermes"}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_1fr_1fr]">
            <DesignAgentColumn designer={designer} appName={selectedApp.name} blueprints={blueprints} companyId={selectedCompanyId!} />
            <FeedbackColumn
              items={appFeedback}
              loading={feedbackLoading}
              appName={selectedApp.name}
              onComplete={(id) => completeMutation.mutate(id)}
              onMarkAll={() => appFeedback.filter((i) => i.status !== "done").forEach((i) => completeMutation.mutate(i.id))}
            />
            <PipelineColumn
              stages={builds?.stages ?? []}
              builds={builds?.builds ?? []}
              releases={releases?.versions ?? []}
              pendingApprovals={selectedApp.pendingApprovals}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Design Agent — REAL Designer + Gemini 2.5 Flash streaming + REAL blueprints ── */
function DesignAgentColumn({
  designer,
  appName,
  blueprints,
  companyId,
}: {
  designer?: Agent;
  appName: string;
  blueprints: AppDevBlueprint[];
  companyId: string;
}) {
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conceptImage, setConceptImage] = useState<string | null>(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);

  async function send(generateConcept = false) {
    const prompt = draft.trim();
    if (!prompt || streaming) return;
    setStreaming(true);
    setReply("");
    setNotice(null);
    setImageMsg(null);
    if (generateConcept) {
      setConceptImage(null);
    }
    try {
      const res = await fetch(appDevApi.designChatStreamPath(companyId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, appName, generateConcept }),
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
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const j = JSON.parse(data);
            if (ev === "delta") setReply((r) => r + (j.text ?? ""));
            else if (ev === "model_unconfigured") setNotice(j.message);
            else if (ev === "image_generating") setImageGenerating(true);
            else if (ev === "concept_image") { setConceptImage(j.imagePath); setImageGenerating(false); }
            else if (ev === "image_needs_key") { setImageMsg(j.reason); setImageGenerating(false); }
            else if (ev === "image_error") { setImageMsg(j.message); setImageGenerating(false); }
            else if (ev === "error") setNotice(j.message);
          } catch {
            /* ignore keep-alive */
          }
        }
      }
    } catch (e) {
      setNotice(String((e as Error).message));
    } finally {
      setStreaming(false);
      setDraft("");
    }
  }

  const color = agentStatusColor(designer?.status);
  const byCategory = useMemo(() => {
    const m = new Map<string, AppDevBlueprint[]>();
    for (const b of blueprints) {
      if (!m.has(b.category)) m.set(b.category, []);
      m.get(b.category)!.push(b);
    }
    return [...m.entries()];
  }, [blueprints]);

  return (
    <section style={surfaceCard} className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>Design agent</SectionLabel>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(165,110,255,0.12)", color: DS.automation }}>
            Gemini 2.5 Flash
          </span>
        </div>
        {designer && (
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "rgba(59,130,255,0.10)", color: DS.primary }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {designer.name} · {designer.status}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: DS.surface3, border: cardBorder }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "rgba(165,110,255,0.15)", color: DS.automation }}>
          <Palette className="h-5 w-5" />
        </span>
        <div className="text-[12px] leading-snug" style={{ color: DS.textMuted }}>
          {designer ? `${designer.name} reasons about ${appName}'s design via Gemini 2.5 Flash, then promotes the build to Hermes.` : "No designer agent in the fleet."}
        </div>
      </div>

      {/* Streaming reply */}
      {(reply || streaming || notice) && (
        <div className="rounded-xl p-3 text-[13px] leading-relaxed" style={{ background: DS.surface, border: cardBorder, color: DS.textMuted, minHeight: 48 }}>
          {reply || (streaming ? "…" : "")}
          {notice && (
            <div className="mt-2 flex items-start gap-2 text-[11px]" style={{ color: DS.warning }}>
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}

      {/* Concept image generation — Gemini 3.1 Flash Image */}
      <div className="rounded-xl p-2.5" style={{ background: DS.surface, border: cardBorder }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px]" style={{ color: DS.textFaint }}>
            <ImageIcon className="h-4 w-4" style={{ color: DS.automation }} />
            Concept image · Gemini 3.1 Flash Image
          </div>
          <button onClick={() => send(true)} disabled={!designer || streaming} className="rounded-lg px-2.5 py-1 text-[11px] font-medium" style={{ background: DS.surface3, color: DS.textMuted, opacity: !designer || streaming ? 0.5 : 1 }}>
            {imageGenerating ? "Generating…" : "Generate concept"}
          </button>
        </div>
        {conceptImage && (
          <img src={conceptImage} alt="generated concept mockup" className="mt-2 w-full rounded-lg" style={{ border: cardBorder }} />
        )}
        {imageMsg && (
          <div className="mt-2 flex items-start gap-2 rounded-lg p-2 text-[11px] leading-snug" style={{ background: "rgba(244,185,64,0.06)", border: `1px solid rgba(244,185,64,0.22)`, color: DS.textMuted }}>
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: DS.warning }} />
            <span>{imageMsg}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: DS.surface, border: cardBorder }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!designer || streaming}
          placeholder={designer ? `Ask ${designer.name} about ${appName}'s design…` : "No designer agent"}
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: DS.text }}
          onKeyDown={(e) => { if (e.key === "Enter") send(false); }}
        />
        <button onClick={() => send(false)} disabled={!designer || !draft.trim() || streaming} className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: DS.primary, color: "#fff", opacity: !designer || !draft.trim() ? 0.5 : 1 }}>
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* REAL blueprint catalog */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Blueprint templates</SectionLabel>
          <span className="text-[11px]" style={{ color: DS.textFaint }}>{blueprints.length} templates</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {byCategory.map(([cat, items]) => {
            const Icon = BLUEPRINT_ICONS[cat] ?? Sparkles;
            const hue = BLUEPRINT_HUE[cat] ?? DS.primary;
            return (
              <div key={cat} className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: DS.surface, border: cardBorder }}>
                <Icon className="h-4 w-4" style={{ color: hue }} />
                <span className="text-[12px] font-semibold capitalize" style={{ color: DS.text }}>{cat}</span>
                <span className="text-[11px] leading-snug" style={{ color: DS.textFaint }}>
                  {items.map((i) => i.name).join(" · ")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Feedback column — REAL app feedback ─────────────────────────────────── */
function FeedbackColumn({
  items,
  loading,
  appName,
  onComplete,
  onMarkAll,
}: {
  items: Issue[];
  loading: boolean;
  appName: string;
  onComplete: (id: string) => void;
  onMarkAll: () => void;
}) {
  const open = items.filter((i) => i.status !== "done").length;
  return (
    <section style={surfaceCard} className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>Feedback</SectionLabel>
          {items.length > 0 && (
            <span className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: DS.surface3, color: DS.textMuted }}>{open}/{items.length}</span>
          )}
        </div>
        {open > 0 && (
          <button onClick={onMarkAll} className="text-[12px] font-medium" style={{ color: DS.primary }}>Mark all complete</button>
        )}
      </div>
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: DS.surface3 }} />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-[13px]" style={{ background: DS.surface, border: cardBorder, color: DS.textFaint }}>
          No inbound feedback for {appName} yet.
          <div className="mt-1 text-[11px]">Live source: issues tagged <code>originKind=app-feedback</code>.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((issue) => {
            const f = parseFeedback(issue);
            const done = issue.status === "done";
            const tagColor = f.kind === "bug" ? DS.critical : f.kind === "feature" ? DS.primary : DS.textFaint;
            const source = issue.originId || "App";
            return (
              <div key={issue.id} className="rounded-xl p-3.5" style={{ background: DS.surface, border: cardBorder, opacity: done ? 0.6 : 1 }}>
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: DS.surface3, color: DS.textMuted }}>{initials(source)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: DS.text }}>{source}</span>
                      <span className="text-[11px]" style={{ color: DS.textFaint }}>{relativeTime(issue.createdAt as unknown as string)}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed" style={{ color: DS.textMuted }}>
                      <span style={{ color: DS.text, fontWeight: 600 }}>{f.title}</span>{f.body ? ` — ${f.body}` : ""}
                    </p>
                    {f.photos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {f.photos.map((src) => <img key={src} src={src} alt="feedback attachment" className="h-16 w-24 rounded-lg object-cover" style={{ border: cardBorder }} loading="lazy" />)}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: tagColor, background: `${tagColor}1A` }}>{f.kind}</span>
                      <button onClick={() => !done && onComplete(issue.id)} className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: done ? DS.primary : DS.surface3, border: done ? "none" : cardBorder, color: done ? "#fff" : DS.textFaint }} title={done ? "Completed" : "Mark complete"}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── Pipeline column — REAL build runs (progress) + REAL version diff ─────── */
function PipelineColumn({
  stages,
  builds,
  releases,
  pendingApprovals,
}: {
  stages: { stage: string; agentName: string; agentStatus: string; latestRunStatus: string | null; progress: number | null }[];
  builds: { stage: string; agentName: string; status: string; progress: number; commit: string | null }[];
  releases: { version: number; items: { id: string; title: string; kind: string; status: string }[] }[];
  pendingApprovals: number;
}) {
  const iconFor = (stage: string) => (stage === "Build" ? Hammer : stage === "Review" ? Eye : ShieldCheck);
  const youColor = pendingApprovals > 0 ? DS.warning : DS.success;
  const latestCommit = builds.find((b) => b.commit)?.commit ?? null;

  return (
    <section style={surfaceCard} className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <SectionLabel>Release pipeline</SectionLabel>
        {latestCommit && <span className="font-mono text-[11px]" style={{ color: DS.textFaint }}>{latestCommit}</span>}
      </div>

      {/* Stepper from REAL build runs */}
      <div className="flex items-stretch justify-between">
        {stages.map((s, i) => {
          const Icon = iconFor(s.stage);
          const color = agentStatusColor(s.latestRunStatus === "finished" ? "active" : s.latestRunStatus ?? s.agentStatus);
          return (
            <div key={s.stage} className="flex flex-1 items-start">
              <div className="flex flex-col items-center gap-1.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: DS.surface3, border: `1px solid ${color}`, color }}>
                  {s.latestRunStatus === "finished" ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className="text-[11px] font-medium" style={{ color: DS.text }}>{s.stage}</span>
                <span className="text-[10px]" style={{ color }}>{s.agentName}</span>
                <span className="text-[9px]" style={{ color }}>{s.progress != null ? `${s.progress}%` : (s.latestRunStatus ?? "pending")}</span>
              </div>
              {i < stages.length - 1 && <div className="mt-4 h-px flex-1" style={{ background: s.latestRunStatus === "finished" ? DS.success : DS.border2 }} />}
            </div>
          );
        })}
        {/* You stage */}
        <div className="flex flex-1 items-start">
          <div className="ml-1 h-px flex-1" style={{ background: DS.border2 }} />
          <div className="flex flex-col items-center gap-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: DS.surface3, border: `1px solid ${youColor}`, color: youColor }}>You</span>
            <span className="text-[11px] font-medium" style={{ color: DS.text }}>You</span>
            <span className="text-[10px]" style={{ color: youColor }}>{pendingApprovals > 0 ? `${pendingApprovals} pending` : "Clear"}</span>
          </div>
        </div>
      </div>

      {stages.length === 0 && (
        <div className="rounded-lg p-3 text-center text-[12px]" style={{ background: DS.surface, border: cardBorder, color: DS.textFaint }}>
          No pipeline agents (Builder / Reviewer / Security) in this fleet yet.
        </div>
      )}

      {/* Version diff — REAL feedback-by-version */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Version changes</SectionLabel>
          <span className="text-[11px]" style={{ color: DS.textFaint }}>by reported version</span>
        </div>
        {releases.length === 0 ? (
          <div className="rounded-lg p-3 text-center text-[12px]" style={{ background: DS.surface, border: cardBorder, color: DS.textFaint }}>No versioned feedback yet.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {releases.slice(0, 3).map((v) => {
              const features = v.items.filter((i) => i.kind === "feature").length;
              const bugs = v.items.filter((i) => i.kind === "bug").length;
              return (
                <div key={v.version} className="rounded-lg p-2.5" style={{ background: DS.surface, border: cardBorder }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] font-semibold" style={{ color: DS.text }}>v{v.version}</span>
                    <span className="text-[11px]" style={{ color: DS.textFaint }}>
                      <span style={{ color: DS.primary }}>{features} feat</span> · <span style={{ color: DS.critical }}>{bugs} bug</span>
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px]" style={{ color: DS.textMuted }}>
                    {v.items.slice(0, 3).map((i) => i.title).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button className="flex-1 rounded-xl px-3 py-2.5 text-[13px] font-semibold" style={{ background: pendingApprovals ? DS.success : DS.surface3, color: pendingApprovals ? "#06090F" : DS.textFaint }} disabled={!pendingApprovals}>
          Approve &amp; promote
        </button>
        <button className="rounded-xl px-3 py-2.5 text-[13px] font-semibold" style={{ background: "rgba(255,91,91,0.12)", color: DS.critical, border: `1px solid rgba(255,91,91,0.3)`, opacity: pendingApprovals ? 1 : 0.5 }} disabled={!pendingApprovals}>
          Reject
        </button>
      </div>
      <button className="flex items-center gap-1.5 self-center text-[12px] font-medium" style={{ color: DS.primary }}>
        View full version history <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}

export default AppDev;

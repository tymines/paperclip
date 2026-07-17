import {
  useState,
  useEffect,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { costsApi } from "../api/costs";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import {
  Bot,
  Plus,
  List,
  GitBranch,
  Pause,
  Play,
  Settings2,
  X,
  ArrowUpRight,
  Server,
} from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent, type AgentDetail, type HeartbeatRun } from "@paperclipai/shared";
import { getAdapterLabel } from "../adapters/adapter-display-registry";
import { AcpFleetPanel } from "../components/AcpFleetPanel";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

// --- Host map for "Hosted by" field on Fleet cards --------------------------
// Source: canonical-fleet.ts CANONICAL_HOST_MAP (bridge daemon + DB seed)
const HOST_MAP: Record<string, string> = {
  // ── Windows (Zeus) ─────────────────────────────────────────────────────
  zeus:              "WindowsAugi · under Zeus",
  "zeus book keeper":"WindowsAugi · under Zeus",
  "zeus critic":     "WindowsAugi · under Zeus",
  "zeus dispatch":   "WindowsAugi · under Zeus",

  // ── Box 1 — under Hermes ──────────────────────────────────────────────
  hermes:            "AugiAIs-Mini · under Hermes",
  augi:              "AugiAIs-Mini · under Augi",
  "hermes coder 1":  "AugiAIs-Mini · under Hermes",
  "hermes coder 2":  "AugiAIs-Mini · under Hermes",
  "hermes coder 3":  "AugiAIs-Mini · under Hermes",
  "hermes designer": "AugiAIs-Mini · under Hermes",
  "hermes researcher":"AugiAIs-Mini · under Hermes",

  // ── Box 2 — under Ares ────────────────────────────────────────────────
  ares:                "AugiBot2s-Mini · under Ares",
  august:              "AugiBot2s-Mini · under August",
  "ares evidence verifier":"AugiBot2s-Mini · under Ares",
  "ares reviewer 1":       "AugiBot2s-Mini · under Ares",
  "ares reviewer 2":       "AugiBot2s-Mini · under Ares",

  // ── External ───────────────────────────────────────────────────────────
  "baily ai":         "BailysApp · under Baily AI",
};

function hostForAgent(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return HOST_MAP[key] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked) — applied locally so the      */
/* Fleet redesign is self-contained and does not mutate global theme vars     */
/* used by other (not-yet-redesigned) pages.                                  */
/* -------------------------------------------------------------------------- */
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

// Decorative per-agent avatar ring hues (styling only — not data).
const RING_HUES = [
  DS.primary,
  DS.automation,
  DS.analytics,
  DS.success,
  "#7C5CFF",
  "#22B8CF",
  DS.warning,
  "#5B8CFF",
];

function ringHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RING_HUES[h % RING_HUES.length]!;
}

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 48px -28px rgba(0,0,0,0.95)",
};

type FilterTab = "all" | "active" | "paused" | "error";

function matchesFilter(status: string, tab: FilterTab): boolean {
  if (status === "terminated") return false;
  if (tab === "all") return true;
  if (tab === "active") return status === "active" || status === "running" || status === "idle";
  if (tab === "paused") return status === "paused";
  if (tab === "error") return status === "error";
  return true;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return DS.success;
    case "paused":
      return DS.warning;
    case "idle":
      return DS.warning;
    case "error":
      return DS.critical;
    case "terminated":
      return DS.textFaint;
    case "pending_approval":
      return DS.analytics;
    default:
      return DS.textFaint;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "idle":
      return "Idle";
    case "error":
      return "Error";
    case "terminated":
      return "Off";
    case "pending_approval":
      return "Pending";
    default:
      return status.replace(/_/g, " ");
  }
}

function getConfiguredModel(agent: Agent): string | null {
  const adapterValue = agent.adapterConfig?.model;
  if (typeof adapterValue === "string" && adapterValue.trim().length > 0) return adapterValue.trim();

  const rc = agent.runtimeConfig as Record<string, unknown> | null | undefined;
  if (rc) {
    if (typeof rc.model === "string" && rc.model.trim().length > 0) return rc.model.trim();
    const profiles = rc.modelProfiles as Record<string, { adapterConfig?: Record<string, unknown> }> | undefined;
    if (profiles) {
      for (const key of ["default", "cheap", "quality"] as const) {
        const p = profiles[key];
        if (p?.adapterConfig?.model && typeof p.adapterConfig.model === "string" && p.adapterConfig.model.trim().length > 0) {
          return p.adapterConfig.model.trim();
        }
      }
    }
  }

  const meta = agent.metadata as Record<string, unknown> | null | undefined;
  if (meta && typeof meta.model === "string" && meta.model.trim().length > 0) return meta.model.trim();

  if (agent.title) {
    const parenMatch = agent.title.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const content = parenMatch[1].trim();
      const skipPatterns = /^(bridged|vision agent|called as|aider|no llm|xcodebuild)/i;
      if (!skipPatterns.test(content)) {
        const afterPlus = content.match(/(?:aider\s*\+\s*)?(.+)/i);
        if (afterPlus) return afterPlus[1].trim();
      }
    }
    const viaMatch = agent.title.match(/via\s+([A-Za-z0-9][\w.-]+)/i);
    if (viaMatch) return viaMatch[1].trim();
  }

  return FALLBACK_MODEL_MAP[agent.name.trim().toLowerCase()] ?? null;
}

const FALLBACK_MODEL_MAP: Record<string, string> = {
  "hermes": "kimi-k2.6",
  "brainstorm": "glm-5.2",
  "ares": "kimi-k2.6",
  "augi": "deepseek-chat",
  "august": "openclaw-peer (remote model)",
  "forge": "kimi-k2.7-code",
  "atlas": "glm-5.2",
  "reviewer": "minimax-m2.7",
  "security": "kimi-k2.6",
  "codex": "gpt-5.5",
  "researcher": "kimi-k2.6",
  "designer": "gemini-2.5-flash",
  "vision coder": "gemini-3-pro",
  "builder": "xcodebuild (no LLM)",
  "coder b": "deepseek-v4-flash",
  "baily ai": "qwen3-vl-8b",
  "zeus": "deepseek-v4-flash",
  "zeus vision": "gemini-2.5-flash",
};

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* -------------------------------------------------------------------------- */
/* Small shared atoms                                                         */
/* -------------------------------------------------------------------------- */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: DS.textFaint }}
    >
      {children}
    </span>
  );
}

function AgentAvatar({ agent, size = 38 }: { agent: Agent | OrgNode; size?: number }) {
  const icon = "icon" in agent ? (agent as Agent).icon : null;
  const isImg = !!icon && (icon.startsWith("http") || icon.startsWith("/"));
  const initial = (agent.name ?? "?").trim().charAt(0).toUpperCase();
  const ring = ringHue(agent.id);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex items-center justify-center rounded-full font-bold"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.4,
          color: DS.text,
          background: DS.surface3,
          boxShadow: `0 0 0 2px ${ring}`,
        }}
      >
        {isImg ? (
          <img src={icon!} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-full"
        style={{
          width: size * 0.3,
          height: size * 0.3,
          background: statusColor(agent.status),
          boxShadow: `0 0 0 2px ${DS.surface}`,
        }}
      />
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const c = statusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ background: `${c}1A`, color: c }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {statusLabel(status)}
    </span>
  );
}

function UtilizationCost({ agent }: { agent: Agent }) {
  const spent = agent.spentMonthlyCents ?? 0;
  const budget = agent.budgetMonthlyCents ?? 0;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = budget > 0 && spent > budget;
  const barColor = over ? DS.critical : pct > 80 ? DS.warning : DS.primary;
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[12px] tabular-nums" style={{ color: DS.text }}>
        {formatUsd(spent)}
        <span style={{ color: DS.textFaint }}> / {budget > 0 ? formatUsd(budget) : "—"}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: DS.surface3, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(budget > 0 ? 2 : 0, pct)}%`, background: barColor, boxShadow: `0 0 8px ${barColor}66` }}
        />
      </div>
    </div>
  );
}

const PAUSE_RESUME_ELIGIBLE = new Set(["paused", "idle", "active", "running"]);

function RowControls({
  agent,
  pending,
  onPauseResume,
}: {
  agent: Agent;
  pending: boolean;
  onPauseResume: (a: Agent, action: "pause" | "resume") => void;
}) {
  const isPaused = agent.status === "paused";
  const eligible = PAUSE_RESUME_ELIGIBLE.has(agent.status);
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {eligible && (
        <button
          type="button"
          disabled={pending}
          title={isPaused ? "Resume" : "Pause"}
          aria-label={isPaused ? "Resume agent" : "Pause agent"}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!pending) onPauseResume(agent, isPaused ? "resume" : "pause");
          }}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors disabled:opacity-40"
          style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
          data-pp-fleet-pause-resume={isPaused ? "resume" : "pause"}
        >
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      )}
      <Link
        to={`${agentUrl(agent)}/configuration`}
        title="Configure"
        aria-label="Configure agent"
        onClick={(e) => e.stopPropagation()}
        className="flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors no-underline"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section grouping derived from the org (reportsTo) hierarchy                 */
/* -------------------------------------------------------------------------- */
interface Groups {
  leadership: Agent[];
  agents: Agent[];
  external: Agent[];
}

function countNodes(node: OrgNode): number {
  return 1 + node.reports.reduce((s, c) => s + countNodes(c), 0);
}

function deriveGroups(agents: Agent[], orgTree: OrgNode[] | undefined): Groups {
  const sortName = (a: Agent, b: Agent) => a.name.localeCompare(b.name);
  if (!orgTree || orgTree.length === 0) {
    return { leadership: [], agents: [...agents].sort(sortName), external: [] };
  }
  // Main hierarchy = the root with the largest subtree (Hermes). Other roots
  // (e.g. Baily AI, which reports to no-one) are treated as External.
  const mainRoot = [...orgTree].sort((a, b) => countNodes(b) - countNodes(a))[0]!;

  const depthById = new Map<string, number>();
  const hasReports = new Map<string, boolean>();
  const walk = (node: OrgNode, depth: number) => {
    depthById.set(node.id, depth);
    hasReports.set(node.id, node.reports.length > 0);
    node.reports.forEach((c) => walk(c, depth + 1));
  };
  walk(mainRoot, 0);

  // Build a set of agent ids that are in the main tree (by depth) OR have
  // reportsTo pointing into the main tree — catches agents like Brainstorm
  // whose org-tree entry may be absent or under a different root.
  const mainIds = new Set(depthById.keys());
  function reportsToMainTree(a: Agent): boolean {
    return a.reportsTo !== null && depthById.has(a.reportsTo!);
  }

  const leadership: Agent[] = [];
  const workers: Agent[] = [];
  const external: Agent[] = [];
  // Explicit group assignments (Tyler directive 2026-07-07).
  // ponytail: named sets take priority over org-tree traversal.
  const LEADERSHIP_NAMES = new Set(["zeus", "zeus book keeper", "zeus critic"]);
  const EXTERNAL_NAMES = new Set(["baily ai"]);
  // Always keep Hermes & Brainstorm in the main team regardless of org-tree quirks.
  const MAIN_TEAM_NAMES = new Set(["hermes", "brainstorm", "zeus vision", "zeus coding", "zeus brainstorm", "zeus reviewer"]);
  for (const a of agents) {
    const nameKey = a.name.toLowerCase().trim();
    // Explicit group overrides (Tyler directive 2026-07-07).
    if (LEADERSHIP_NAMES.has(nameKey)) {
      leadership.push(a);
    } else if (EXTERNAL_NAMES.has(nameKey)) {
      external.push(a);
    } else if (mainIds.has(a.id)) {
      // In the main org tree — classify by reports.
      if (hasReports.get(a.id)) {
        leadership.push(a);
      } else {
        workers.push(a);
      }
    } else if (reportsToMainTree(a)) {
      // Reports into the main subtree — pull in as a worker.
      workers.push(a);
    } else if (MAIN_TEAM_NAMES.has(a.name.toLowerCase().trim())) {
      workers.push(a);
    } else {
      external.push(a);
    }
  }
  leadership.sort((a, b) => (depthById.get(a.id)! - depthById.get(b.id)!) || sortName(a, b));
  workers.sort(sortName);
  external.sort(sortName);
  return { leadership, agents: workers, external };
}

/* -------------------------------------------------------------------------- */
/* List row                                                                   */
/* -------------------------------------------------------------------------- */
const GRID_COLS =
  "grid-cols-[minmax(200px,1.5fr)_130px_minmax(150px,1.4fr)_150px_84px_96px_84px]";

function ColumnHeader() {
  return (
    <div
      className={cn("hidden items-center gap-4 px-5 py-2.5 lg:grid", GRID_COLS)}
      style={{ borderBottom: `1px solid ${DS.border}` }}
    >
      {["Agent", "Model", "Current Task", "Utilization / Cost", "Last Active", "Status", ""].map(
        (h, i) => (
          <span
            key={i}
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.12em]",
              i >= 4 && i <= 5 ? "text-right" : "",
            )}
            style={{ color: DS.textMuted }}
          >
            {h}
          </span>
        ),
      )}
    </div>
  );
}

function AgentRow({
  agent,
  currentTask,
  live,
  pending,
  onOpen,
  onPauseResume,
  external,
}: {
  agent: Agent;
  currentTask: string;
  live: boolean;
  pending: boolean;
  onOpen: (a: Agent) => void;
  onPauseResume: (a: Agent, action: "pause" | "resume") => void;
  external?: boolean;
}) {
  const model = getConfiguredModel(agent) ?? "—";
  const dim = agent.status === "paused" || agent.status === "terminated";
  const role = roleLabels[agent.role] ?? agent.role;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(agent);
        }
      }}
      className={cn(
        "grid cursor-pointer items-center gap-4 px-5 py-3 transition-colors",
        "grid-cols-[1fr_auto] lg:gap-4",
        GRID_COLS,
      )}
      style={{ borderBottom: `1px solid ${DS.border}` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      data-pp-fleet-row={agent.id}
    >
      {/* Agent */}
      <div className={cn("flex min-w-0 items-center gap-3", dim && "opacity-55")}>
        <AgentAvatar agent={agent} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold" style={{ color: DS.text }}>
              {agent.name}
            </span>
            {external && (
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: DS.surface3, color: DS.textMuted, border: `1px solid ${DS.border2}` }}
              >
                External
              </span>
            )}
          </div>
          <div className="truncate text-[11px]" style={{ color: DS.textFaint }}>
            {agent.title ?? role}
          </div>
          {hostForAgent(agent.name) && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: DS.textFaint }}>
              <Server className="h-3 w-3" />
              <span>Hosted: {hostForAgent(agent.name)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Model */}
      <div className={cn("hidden truncate font-mono text-[11px] lg:block", dim && "opacity-55")} style={{ color: DS.textMuted }} title={model}>
        {model}
      </div>

      {/* Current task */}
      <div className={cn("hidden min-w-0 items-center gap-2 lg:flex", dim && "opacity-55")}>
        {live && (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ background: DS.success, opacity: 0.7 }} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: DS.success }} />
          </span>
        )}
        <span className="truncate text-[12px]" style={{ color: live ? DS.text : DS.textMuted }} title={currentTask}>
          {currentTask}
        </span>
      </div>

      {/* Utilization / cost */}
      <div className={cn("hidden lg:block", dim && "opacity-55")}>
        <UtilizationCost agent={agent} />
      </div>

      {/* Last active */}
      <div className={cn("hidden text-right font-mono text-[11px] lg:block", dim && "opacity-55")} style={{ color: DS.textFaint }}>
        {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
      </div>

      {/* Status */}
      <div className="hidden justify-end lg:flex">
        <StatusPill status={agent.status} />
      </div>

      {/* Controls */}
      <RowControls agent={agent} pending={pending} onPauseResume={onPauseResume} />
    </div>
  );
}

function ListSection({
  label,
  rows,
  external,
  currentTaskFor,
  liveFor,
  pendingIds,
  onOpen,
  onPauseResume,
}: {
  label: string;
  rows: Agent[];
  external?: boolean;
  currentTaskFor: (a: Agent) => string;
  liveFor: (a: Agent) => boolean;
  pendingIds: Set<string>;
  onOpen: (a: Agent) => void;
  onPauseResume: (a: Agent, action: "pause" | "resume") => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div
        className="px-5 py-2"
        style={{ background: "rgba(255,255,255,0.015)", borderBottom: `1px solid ${DS.border}` }}
      >
        <SectionLabel>{label}</SectionLabel>
      </div>
      {rows.map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          external={external}
          currentTask={currentTaskFor(agent)}
          live={liveFor(agent)}
          pending={pendingIds.has(agent.id)}
          onOpen={onOpen}
          onPauseResume={onPauseResume}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Org chart view (Hermes -> Ares -> workers; Baily AI external)              */
/* -------------------------------------------------------------------------- */
function OrgCard({
  agent,
  node,
  onOpen,
  wide,
}: {
  agent?: Agent;
  node: OrgNode;
  onOpen: (id: string) => void;
  wide?: boolean;
}) {
  const model = agent ? getConfiguredModel(agent) : null;
  const subject = agent ?? node;
  const title = agent?.title ?? roleLabels[node.role] ?? node.role;
  return (
    <button
      type="button"
      onClick={() => onOpen(node.id)}
      className={cn(
        "flex items-center gap-3 rounded-[14px] px-4 py-3 text-left transition-colors",
        wide ? "w-[320px]" : "w-full",
      )}
      style={{ background: DS.surface3, border: `1px solid ${DS.border2}` }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = DS.border3)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = DS.border2)}
    >
      <AgentAvatar agent={subject} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold" style={{ color: DS.text }}>
          {node.name}
        </div>
        <div className="truncate text-[11px]" style={{ color: DS.textFaint }}>
          {title}
        </div>
        {model && (
          <div className="truncate font-mono text-[10px]" style={{ color: DS.textMuted }}>
            {model}
          </div>
        )}
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: statusColor(node.status) }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor(node.status) }} />
        {statusLabel(node.status)}
      </span>
    </button>
  );
}

function Connector({ height = 22 }: { height?: number }) {
  return <div style={{ width: 1, height, background: DS.border3 }} />;
}

function OrgView({
  orgTree,
  agentMap,
  onOpen,
}: {
  orgTree: OrgNode[];
  agentMap: Map<string, Agent>;
  onOpen: (id: string) => void;
}) {
  const mainRoot = [...orgTree].sort((a, b) => countNodes(b) - countNodes(a))[0];
  const externalRoots = orgTree.filter((r) => r.id !== mainRoot?.id);
  if (!mainRoot) return null;

  // Hierarchy: root (Hermes) -> manager children (Ares) -> their reports (grid).
  const managers = mainRoot.reports;

  return (
    <div className="flex flex-col items-center gap-0 px-4 py-8">
      {/* Root */}
      <OrgCard node={mainRoot} agent={agentMap.get(mainRoot.id)} onOpen={onOpen} wide />

      {managers.map((mgr) => (
        <div key={mgr.id} className="flex w-full flex-col items-center">
          <Connector />
          <OrgCard node={mgr} agent={agentMap.get(mgr.id)} onOpen={onOpen} wide />
          {mgr.reports.length > 0 && (
            <>
              <Connector />
              <div
                className="grid w-full max-w-[1100px] gap-3 px-2"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
              >
                {mgr.reports.map((child) => (
                  <OrgCard key={child.id} node={child} agent={agentMap.get(child.id)} onOpen={onOpen} />
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      {externalRoots.length > 0 && (
        <div className="mt-10 w-full max-w-[1100px]">
          <div className="mb-3 flex items-center gap-3">
            <SectionLabel>External</SectionLabel>
            <div className="h-px flex-1" style={{ background: DS.border }} />
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
          >
            {externalRoots.map((r) => (
              <OrgCard key={r.id} node={r} agent={agentMap.get(r.id)} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Agent detail drawer (run history + config)                                 */
/* -------------------------------------------------------------------------- */
function DetailField({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: DS.textFaint }}>
        {label}
      </span>
      <span className={cn("text-[13px]", mono && "font-mono")} style={{ color: DS.text }}>
        {value}
      </span>
    </div>
  );
}

function runTaskText(run: HeartbeatRun): string {
  if (run.nextAction && run.nextAction.trim()) return run.nextAction.trim();
  if (run.error && run.error.trim()) return run.error.trim();
  return `${run.invocationSource} run`;
}

function AgentDrawer({
  agentId,
  companyId,
  agentMap,
  onClose,
  onPauseResume,
  pending,
}: {
  agentId: string;
  companyId: string;
  agentMap: Map<string, Agent>;
  onClose: () => void;
  onPauseResume: (a: Agent, action: "pause" | "resume") => void;
  pending: boolean;
}) {
  const { data: detail } = useQuery<AgentDetail>({
    queryKey: [...queryKeys.agents.list(companyId), "detail-drawer", agentId],
    queryFn: () => agentsApi.get(agentId, companyId),
    enabled: !!agentId,
  });
  const { data: runs } = useQuery<HeartbeatRun[]>({
    queryKey: [...queryKeys.liveRuns(companyId), "drawer-runs", agentId],
    queryFn: () => heartbeatsApi.list(companyId, agentId, 8),
    enabled: !!agentId,
  });

  const agent = detail ?? agentMap.get(agentId);
  if (!agent) return null;
  const manager = agent.reportsTo ? agentMap.get(agent.reportsTo) : null;
  const model = getConfiguredModel(agent) ?? "—";

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(3,5,9,0.6)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col"
        style={{ background: DS.surface, borderLeft: `1px solid ${DS.border2}`, boxShadow: "-20px 0 50px -20px rgba(0,0,0,0.8)" }}
        role="dialog"
        aria-label={`${agent.name} detail`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-6" style={{ borderBottom: `1px solid ${DS.border}` }}>
          <div className="flex min-w-0 items-center gap-3">
            <AgentAvatar agent={agent} size={44} />
            <div className="min-w-0">
              <div className="truncate text-[18px] font-semibold" style={{ color: DS.text }}>
                {agent.name}
              </div>
              <div className="truncate text-[12px]" style={{ color: DS.textMuted }}>
                {agent.title ?? roleLabels[agent.role] ?? agent.role}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[9px]"
            style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Status + controls */}
          <div className="mb-5 flex items-center justify-between">
            <StatusPill status={agent.status} />
            <RowControls agent={agent} pending={pending} onPauseResume={onPauseResume} />
          </div>

          {/* Config */}
          <div className="mb-2">
            <SectionLabel>Configuration</SectionLabel>
          </div>
          <div
            className="mb-6 grid grid-cols-2 gap-x-4 gap-y-4 rounded-[12px] p-4"
            style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
          >
            <DetailField label="Model" value={model} mono />
            <DetailField label="Adapter" value={getAdapterLabel(agent.adapterType)} mono />
            <DetailField label="Reports to" value={manager ? manager.name : "—"} />
            <DetailField label="Last active" value={agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"} />
            <DetailField
              label="Monthly spend"
              value={
                <span className="font-mono">
                  {formatUsd(agent.spentMonthlyCents ?? 0)}
                  <span style={{ color: DS.textFaint }}>
                    {" "}/ {agent.budgetMonthlyCents > 0 ? formatUsd(agent.budgetMonthlyCents) : "—"}
                  </span>
                </span>
              }
            />
            <DetailField label="Role" value={roleLabels[agent.role] ?? agent.role} />
            {agent.capabilities ? (
              <div className="col-span-2">
                <DetailField label="Capabilities" value={agent.capabilities} />
              </div>
            ) : null}
          </div>

          {/* Run history */}
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Recent Runs</SectionLabel>
            <Link
              to={`${agentUrl(agent)}/runs`}
              onClick={onClose}
              className="text-[11px] font-medium no-underline hover:underline"
              style={{ color: DS.primary }}
            >
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {(runs ?? []).length === 0 ? (
              <p className="text-[12px]" style={{ color: DS.textMuted }}>
                No recent runs.
              </p>
            ) : (
              (runs ?? []).map((run) => (
                <Link
                  key={run.id}
                  to={`/agents/${agentRouteRef(agent)}/runs/${run.id}`}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 no-underline transition-colors"
                  style={{ background: DS.surface2, border: `1px solid ${DS.border}` }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(run.status) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]" style={{ color: DS.text }}>
                      {runTaskText(run)}
                    </div>
                    <div className="text-[10px]" style={{ color: DS.textFaint }}>
                      {statusLabel(run.status)} ·{" "}
                      {run.startedAt
                        ? relativeTime(run.startedAt)
                        : relativeTime(run.createdAt)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5" style={{ borderTop: `1px solid ${DS.border}` }}>
          <Link
            to={agentUrl(agent)}
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[13px] font-semibold no-underline"
            style={{ background: DS.primary, color: "#fff" }}
          >
            Open full detail
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </aside>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter pill                                                                */
/* -------------------------------------------------------------------------- */
function FilterPill({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  count: number;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors"
      style={{
        background: active ? `${DS.primary}1F` : DS.surface2,
        border: `1px solid ${active ? DS.primary : DS.border2}`,
        color: active ? DS.text : DS.textMuted,
      }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
      {label}
      <span className="font-mono text-[11px] tabular-nums" style={{ color: active ? DS.text : DS.textFaint }}>
        {count}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */
export function Agents() {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<"list" | "org">("list");
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);

  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const tab: FilterTab =
    pathSegment === "all" || pathSegment === "active" || pathSegment === "paused" || pathSegment === "error"
      ? pathSegment
      : "all";

  const { data: agents, isLoading, error } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: orgTree } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: costSummary } = useQuery({
    queryKey: queryKeys.costs(selectedCompanyId!),
    queryFn: () => costsApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "fleet"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  const { data: recentRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "fleet-recent"],
    queryFn: () => heartbeatsApi.list(selectedCompanyId!, undefined, 200),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  const liveByAgent = useMemo(() => {
    const m = new Map<string, { runId: string; nextAction: string | null }>();
    for (const r of liveRuns ?? []) {
      if (r.status !== "running" && r.status !== "queued") continue;
      if (!m.has(r.agentId)) m.set(r.agentId, { runId: r.id, nextAction: r.nextAction ?? null });
    }
    return m;
  }, [liveRuns]);

  const latestRunByAgent = useMemo(() => {
    const m = new Map<string, HeartbeatRun>();
    for (const r of recentRuns ?? []) {
      const existing = m.get(r.agentId);
      const t = new Date(r.startedAt ?? r.createdAt).getTime();
      if (!existing || t > new Date(existing.startedAt ?? existing.createdAt).getTime()) {
        m.set(r.agentId, r);
      }
    }
    return m;
  }, [recentRuns]);

  const currentTaskFor = useMemo(() => {
    return (a: Agent): string => {
      if (a.status === "paused") return "Paused";
      if (a.status === "error") return "Needs attention";
      const live = liveByAgent.get(a.id);
      if (live) return live.nextAction?.trim() || "Working";
      const last = latestRunByAgent.get(a.id);
      if (last?.nextAction?.trim()) return last.nextAction.trim();
      return "Idle";
    };
  }, [liveByAgent, latestRunByAgent]);

  const liveFor = useMemo(() => (a: Agent) => liveByAgent.has(a.id), [liveByAgent]);

  const pauseResumeAgent = useMutation({
    mutationFn: ({ agent, action }: { agent: Agent; action: "pause" | "resume" }) =>
      action === "pause"
        ? agentsApi.pause(agent.id, selectedCompanyId ?? undefined)
        : agentsApi.resume(agent.id, selectedCompanyId ?? undefined),
    onMutate: ({ agent, action }) => {
      setPendingAgentIds((cur) => new Set(cur).add(agent.id));
      if (selectedCompanyId) {
        const key = queryKeys.agents.list(selectedCompanyId);
        const previous = queryClient.getQueryData<Agent[]>(key);
        if (previous) {
          const nextStatus: Agent["status"] = action === "pause" ? "paused" : "idle";
          queryClient.setQueryData<Agent[]>(
            key,
            previous.map((a) =>
              a.id === agent.id
                ? ({ ...a, status: nextStatus, pausedAt: action === "pause" ? new Date() : null } satisfies Agent)
                : a,
            ),
          );
        }
        return { previous };
      }
      return {};
    },
    onError: (err, { agent, action }, context) => {
      if (selectedCompanyId && context && "previous" in context && context.previous) {
        queryClient.setQueryData(queryKeys.agents.list(selectedCompanyId), context.previous);
      }
      pushToast({
        title: action === "pause" ? "Could not pause agent" : "Could not resume agent",
        body: err instanceof Error ? err.message : agent.name,
        tone: "error",
      });
    },
    onSuccess: (_d, { agent, action }) => {
      pushToast({
        title: action === "pause" ? "Agent paused" : "Agent resumed",
        body: agent.name,
        tone: "success",
      });
    },
    onSettled: (_d, _e, { agent }) => {
      setPendingAgentIds((cur) => {
        const next = new Set(cur);
        next.delete(agent.id);
        return next;
      });
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId) });
      }
    },
  });
  const onPauseResume = (agent: Agent, action: "pause" | "resume") =>
    pauseResumeAgent.mutate({ agent, action });

  useEffect(() => {
    setBreadcrumbs([{ label: "Fleet" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a company to view the fleet." />;
  }
  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const allAgents = (agents ?? []).filter((a) => a.status !== "terminated");
  const counts = {
    all: allAgents.length,
    active: allAgents.filter((a) => matchesFilter(a.status, "active")).length,
    paused: allAgents.filter((a) => a.status === "paused").length,
    error: allAgents.filter((a) => a.status === "error").length,
  };

  const visibleAgents = allAgents.filter((a) => matchesFilter(a.status, tab));
  const groups = deriveGroups(visibleAgents, orgTree);

  const summarySpend = costSummary
    ? formatUsd(costSummary.spendCents)
    : formatUsd(allAgents.reduce((s, a) => s + (a.spentMonthlyCents ?? 0), 0));
  const summaryBudget = costSummary && costSummary.budgetCents > 0 ? formatUsd(costSummary.budgetCents) : null;

  return (
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="fleet"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight" style={{ color: DS.text }}>
            Fleet
          </h1>
          <p className="text-[13px]" style={{ color: DS.textMuted }}>
            {allAgents.length} agents · <span className="font-mono">{summarySpend}</span>
            {summaryBudget ? <span className="font-mono"> / {summaryBudget}</span> : null} this month
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-[10px] p-0.5" style={{ background: DS.surface2, border: `1px solid ${DS.border2}` }}>
            <button
              type="button"
              onClick={() => setView("list")}
              className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={view === "list" ? { background: DS.surface3, color: DS.text } : { color: DS.textMuted }}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => setView("org")}
              className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={view === "org" ? { background: DS.surface3, color: DS.text } : { color: DS.textMuted }}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Org
            </button>
          </div>
          <button
            type="button"
            onClick={openNewAgent}
            className="flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: DS.primary, color: "#fff" }}
          >
            <Plus className="h-4 w-4" />
            New Agent
          </button>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="All" count={counts.all} active={tab === "all"} onClick={() => navigate("/agents/all")} />
        <FilterPill label="Active" count={counts.active} dot={DS.success} active={tab === "active"} onClick={() => navigate("/agents/active")} />
        <FilterPill label="Paused" count={counts.paused} dot={DS.warning} active={tab === "paused"} onClick={() => navigate("/agents/paused")} />
        <FilterPill label="Error" count={counts.error} dot={DS.critical} active={tab === "error"} onClick={() => navigate("/agents/error")} />
      </div>

      {/* ACP Phase 1 — multi-agent self-described capabilities (read-only). Each
          roster agent's models/modes are built from one ACP handshake, not from
          hard-coded adapter config. Runs alongside the Hermes<->Ares bridge; no
          cutover. The single-agent POC panel follows for continuity. */}
      <div className="mb-4 flex flex-col gap-4">
        <AcpFleetPanel companyId={selectedCompanyId ?? undefined} />
      </div>

      {error && <p className="text-[13px]" style={{ color: DS.critical }}>{error.message}</p>}

      {allAgents.length === 0 ? (
        <EmptyState icon={Bot} message="Create your first agent to get started." action="New Agent" onAction={openNewAgent} />
      ) : view === "list" ? (
        <section style={surfaceCard} className="overflow-hidden">
          <ColumnHeader />
          {visibleAgents.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px]" style={{ color: DS.textMuted }}>
              No agents match the selected filter.
            </p>
          ) : (
            <>
              <ListSection
                label="Leadership"
                rows={groups.leadership}
                currentTaskFor={currentTaskFor}
                liveFor={liveFor}
                pendingIds={pendingAgentIds}
                onOpen={(a) => setOpenAgentId(a.id)}
                onPauseResume={onPauseResume}
              />
              <ListSection
                label="Agents"
                rows={groups.agents}
                currentTaskFor={currentTaskFor}
                liveFor={liveFor}
                pendingIds={pendingAgentIds}
                onOpen={(a) => setOpenAgentId(a.id)}
                onPauseResume={onPauseResume}
              />
              <ListSection
                label="External"
                rows={groups.external}
                external
                currentTaskFor={currentTaskFor}
                liveFor={liveFor}
                pendingIds={pendingAgentIds}
                onOpen={(a) => setOpenAgentId(a.id)}
                onPauseResume={onPauseResume}
              />
              <div className="px-5 py-3 text-center text-[11px]" style={{ color: DS.textFaint }}>
                Showing {visibleAgents.length} of {counts.all} agents
              </div>
            </>
          )}
        </section>
      ) : (
        <section style={surfaceCard} className="overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${DS.border}` }}>
            <GitBranch className="h-3.5 w-3.5" style={{ color: DS.textFaint }} />
            <SectionLabel>Org Chart View</SectionLabel>
          </div>
          {orgTree && orgTree.length > 0 ? (
            <OrgView orgTree={orgTree} agentMap={agentMap} onOpen={(id) => setOpenAgentId(id)} />
          ) : (
            <p className="px-5 py-10 text-center text-[13px]" style={{ color: DS.textMuted }}>
              No organizational hierarchy defined.
            </p>
          )}
        </section>
      )}

      {openAgentId && (
        <AgentDrawer
          agentId={openAgentId}
          companyId={selectedCompanyId}
          agentMap={agentMap}
          pending={pendingAgentIds.has(openAgentId)}
          onClose={() => setOpenAgentId(null)}
          onPauseResume={onPauseResume}
        />
      )}
    </div>
  );
}

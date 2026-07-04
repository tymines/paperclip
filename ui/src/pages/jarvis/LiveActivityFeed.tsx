import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Wifi, WifiOff, Clock, Hammer } from "lucide-react";
import { agentsApi } from "@/api/agents";
import type { Agent } from "@paperclipai/shared";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System — same tokens as JarvisPage.                       */
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
} as const;

const MONO =
  "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const AGENT_STATUS_TONE: Record<string, string> = {
  running: DS.success,
  active: DS.success,
  idle: DS.textMuted,
  error: DS.critical,
  paused: DS.warning,
  terminated: DS.textFaint,
};

function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  const c = AGENT_STATUS_TONE[status] ?? DS.textFaint;
  return (
    <span
      className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: c }}
    >
      {pulse ? (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: c,
            animation: "la-ping 1.6s cubic-bezier(0,0,.2,1) infinite",
          }}
        />
      ) : null}
    </span>
  );
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${Math.max(secs, 0)}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function currentTaskOf(a: Agent): string | null {
  const m = a.metadata as Record<string, unknown> | null;
  if (!m) return null;
  const t = m.currentTask;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function lastToolCallOf(a: Agent): string | null {
  const m = a.metadata as Record<string, unknown> | null;
  if (!m) return null;
  const t = m.lastToolCall;
  return typeof t === "string" && t.length > 0 ? t : null;
}

export default function LiveActivityFeed({ companyId }: { companyId: string }) {
  const { data: agents, isLoading, isError } = useQuery({
    queryKey: ["live-activity", companyId],
    queryFn: () => agentsApi.list(companyId),
    refetchInterval: 10_000,
    enabled: !!companyId,
  });

  const list = agents ?? [];

  const stats = useMemo(() => {
    const active = list.filter(
      (a) => a.status === "running" || a.status === "active",
    ).length;
    const errored = list.filter((a) => a.status === "error").length;
    const idle = list.filter((a) => a.status === "idle").length;
    return { total: list.length, active, errored, idle };
  }, [list]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <style>{`@keyframes la-ping{75%,100%{transform:scale(2.4);opacity:0}}`}</style>

      <div className="mb-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DS.text }}>
          <Activity className="h-4 w-4" style={{ color: DS.primary }} />
          Live Agent Activity
        </h2>
        <p className="mt-0.5 text-[13px]" style={{ color: DS.textMuted }}>
          Real-time agent telemetry — polls every 10s.
        </p>
      </div>

      {/* Summary bar */}
      <div className="mb-5 flex flex-wrap gap-3">
        <StatBadge label="Total" value={stats.total} tone="muted" />
        <StatBadge label="Active" value={stats.active} tone="success" />
        <StatBadge label="Idle" value={stats.idle} tone="muted" />
        {stats.errored > 0 && (
          <StatBadge label="Errors" value={stats.errored} tone="critical" />
        )}
      </div>

      {isLoading ? (
        <div className="text-[13px]" style={{ color: DS.textMuted }}>
          Loading agent telemetry…
        </div>
      ) : isError ? (
        <div
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: `${DS.critical}14`, border: `1px solid ${DS.critical}55`, color: DS.critical }}
        >
          Couldn't load agent data.
        </div>
      ) : list.length === 0 ? (
        <div
          className="rounded-xl px-5 py-6 text-[13px]"
          style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
        >
          No agents registered. Add agents from the Fleet page to see their live activity.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((a) => {
            const task = currentTaskOf(a);
            const lastTool = lastToolCallOf(a);
            const isRunning = a.status === "running" || a.status === "active";
            return (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-xl px-4 py-3"
                style={{
                  background: DS.surface2,
                  border: `1px solid ${DS.border2}`,
                }}
              >
                <StatusDot status={a.status} pulse={isRunning} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold" style={{ color: DS.text }}>
                      {a.name}
                    </span>
                    <span className="text-[11px]" style={{ color: DS.textFaint }}>
                      {a.role ?? a.title ?? ""}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: DS.textMuted }}>
                    {task ? (
                      <span className="flex items-center gap-1 truncate">
                        <Hammer className="h-3 w-3 shrink-0" />
                        {task}
                      </span>
                    ) : isRunning ? (
                      <span>Working…</span>
                    ) : (
                      <span>{a.status}</span>
                    )}
                    {lastTool && (
                      <span className="truncate" style={{ color: DS.textFaint }}>
                        last tool: {lastTool}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
                  {a.lastHeartbeatAt ? (
                    <span className="flex items-center gap-1" title={`Last heartbeat: ${String(a.lastHeartbeatAt)}`}>
                      {isRunning ? (
                        <Wifi className="h-3 w-3" style={{ color: DS.success }} />
                      ) : (
                        <WifiOff className="h-3 w-3" />
                      )}
                      {relativeTime(String(a.lastHeartbeatAt))}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      never
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "critical" | "muted";
}) {
  const c =
    tone === "success" ? DS.success : tone === "critical" ? DS.critical : DS.textMuted;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
      style={{ background: `${c}18`, border: `1px solid ${c}44`, color: c }}
    >
      {label}
      <span style={{ fontFamily: MONO }}>{value}</span>
    </span>
  );
}

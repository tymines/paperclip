/**
 * ACP Backend capability panel — POC, READ-ONLY (Fleet view).
 *
 * Connects to one agent over the ACP / OpenClaw gateway-WS path and renders the
 * capabilities the agent SELF-DESCRIBES on connect: server/protocol, models,
 * modes, slash commands, roster, identity and Team-Mode eligibility.
 *
 * Nothing here is hard-coded per agent — the entire panel is built from the
 * live handshake. A small legend marks which fields are verbatim from the agent
 * (real) vs computed by Paperclip (derived). This proves the phase-2 transport
 * idea alongside the existing bridge, with no cutover.
 */
import { useQuery } from "@tanstack/react-query";
import { acpApi, type AcpHandshakeResult, type AcpProvenance } from "../api/acp";
import { Boxes, Cpu, Command, SlidersHorizontal, Users, Wifi, WifiOff, ShieldCheck } from "lucide-react";

const C = {
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  accent: "#A56EFF",
} as const;

function ProvBadge({ kind }: { kind: AcpProvenance }) {
  const map = {
    real: { bg: "rgba(47,227,138,0.12)", fg: C.success, label: "real" },
    derived: { bg: "rgba(244,185,64,0.14)", fg: C.warning, label: "derived" },
    stub: { bg: "rgba(255,91,91,0.14)", fg: C.critical, label: "stub" },
  }[kind];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={{ background: map.bg, color: map.fg }}
    >
      {map.label}
    </span>
  );
}

function SectionTitle({
  icon,
  children,
  prov,
  count,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  prov: AcpProvenance;
  count?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span style={{ color: C.textMuted }}>{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
        {children}
      </span>
      {typeof count === "number" && (
        <span className="font-mono text-[11px]" style={{ color: C.textFaint }}>
          {count}
        </span>
      )}
      <ProvBadge kind={prov} />
    </div>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-[7px] px-2 py-1 text-[11px] font-medium"
      style={{ background: C.surface3, border: `1px solid ${C.border2}`, color: C.text }}
    >
      {children}
    </span>
  );
}

export function AcpCapabilitiesPanel({
  agentId = "main",
  label = "OpenClaw Agent",
}: {
  agentId?: string;
  label?: string;
}) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<AcpHandshakeResult>({
    queryKey: ["acp", "handshake", agentId],
    queryFn: () => acpApi.handshake({ agentId, label }),
    staleTime: 30_000,
    retry: false,
  });

  const card: React.CSSProperties = {
    background: `linear-gradient(180deg, ${C.surface2} 0%, ${C.surface} 100%)`,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
  };

  const connected = data?.ok === true;

  return (
    <section style={card} className="overflow-hidden">
      {/* header */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3.5"
        style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-[9px]"
            style={{ background: "rgba(59,130,255,0.12)", color: C.primary }}
          >
            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold" style={{ color: C.text }}>
                ACP Backend — self-described capabilities
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(165,110,255,0.14)", color: C.accent }}
              >
                POC
              </span>
            </div>
            <div className="text-[11px]" style={{ color: C.textFaint }}>
              Phase-2 transport, read-only · runs alongside the existing bridge (no cutover)
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-[9px] px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: C.surface3, border: `1px solid ${C.border2}`, color: C.text }}
        >
          {isFetching ? "Connecting…" : "Reconnect"}
        </button>
      </div>

      <div className="px-5 py-4">
        {isLoading && (
          <p className="text-[13px]" style={{ color: C.textMuted }}>
            Opening gateway WebSocket and reading handshake…
          </p>
        )}

        {error && (
          <p className="text-[13px]" style={{ color: C.critical }}>
            Failed to reach ACP route: {(error as Error).message}
          </p>
        )}

        {data && !data.ok && (
          <p className="text-[13px]" style={{ color: C.critical }}>
            Handshake failed at “{data.stage}”: {data.error}
          </p>
        )}

        {data && data.ok && (
          <div className="flex flex-col gap-5">
            {/* connection summary */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[18px]">{data.identity.avatar ?? "🔌"}</span>
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: C.text }}>
                    {data.agentLabel}
                    {data.identity.name ? (
                      <span style={{ color: C.textFaint }}> · {data.identity.name}</span>
                    ) : null}
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: C.textFaint }}>
                    {data.transport} · {data.url}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: "rgba(47,227,138,0.12)", color: C.success }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.success }} />
                  hello-ok
                </span>
                <span className="font-mono">
                  v{data.server.version} · protocol {data.server.protocol} · {data.handshakeMs}ms
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: data.teamCapable ? C.success : C.textFaint }} />
                <span className="text-[12px]" style={{ color: C.text }}>
                  Team-capable: <strong>{data.teamCapable ? "yes" : "no"}</strong>
                </span>
                <ProvBadge kind="derived" />
                <span className="text-[11px]" style={{ color: C.textFaint }} title={data.teamCapableReason}>
                  ({data.teamCapableReason})
                </span>
              </div>
            </div>

            {/* models */}
            <div>
              <SectionTitle icon={<Cpu className="h-3.5 w-3.5" />} prov={data.provenance.models ?? "real"} count={data.models.length}>
                Models
              </SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {data.models.map((m) => (
                  <Chip key={m.id} title={`${m.provider ?? ""} · ctx ${m.contextWindow ?? "?"}${m.reasoning ? " · reasoning" : ""}`}>
                    {m.name}
                  </Chip>
                ))}
              </div>
            </div>

            {/* modes */}
            <div>
              <SectionTitle icon={<SlidersHorizontal className="h-3.5 w-3.5" />} prov={data.provenance.modes ?? "real"} count={data.modes.length}>
                Modes
              </SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {data.modes.map((mode) => (
                  <Chip key={mode.id}>
                    {mode.label}
                    {data.modeDefault === mode.id ? (
                      <span style={{ color: C.primary }}> · default</span>
                    ) : null}
                  </Chip>
                ))}
                {data.modes.length === 0 && (
                  <span className="text-[12px]" style={{ color: C.textFaint }}>none advertised</span>
                )}
              </div>
            </div>

            {/* slash commands */}
            <div>
              <SectionTitle icon={<Command className="h-3.5 w-3.5" />} prov={data.provenance.slashCommands ?? "real"} count={data.slashCommands.length}>
                Slash commands
              </SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {data.slashCommands.slice(0, 28).map((c) => (
                  <Chip key={c.name} title={c.description}>
                    /{c.name}
                  </Chip>
                ))}
                {data.slashCommands.length > 28 && (
                  <span className="text-[11px]" style={{ color: C.textFaint }}>
                    +{data.slashCommands.length - 28} more
                  </span>
                )}
              </div>
            </div>

            {/* roster */}
            <div>
              <SectionTitle icon={<Users className="h-3.5 w-3.5" />} prov={data.provenance.roster ?? "real"} count={data.roster.length}>
                Roster (self-described)
              </SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {data.roster.map((r) => (
                  <Chip key={r.id} title={`${r.model ?? ""}${r.runtime ? ` · ${r.runtime}` : ""}`}>
                    {r.name}
                  </Chip>
                ))}
              </div>
            </div>

            {/* method catalog summary */}
            <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textFaint }}>
              <Boxes className="h-3.5 w-3.5" />
              Advertises {data.methods.length} RPC methods and {data.events.length} event streams (full ACP method catalog).
              <ProvBadge kind="real" />
            </div>

            {/* legend */}
            <div
              className="flex items-center gap-3 rounded-[9px] px-3 py-2 text-[11px]"
              style={{ background: C.surface, border: `1px dashed ${C.border2}`, color: C.textMuted }}
            >
              <span>Provenance:</span>
              <span className="flex items-center gap-1.5"><ProvBadge kind="real" /> verbatim from agent handshake</span>
              <span className="flex items-center gap-1.5"><ProvBadge kind="derived" /> computed by Paperclip</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

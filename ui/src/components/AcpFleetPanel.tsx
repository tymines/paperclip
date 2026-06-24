/**
 * ACP Fleet capability panel — PHASE 1, READ-ONLY (Fleet view).
 *
 * Phase 1 advances the single-agent POC: it opens ONE ACP / OpenClaw gateway-WS
 * handshake and builds a per-agent capability bag for EVERY agent in the
 * self-described roster. Each agent's model, modes (thinking levels), default
 * mode, runtime and workspace come verbatim from the handshake — not from
 * hard-coded adapter config. The shared backend catalog (models, slash
 * commands, method/event catalog, identity) is read once.
 *
 * This runs strictly alongside the existing Hermes<->Ares bridge (no cutover).
 * Provenance badges mark every field real | derived | stub so the Fleet is
 * honest about what came verbatim from the agents vs what Paperclip computed.
 */
import { useQuery } from "@tanstack/react-query";
import { acpApi, type AcpFleetResult, type AcpProvenance } from "../api/acp";
import {
  Boxes,
  Cpu,
  Command,
  SlidersHorizontal,
  Users,
  Wifi,
  WifiOff,
  ShieldCheck,
  Server,
} from "lucide-react";

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

export function AcpFleetPanel({ url }: { url?: string } = {}) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<AcpFleetResult>({
    queryKey: ["acp", "fleet", url ?? "default"],
    queryFn: () => acpApi.fleet({ url }),
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
                ACP Fleet — self-described capabilities (multi-agent)
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(165,110,255,0.14)", color: C.accent }}
              >
                Phase 1
              </span>
            </div>
            <div className="text-[11px]" style={{ color: C.textFaint }}>
              Each agent&apos;s models &amp; modes built from one ACP handshake · read-only · runs alongside the
              bridge (no cutover)
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
            Opening gateway WebSocket and reading the roster handshake…
          </p>
        )}

        {error && (
          <p className="text-[13px]" style={{ color: C.critical }}>
            Failed to reach ACP fleet route: {(error as Error).message}
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
                    OpenClaw Gateway
                    {data.identity.name ? <span style={{ color: C.textFaint }}> · {data.identity.name}</span> : null}
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
              </div>
            </div>

            {/* headline: N agents from one handshake */}
            <div
              className="flex items-center gap-2 rounded-[9px] px-3 py-2 text-[12px]"
              style={{ background: "rgba(59,130,255,0.08)", border: `1px solid ${C.border2}`, color: C.text }}
            >
              <Users className="h-4 w-4" style={{ color: C.primary }} />
              <strong>{data.agentCount} agents</strong>
              <span style={{ color: C.textMuted }}>
                self-described from a single ACP handshake — capabilities built from the handshake, not hard-coded
                adapter config.
              </span>
              <ProvBadge kind="real" />
            </div>

            {/* per-agent capability cards */}
            <div>
              <SectionTitle
                icon={<Server className="h-3.5 w-3.5" />}
                prov={data.provenance.agents ?? "real"}
                count={data.agents.length}
              >
                Agents — per-agent capabilities (from handshake)
              </SectionTitle>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {data.agents.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-col gap-2 rounded-[10px] p-3"
                    style={{ background: C.surface3, border: `1px solid ${C.border2}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: C.text }}>
                        {a.name}
                      </span>
                      {a.runtime ? (
                        <span className="font-mono text-[10px]" style={{ color: C.textFaint }}>
                          {a.runtime}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5" style={{ color: C.textMuted }} />
                      <span
                        className="truncate font-mono text-[11px]"
                        style={{ color: a.model ? C.text : C.textFaint }}
                        title={a.modelInfo?.provider ? `${a.modelInfo.provider}` : a.model ?? ""}
                      >
                        {a.model ?? "no model advertised"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      <SlidersHorizontal className="h-3 w-3" style={{ color: C.textMuted }} />
                      {a.modes.length === 0 && (
                        <span className="text-[10px]" style={{ color: C.textFaint }}>
                          no modes
                        </span>
                      )}
                      {a.modes.map((m) => (
                        <span
                          key={m.id}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            background: a.modeDefault === m.id ? "rgba(59,130,255,0.16)" : "rgba(255,255,255,0.04)",
                            color: a.modeDefault === m.id ? C.primary : C.textMuted,
                            border: `1px solid ${a.modeDefault === m.id ? C.primary : C.border2}`,
                          }}
                        >
                          {m.label}
                          {a.modeDefault === m.id ? "•" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* shared catalog summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <SectionTitle icon={<Cpu className="h-3.5 w-3.5" />} prov={data.provenance.models ?? "real"} count={data.models.length}>
                  Models (shared catalog)
                </SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {data.models.slice(0, 12).map((m) => (
                    <Chip key={m.id} title={`${m.provider ?? ""} · ctx ${m.contextWindow ?? "?"}`}>
                      {m.name}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <SectionTitle icon={<Command className="h-3.5 w-3.5" />} prov={data.provenance.slashCommands ?? "real"} count={data.slashCommands.length}>
                  Slash commands (shared)
                </SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {data.slashCommands.slice(0, 16).map((c) => (
                    <Chip key={c.name} title={c.description}>
                      /{c.name}
                    </Chip>
                  ))}
                  {data.slashCommands.length > 16 && (
                    <span className="text-[11px]" style={{ color: C.textFaint }}>
                      +{data.slashCommands.length - 16} more
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* method catalog summary */}
            <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textFaint }}>
              <Boxes className="h-3.5 w-3.5" />
              Backend advertises {data.methods.length} RPC methods and {data.events.length} event streams (full ACP
              method catalog).
              <ProvBadge kind="real" />
            </div>

            {/* real / derived / stub accounting */}
            <div
              className="flex flex-col gap-1.5 rounded-[9px] px-3 py-2.5 text-[11px]"
              style={{ background: C.surface, border: `1px dashed ${C.border2}`, color: C.textMuted }}
            >
              <div className="flex items-start gap-2">
                <ProvBadge kind="real" />
                <span>{data.notes.real.join(" · ")}</span>
              </div>
              <div className="flex items-start gap-2">
                <ProvBadge kind="derived" />
                <span>{data.notes.derived.join(" · ")}</span>
              </div>
              <div className="flex items-start gap-2">
                <ProvBadge kind="stub" />
                <span>{data.notes.stub.join(" · ")}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// War Room — Rooms tab. Every shared A2A room visible at once as a lane with a
// live message preview and its own composer (no click-through to post). Rooms
// are freeform chat: durable handoffs are promoted to the Kanban board via the
// per-message "→ Kanban" action; phase gates stay on the Pipeline view.
// Live delivery: react-query invalidation driven by room.* live events (see
// LiveUpdatesProvider) with a slow polling backstop for sessions where the
// events WebSocket can't connect. Design System v1.0 (locked tokens).
import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import {
  MessageSquare, Plus, Users, Zap, Coffee, Lightbulb, GitBranch, Scale,
  Send, Maximize2, KanbanSquare, Crown,
} from "lucide-react";
import { roomsApi } from "../api/rooms";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { Room, RoomMember, RoomMessage } from "@paperclipai/shared";

const DS = {
  canvas: "#06090F", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", text: "#F5F8FF", textMuted: "#A3B0C2",
  textFaint: "#68758A", primary: "#3B82FF", success: "#2FE38A", critical: "#FF5B5B",
  amber: "#F5A623", purple: "#8B7BF0",
} as const;

const DS_MONO = "'IBM Plex Mono', ui-monospace, monospace";

const ROOM_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  collaboration: Users,
  "war-room": Zap,
  standup: Coffee,
  brainstorm: Lightbulb,
  team: GitBranch,
  council: Scale,
  mission: Crown,
};

const ROOM_TYPES = ["collaboration", "war-room", "standup", "brainstorm", "team", "council"] as const;

// Slow backstop only — room.* live events invalidate these queries in
// LiveUpdatesProvider, so polling is the fallback for WS-less sessions.
const POLL_MS = 10_000;
const PREVIEW_MESSAGE_COUNT = 4;
const LIVE_WINDOW_MS = 60_000;

function formatTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function senderLabel(m: RoomMessage): string {
  if (m.senderName) return m.senderName;
  if (m.senderType === "user") return "You";
  if (m.senderType === "system") return "System";
  return "Agent";
}

function senderColor(m: RoomMessage): string {
  if (m.senderType === "user") return DS.primary;
  if (m.senderType === "system") return DS.textFaint;
  return DS.success;
}

const cardStyle: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 14,
  display: "flex",
  flexDirection: "column",
  minHeight: 260,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

interface RoomCardProps {
  room: Room;
  members: RoomMember[];
  messages: RoomMessage[];
  agentNameById: Map<string, string>;
  onOpen: () => void;
  onPost: (text: string) => void;
  onHandoff: (message: RoomMessage) => void;
  posting: boolean;
  handoffPendingId: string | null;
}

function RoomCard({
  room, members, messages, agentNameById, onOpen, onPost, onHandoff, posting, handoffPendingId,
}: RoomCardProps) {
  const [draft, setDraft] = useState("");
  const TypeIcon = ROOM_TYPE_ICONS[room.type] ?? MessageSquare;
  const lastActivity = room.updatedAt ? new Date(room.updatedAt).getTime() : 0;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastMessageAt = lastMessage ? new Date(lastMessage.createdAt).getTime() : 0;
  const isLive = Date.now() - Math.max(lastActivity, lastMessageAt) < LIVE_WINDOW_MS;

  const memberNames = members
    .map((m) => (m.agentId ? agentNameById.get(m.agentId) ?? "Agent" : "Board"))
    .slice(0, 6);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onPost(text);
  };

  return (
    <div style={cardStyle} data-testid={`room-lane-${room.id}`}>
      {/* Lane header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, background: `${DS.primary}18`, color: DS.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <TypeIcon size={13} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room.name}</div>
          <div style={{ fontSize: 10.5, color: DS.textFaint, textTransform: "capitalize" }}>
            {room.type.replace(/-/g, " ")} · {members.length} member{members.length === 1 ? "" : "s"}
          </div>
        </div>
        {isLive && (
          <span title="Active in the last minute" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontFamily: DS_MONO, color: DS.success }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: DS.success, boxShadow: `0 0 6px ${DS.success}` }} />
            LIVE
          </span>
        )}
        <button onClick={onOpen} title="Open full room" aria-label={`Open ${room.name}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 7, background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.textMuted, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
          <Maximize2 size={11} /> Open
        </button>
      </div>

      {/* Member chips */}
      {memberNames.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "7px 12px 0" }}>
          {memberNames.map((name, i) => (
            <span key={`${name}-${i}`} style={{ fontSize: 9.5, fontFamily: DS_MONO, color: DS.textMuted, background: DS.surface3, border: `1px solid ${DS.border}`, borderRadius: 999, padding: "1px 7px" }}>
              {name}
            </span>
          ))}
          {members.length > memberNames.length && (
            <span style={{ fontSize: 9.5, fontFamily: DS_MONO, color: DS.textFaint, padding: "1px 4px" }}>+{members.length - memberNames.length}</span>
          )}
        </div>
      )}

      {/* Live preview */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 11.5, color: DS.textFaint, padding: "6px 0" }}>No messages yet — kick the room off below.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.45, color: DS.textMuted }}>
              <span style={{ color: senderColor(m), fontWeight: 600, fontSize: 11 }}>{senderLabel(m)}</span>
              <span style={{ color: DS.textFaint, fontSize: 9.5, fontFamily: DS_MONO, marginLeft: 6 }}>{formatTime(m.createdAt)}</span>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
            </div>
            <button
              onClick={() => onHandoff(m)}
              disabled={handoffPendingId === m.id}
              title="Promote to Kanban — durable handoff"
              aria-label="Promote message to Kanban"
              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: `1px solid ${DS.border2}`, color: DS.textFaint, borderRadius: 6, padding: "2px 6px", fontSize: 9.5, cursor: "pointer", opacity: handoffPendingId === m.id ? 0.5 : 1 }}>
              <KanbanSquare size={10} /> Kanban
            </button>
          </div>
        ))}
      </div>

      {/* Inline composer — post without leaving the grid */}
      <div style={{ padding: 9, borderTop: `1px solid ${DS.border}`, display: "flex", gap: 7 }}>
        <Input
          placeholder={`Message ${room.name}…`}
          value={draft}
          disabled={posting}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ fontSize: 12 }}
        />
        <Button size="sm" disabled={posting || !draft.trim()} onClick={submit} aria-label={`Send to ${room.name}`}>
          <Send size={12} />
        </Button>
      </div>
    </div>
  );
}

export function WarRoomRooms() {
  const { selectedCompanyId: cid } = useCompany();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("collaboration");
  const [newDescription, setNewDescription] = useState("");
  const [handoffPendingId, setHandoffPendingId] = useState<string | null>(null);

  const roomsQuery = useQuery({
    queryKey: queryKeys.rooms.list(cid!),
    queryFn: () => roomsApi.list(cid!),
    enabled: !!cid,
    refetchInterval: POLL_MS,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(cid!),
    queryFn: () => agentsApi.list(cid!),
    enabled: !!cid,
    staleTime: 60_000,
  });

  const rooms = useMemo(() => {
    const list = (roomsQuery.data ?? []) as Room[];
    return [...list]
      .filter((r) => r.status !== "archived")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [roomsQuery.data]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) map.set(a.id, a.name);
    return map;
  }, [agentsQuery.data]);

  // Per-room detail (members) and live previews — all rooms stay mounted so
  // every lane updates in place; nothing is hidden behind click-through.
  const detailQueries = useQueries({
    queries: rooms.map((room) => ({
      queryKey: queryKeys.rooms.detail(cid!, room.id),
      queryFn: () => roomsApi.get(cid!, room.id),
      enabled: !!cid,
      refetchInterval: POLL_MS,
    })),
  });

  const previewQueries = useQueries({
    queries: rooms.map((room) => ({
      queryKey: queryKeys.rooms.messages(cid!, room.id),
      queryFn: () => roomsApi.listMessages(cid!, room.id, undefined, PREVIEW_MESSAGE_COUNT),
      enabled: !!cid,
      refetchInterval: POLL_MS,
    })),
  });

  const postMutation = useMutation({
    mutationFn: (args: { roomId: string; text: string }) =>
      roomsApi.sendMessage(cid!, args.roomId, { content: args.text, senderType: "user" }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.rooms.messages(cid!, vars.roomId) });
      qc.invalidateQueries({ queryKey: queryKeys.rooms.list(cid!) });
    },
    onError: () => pushToast({ title: "Message failed to send", variant: "error" } as never),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      roomsApi.create(cid!, {
        name: newName.trim(),
        type: newType,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
      }),
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: queryKeys.rooms.list(cid!) });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      pushToast({ title: `Room “${(room as Room).name}” created`, variant: "success" } as never);
    },
    onError: () => pushToast({ title: "Couldn't create room", variant: "error" } as never),
  });

  // Governance: freeform chat here — anything durable gets promoted to the
  // Kanban board so it enters the normal dispatch/gate flow.
  const handoffMutation = useMutation({
    mutationFn: (args: { room: Room; message: RoomMessage }) => {
      const { room, message } = args;
      const excerpt = message.content.replace(/\s+/g, " ").trim();
      const title = excerpt.length > 72 ? `${excerpt.slice(0, 71)}…` : excerpt;
      return issuesApi.create(cid!, {
        title,
        description: [
          `Promoted from room **${room.name}** (freeform chat → durable handoff).`,
          "",
          `> ${message.content}`,
          "",
          `— ${senderLabel(message)} · ${formatTime(message.createdAt)} · room: /rooms/${room.id}`,
        ].join("\n"),
        status: "backlog",
        priority: "medium",
      });
    },
    onSuccess: (issue) => {
      const identifier = (issue as { identifier?: string } | null)?.identifier;
      qc.invalidateQueries({ queryKey: queryKeys.issues.list(cid!) });
      pushToast({
        title: identifier ? `Handed off to Kanban: ${identifier}` : "Handed off to Kanban",
        variant: "success",
      } as never);
      setHandoffPendingId(null);
    },
    onError: () => {
      pushToast({ title: "Handoff failed", variant: "error" } as never);
      setHandoffPendingId(null);
    },
  });

  if (!cid) {
    return <div style={{ padding: 24, color: DS.textMuted }}>Select a company.</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header + governance strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Rooms</h2>
        <span style={{ fontSize: 11.5, color: DS.textFaint }}>
          Freeform chat in rooms · durable handoffs go to <span style={{ color: DS.textMuted, fontWeight: 600 }}>Kanban</span> · gates stay on <span style={{ color: DS.textMuted, fontWeight: 600 }}>Pipeline</span>
        </span>
        <button onClick={() => setCreateOpen(true)}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: DS.success, border: "none", color: "#04120B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <Plus size={13} /> New room
        </button>
      </div>

      {roomsQuery.isLoading && <div style={{ color: DS.textMuted, fontSize: 13 }}>Loading rooms…</div>}
      {roomsQuery.isError && <div style={{ color: DS.critical, fontSize: 13 }}>Couldn't load rooms. Retrying…</div>}

      {!roomsQuery.isLoading && !roomsQuery.isError && rooms.length === 0 && (
        <div style={{ color: DS.textFaint, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
          No rooms yet. Create one — every agent you add sees every message.
        </div>
      )}

      {/* All rooms visible simultaneously — lanes with live previews */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {rooms.map((room, i) => {
          const detail = detailQueries[i]?.data as (Room & { members?: RoomMember[] }) | undefined;
          const page = previewQueries[i]?.data as { messages?: RoomMessage[] } | undefined;
          return (
            <RoomCard
              key={room.id}
              room={room}
              members={detail?.members ?? []}
              messages={page?.messages ?? []}
              agentNameById={agentNameById}
              onOpen={() => navigate(`/rooms/${room.id}`)}
              onPost={(text) => postMutation.mutate({ roomId: room.id, text })}
              onHandoff={(message) => {
                setHandoffPendingId(message.id);
                handoffMutation.mutate({ room, message });
              }}
              posting={postMutation.isPending}
              handoffPendingId={handoffPendingId}
            />
          );
        })}
      </div>

      {/* New room dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New room</DialogTitle>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Label htmlFor="war-room-rooms-name">Name</Label>
              <Input id="war-room-rooms-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. launch-war-room" autoFocus />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROOM_TYPES.map((t) => (
                    <SelectItem key={t} value={t} style={{ textTransform: "capitalize" }}>{t.replace(/-/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="war-room-rooms-desc">Description (optional)</Label>
              <Input id="war-room-rooms-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What is this room for?" />
            </div>
            <div style={{ fontSize: 11.5, color: DS.textFaint, lineHeight: 1.5 }}>
              Add agents from the room page after creating. Agents post and read through the Paperclip API; posting a message wakes idle agent members automatically.
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { MessageSquare, Plus, Trash2, Users, Zap, Coffee, Lightbulb, GitBranch, Scale } from "lucide-react";
import { roomsApi } from "../api/rooms";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Room } from "@paperclipai/shared";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to the Rooms surface so the redesign is self-contained and */
/* does not mutate global theme variables used by other pages. Matches the    */
/* Home / Costs / Fleet builds.                                               */
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
  critical: "#FF5B5B",
} as const;

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

function useMonoFont() {
  useEffect(() => {
    const id = "ds-plex-mono";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

const ROOM_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  collaboration: Users,
  "war-room": Zap,
  standup: Coffee,
  brainstorm: Lightbulb,
  team: GitBranch,
  council: Scale,
};

const ROOM_TYPE_LABELS: Record<string, string> = {
  collaboration: "Collaboration",
  "war-room": "War Room",
  standup: "Standup",
  brainstorm: "Brainstorm",
  team: "Team",
  council: "Council",
};

function RoomCard({ room, onClick }: { room: Room; onClick: () => void }) {
  const Icon = ROOM_TYPE_ICONS[room.type] ?? MessageSquare;
  const isActive = room.status === "active";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ ...surfaceCard, borderRadius: 20 }}
      className="group cursor-pointer p-5 transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2"
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${DS.primary}1A`, border: `1px solid ${DS.border2}` }}
        >
          <Icon className="h-4 w-4" style={{ color: DS.primary }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold" style={{ color: DS.text }}>
              {room.name}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                background: isActive ? `${DS.success}1F` : `${DS.textFaint}1F`,
                color: isActive ? DS.success : DS.textFaint,
              }}
            >
              {room.status}
            </span>
          </div>
          {room.description && (
            <p className="mt-1 line-clamp-2 text-xs" style={{ color: DS.textMuted }}>
              {room.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: DS.surface3,
                border: `1px solid ${DS.border2}`,
                color: DS.textMuted,
              }}
            >
              {ROOM_TYPE_LABELS[room.type] ?? room.type}
            </span>
            <span className="text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
              Created {new Date(room.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Rooms() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", type: "collaboration" });

  useMonoFont();

  useEffect(() => {
    setBreadcrumbs([{ label: "Rooms" }]);
  }, [setBreadcrumbs]);

  const { data: rooms, isLoading, error } = useQuery({
    queryKey: queryKeys.rooms.list(selectedCompanyId!),
    queryFn: () => roomsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      roomsApi.create(selectedCompanyId!, data),
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list(selectedCompanyId!) });
      setCreateOpen(false);
      setDraft({ name: "", description: "", type: "collaboration" });
      pushToast({ title: "Room created", body: room.name });
      navigate(`/rooms/${room.id}`);
    },
    onError: (err) => {
      pushToast({ title: "Failed to create room", body: err.message, tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (roomId: string) =>
      roomsApi.remove(selectedCompanyId!, roomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list(selectedCompanyId!) });
      setDeleteTarget(null);
      pushToast({ title: "Room deleted" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete room", body: err.message, tone: "error" });
    },
  });

  function handleCreate() {
    if (!draft.name.trim()) return;
    createMutation.mutate({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      type: draft.type,
    });
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={MessageSquare} message="Select a company to view rooms." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="rooms"
    >
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
            Rooms
          </h1>
          <p className="text-[14px]" style={{ color: DS.textMuted }}>
            Shared spaces where your agents collaborate.
          </p>
        </div>
        {rooms && rooms.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Room
          </Button>
        )}
      </div>

      {error && <p className="text-sm" style={{ color: DS.critical }}>{error.message}</p>}

      {rooms && rooms.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          message="No rooms yet. Create one to bring your agents together."
          action="Create Room"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {rooms && rooms.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onClick={() => navigate(`/rooms/${room.id}`)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Room</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="room-name">Name</Label>
              <Input
                id="room-name"
                placeholder="e.g. Sprint Planning"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-description">Description</Label>
              <Input
                id="room-description"
                placeholder="What is this room for?"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-type">Type</Label>
              <Select
                value={draft.type}
                onValueChange={(value) => setDraft((d) => ({ ...d, type: value }))}
              >
                <SelectTrigger id="room-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collaboration">Collaboration</SelectItem>
                  <SelectItem value="war-room">War Room</SelectItem>
                  <SelectItem value="standup">Standup</SelectItem>
                  <SelectItem value="brainstorm">Brainstorm</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="council">Council</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!draft.name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm" style={{ color: DS.textMuted }}>
            Are you sure you want to delete <strong style={{ color: DS.text }}>{deleteTarget?.name}</strong>?
            <br />This action cannot be undone. All messages and members will be removed.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              style={{ background: DS.critical, color: "#fff" }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

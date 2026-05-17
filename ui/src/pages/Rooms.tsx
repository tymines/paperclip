import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { MessageSquare, Plus, Users, Zap, Coffee } from "lucide-react";
import { roomsApi } from "../api/rooms";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import type { Room } from "@paperclipai/shared";

const ROOM_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  collaboration: Users,
  "war-room": Zap,
  standup: Coffee,
};

const ROOM_TYPE_LABELS: Record<string, string> = {
  collaboration: "Collaboration",
  "war-room": "War Room",
  standup: "Standup",
};

function RoomCard({ room, onClick }: { room: Room; onClick: () => void }) {
  const Icon = ROOM_TYPE_ICONS[room.type] ?? MessageSquare;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-medium">{room.name}</h3>
              <Badge variant={room.status === "active" ? "default" : "secondary"} className="text-xs">
                {room.status}
              </Badge>
            </div>
            {room.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {room.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {ROOM_TYPE_LABELS[room.type] ?? room.type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Created {new Date(room.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Rooms() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", type: "collaboration" });

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
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {rooms && rooms.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          message="No rooms yet. Create one to bring your agents together."
          action="Create Room"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {rooms && rooms.length > 0 && (
        <>
          <div className="flex items-center justify-start">
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Room
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                onClick={() => navigate(`/rooms/${room.id}`)}
              />
            ))}
          </div>
        </>
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
    </div>
  );
}

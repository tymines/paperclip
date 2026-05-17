import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@/lib/router";
import {
  MessageSquare,
  PanelRight,
  Plus,
  Send,
  UserMinus,
  Users,
  Bot,
  User,
  Info,
  X,
} from "lucide-react";
import { roomsApi } from "../api/rooms";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { RoomMessage, RoomMember, RoomDetail as RoomDetailType } from "@paperclipai/shared";

type AgentMap = Record<string, { name: string; icon?: string | null }>;

function SenderAvatar({ senderType, agentName }: { senderType: string; agentName?: string }) {
  if (senderType === "agent") {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10" title={agentName}>
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
    );
  }
  if (senderType === "system") {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
      <User className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
    </div>
  );
}

function MessageBubble({
  message,
  members,
  agentMap,
}: {
  message: RoomMessage;
  members: RoomMember[];
  agentMap: AgentMap;
}) {
  const senderName = (() => {
    if (message.senderType === "system") return "System";
    // Check if sender is an agent by looking up in agent map
    const member = members.find(
      (m) => m.agentId === message.senderId || m.userId === message.senderId,
    );
    if (member?.agentId) {
      return agentMap[member.agentId]?.name ?? "Agent";
    }
    if (member?.userId) {
      return "You";
    }
    // Fallback: check agent map directly
    if (agentMap[message.senderId]) {
      return agentMap[message.senderId].name;
    }
    return message.senderType === "agent" ? "Agent" : "You";
  })();

  const isStatus = message.messageType === "status";

  if (isStatus) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-muted-foreground italic">{message.content}</span>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2 py-1.5">
      <SenderAvatar senderType={message.senderType} agentName={senderName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium">{senderName}</span>
          <span className="text-[10px] text-muted-foreground">
            {(() => {
              const d = new Date(message.createdAt);
              const now = new Date();
              const isToday =
                d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate();
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              const isYesterday =
                d.getFullYear() === yesterday.getFullYear() &&
                d.getMonth() === yesterday.getMonth() &&
                d.getDate() === yesterday.getDate();
              const time = d.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });
              if (isToday) return time;
              if (isYesterday) return `Yesterday, ${time}`;
              const date = d.toLocaleDateString([], {
                month: "short",
                day: "numeric",
              });
              return `${date}, ${time}`;
            })()}
          </span>
          {message.messageType === "action" && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              action
            </Badge>
          )}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{message.content}</p>
      </div>
    </div>
  );
}

function MemberSidebar({
  members,
  agentMap,
  onRemove,
  onAddClick,
  onClose,
}: {
  members: RoomMember[];
  agentMap: AgentMap;
  onRemove: (memberId: string) => void;
  onAddClick: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-56 shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Members ({members.length})
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onAddClick}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {members.map((member) => {
            const name = member.agentId
              ? (agentMap[member.agentId]?.name ?? "Agent")
              : "You";

            return (
              <div
                key={member.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
              >
                {member.agentId ? (
                  <Bot className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <User className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                )}
                <span className="flex-1 truncate text-xs">
                  {name}
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {member.role}
                </Badge>
                <button
                  type="button"
                  className="hidden group-hover:block"
                  onClick={() => onRemove(member.id)}
                >
                  <UserMinus className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function RoomDetail() {
  const { roomId } = useParams<{ roomId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [messageInput, setMessageInput] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memberType, setMemberType] = useState<"agent" | "user">("agent");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const companyId = selectedCompanyId!;

  const { data: room, isLoading: roomLoading } = useQuery({
    queryKey: queryKeys.rooms.detail(companyId, roomId!),
    queryFn: () => roomsApi.get(companyId, roomId!),
    enabled: !!companyId && !!roomId,
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: queryKeys.rooms.messages(companyId, roomId!),
    queryFn: () => roomsApi.listMessages(companyId, roomId!),
    enabled: !!companyId && !!roomId,
    refetchInterval: 3000,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const agentMap = useMemo<AgentMap>(() => {
    if (!agents) return {};
    const map: AgentMap = {};
    for (const agent of agents as { id: string; name: string; icon?: string | null }[]) {
      map[agent.id] = { name: agent.name, icon: agent.icon };
    }
    return map;
  }, [agents]);

  useEffect(() => {
    if (room) {
      setBreadcrumbs([
        { label: "Rooms", href: "/rooms" },
        { label: room.name },
      ]);
    }
  }, [setBreadcrumbs, room]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesData?.messages]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      roomsApi.sendMessage(companyId, roomId!, { content }),
    onSuccess: () => {
      setMessageInput("");
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.messages(companyId, roomId!) });
    },
    onError: (err) => {
      pushToast({ title: "Failed to send message", body: err.message, tone: "error" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      roomsApi.addMember(companyId, roomId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(companyId, roomId!) });
      setAddMemberOpen(false);
      setSelectedAgentId("");
      pushToast({ title: "Member added" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to add member", body: err.message, tone: "error" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      roomsApi.removeMember(companyId, roomId!, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(companyId, roomId!) });
      pushToast({ title: "Member removed" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to remove member", body: err.message, tone: "error" });
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = messageInput.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }, [messageInput, sendMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  function handleAddMember() {
    if (memberType === "agent" && selectedAgentId) {
      addMemberMutation.mutate({ agentId: selectedAgentId });
    }
  }

  if (!companyId || !roomId) {
    return <EmptyState icon={MessageSquare} message="Room not found." />;
  }

  if (roomLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (!room) {
    return <EmptyState icon={MessageSquare} message="Room not found." />;
  }

  const members = room.members ?? [];
  const messages = messagesData?.messages ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{room.name}</h1>
        <Badge variant={room.status === "active" ? "default" : "secondary"} className="text-xs">
          {room.status}
        </Badge>
        {room.description && (
          <span className="text-xs text-muted-foreground truncate">{room.description}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide members" : "Show members"}
          >
            {sidebarOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <PanelRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Body: messages + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
            <div className="space-y-0.5 py-4">
              {messagesLoading && messages.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">Loading messages...</p>
              )}
              {!messagesLoading && messages.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">
                  No messages yet. Start the conversation.
                </p>
              )}
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} members={members} agentMap={agentMap} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Type a message..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sendMutation.isPending}
                className="flex-1"
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!messageInput.trim() || sendMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Member sidebar — collapsible */}
        {sidebarOpen && (
          <MemberSidebar
            members={members}
            agentMap={agentMap}
            onRemove={(memberId) => removeMemberMutation.mutate(memberId)}
            onAddClick={() => setAddMemberOpen(true)}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </div>

      {/* Add member dialog */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Agent</Label>
              <Select
                value={selectedAgentId}
                onValueChange={setSelectedAgentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((agent: { id: string; name: string }) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddMemberOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={!selectedAgentId || addMemberMutation.isPending}
            >
              {addMemberMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

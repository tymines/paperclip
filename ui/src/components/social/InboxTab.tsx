/**
 * InboxTab — unified DM inbox across every connected platform.
 *
 * Layout: platform tabs at top, thread list on the left, message stream
 * on the right. Modeled after Hootsuite Inbox / Sprout Smart Inbox.
 *
 * Platform constraints:
 *   - IG / FB DMs only allow outbound replies inside a 24-hour window
 *     after the last user-initiated message. The thread's canReply flag
 *     comes from the adapter; when false we render a disabled reply box
 *     with the reason chip.
 *   - X DM API requires Tier 1 ($200/mo) — UI shows the same surface,
 *     just stubs return nothing until Tyler upgrades.
 *   - Threads has no DM API (mid-2026); the inbox tab will be empty
 *     until Meta ships it.
 *   - LinkedIn DMs blocked by partner-program gating; TikTok has no DM
 *     API at all. Neither shows up here.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Loader2, Send } from "lucide-react";
import type { SocialAccountPublic } from "@paperclipai/shared";
import { socialApi, type DirectMessageThread } from "../../api/social";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "../../lib/utils";
import { KeyedOffNotice } from "./data-honesty";
import { PLATFORM_META } from "./platform-meta";

interface InboxTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

export function InboxTab({ companyId, accounts }: InboxTabProps) {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ["social", "inbox", companyId, activeAccountId ?? "all"],
    queryFn: () => socialApi.inbox(companyId, activeAccountId ?? undefined),
    enabled: !!companyId,
  });

  // Availability is per-account: X can be available while IG in the same
  // response is keyed off. Available entries feed the thread list; keyed-off
  // entries render a compact honesty notice each.
  const inboxEntries = inboxQuery.data;

  const flatThreads = useMemo(() => {
    const out: Array<{ account: SocialAccountPublic; thread: DirectMessageThread }> = [];
    for (const entry of inboxEntries ?? []) {
      if (!entry.available) continue;
      const account = accounts.find((a) => a.id === entry.accountId);
      if (!account) continue;
      for (const thread of entry.data) out.push({ account, thread });
    }
    return out.sort(
      (a, b) => new Date(b.thread.lastMessageAt).getTime() - new Date(a.thread.lastMessageAt).getTime(),
    );
  }, [inboxEntries, accounts]);

  const keyedOffEntries = useMemo(
    () => (inboxEntries ?? []).flatMap((entry) => (entry.available ? [] : [entry])),
    [inboxEntries],
  );

  const activeThread = activeThreadId
    ? flatThreads.find((t) => t.thread.threadId === activeThreadId)
    : flatThreads[0];

  const streamQuery = useQuery({
    queryKey: ["social", "inbox-stream", companyId, activeThread?.account.id, activeThread?.thread.threadId],
    queryFn: () =>
      socialApi.inboxThread(
        companyId,
        activeThread!.account.id,
        activeThread!.thread.threadId,
      ),
    enabled: !!activeThread,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      socialApi.inboxSend(
        companyId,
        activeThread!.account.id,
        activeThread!.thread.threadId,
        draft.trim(),
      ),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({
        queryKey: ["social", "inbox-stream", companyId, activeThread?.account.id, activeThread?.thread.threadId],
      });
    },
  });

  if (accounts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Connect an account to see DMs here — X DMs unlock with an X account connected with the
        dm.read scope (paid X API tier).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Account filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={activeAccountId === null}
          onClick={() => {
            setActiveAccountId(null);
            setActiveThreadId(null);
          }}
        >
          All
        </FilterChip>
        {accounts
          .filter((a) => a.status === "connected")
          .map((account) => {
            const meta = PLATFORM_META[account.platform];
            const Icon = meta.icon;
            return (
              <FilterChip
                key={account.id}
                active={activeAccountId === account.id}
                onClick={() => {
                  setActiveAccountId(account.id);
                  setActiveThreadId(null);
                }}
                color={activeAccountId === account.id ? meta.color : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {account.displayName}
              </FilterChip>
            );
          })}
      </div>

      {/* Per-account keyed-off notices — one compact card per account whose
          platform has no DM wiring yet. Available accounts still contribute
          their threads to the list below. */}
      {keyedOffEntries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {keyedOffEntries.map((entry) => {
            const account = accounts.find((a) => a.id === entry.accountId);
            const label = PLATFORM_META[entry.platform].label;
            return (
              <KeyedOffNotice
                key={entry.accountId}
                compact
                featurePitch={`DMs for ${account?.displayName ?? label} (${label}) will appear here once this platform's messaging API is unlocked. No mock threads are ever shown.`}
                state={entry}
              />
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Thread list */}
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-card">
          {inboxQuery.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : flatThreads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <InboxIcon className="h-5 w-5" />
              <span>
                No conversations yet. X DMs appear here once an X account is connected with the
                dm.read scope.
              </span>
            </div>
          ) : (
            flatThreads.map(({ account, thread }) => {
              const meta = PLATFORM_META[account.platform];
              const active = activeThread?.thread.threadId === thread.threadId;
              return (
                <button
                  key={`${account.id}-${thread.threadId}`}
                  type="button"
                  onClick={() => {
                    setActiveAccountId(account.id);
                    setActiveThreadId(thread.threadId);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border/60 p-3 text-left transition-colors hover:bg-accent/30",
                    active && "bg-accent/50",
                  )}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {(thread.participantHandle ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{thread.participantHandle}</span>
                      {thread.unreadCount > 0 ? (
                        <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500">
                          {thread.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{thread.lastMessagePreview}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {meta.label} · {relativeFromNow(thread.lastMessageAt)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Message stream */}
        <div className="flex max-h-[60vh] flex-col rounded-md border border-border bg-card">
          {!activeThread ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
              Pick a conversation.
            </div>
          ) : (
            <>
              <div className="border-b border-border px-4 py-2.5 text-sm">
                <span className="font-semibold">{activeThread.thread.participantHandle}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {PLATFORM_META[activeThread.account.platform].label}
                </span>
              </div>
              {streamQuery.data && !streamQuery.data.available ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <KeyedOffNotice
                    compact
                    featurePitch="Messages for this conversation will load here once this platform's DM read API is unlocked."
                    state={streamQuery.data}
                  />
                </div>
              ) : (
              <div className="flex flex-1 flex-col-reverse gap-2 overflow-y-auto p-4">
                {(streamQuery.data?.available ? streamQuery.data.data : [])
                  .slice()
                  .reverse()
                  .map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3 py-2 text-sm",
                        message.direction === "outbound"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "mr-auto bg-accent/60 text-foreground",
                      )}
                    >
                      {message.text}
                    </div>
                  ))}
              </div>
              )}
              <div className="border-t border-border p-3">
                {activeThread.thread.canReply ? (
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type a reply…"
                      className="min-h-[44px] resize-none"
                    />
                    <Button
                      onClick={() => draft.trim() && sendMutation.mutate()}
                      disabled={!draft.trim() || sendMutation.isPending}
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Outside the 24-hour reply window — Meta only lets us send "approved messaging tags"
                    (HUMAN_AGENT / ACCOUNT_UPDATE / CONFIRMED_EVENT_UPDATE) here. UI for that lands in v1.1.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent text-white"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
      style={active && color ? { backgroundColor: color } : active ? { backgroundColor: "var(--foreground)", color: "var(--background)" } : undefined}
    >
      {children}
    </button>
  );
}

function relativeFromNow(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Accounts tab — Buffer-style "connected accounts" list.
 *
 * Per account: avatar, handle, platform pill, connected-at timestamp,
 * Disconnect button. Plus a row of "Connect …" buttons, one per platform
 * the server has an adapter wired for (Tyler's IG/X/FB/Threads/Reddit
 * in v1; LinkedIn/TikTok later).
 *
 * In stub mode (no real OAuth credentials yet), the Connect button hits
 * /oauth/finish directly with placeholder code/state — the server returns
 * a stub account row. Real OAuth flow will redirect to the platform and
 * come back via /oauth/callback later.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Plus, X } from "lucide-react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";
import { socialApi } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { useToastActions } from "../../context/ToastContext";
import { Button } from "@/components/ui/button";
import { PLATFORM_META, TYLER_PRIORITY_PLATFORMS } from "./platform-meta";
import { cn } from "../../lib/utils";

interface AccountsTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
  loading: boolean;
}

export function AccountsTab({ companyId, accounts, loading }: AccountsTabProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const platformsQuery = useQuery({
    queryKey: queryKeys.social.platforms,
    queryFn: () => socialApi.platforms(),
  });

  const supportedPlatforms: SocialPlatform[] =
    platformsQuery.data?.supported ?? TYLER_PRIORITY_PLATFORMS;

  const connectMutation = useMutation({
    mutationFn: async (platform: SocialPlatform) => {
      // Stub: start + finish in one shot. Real flow will redirect to the
      // platform between start and finish.
      const { state } = await socialApi.oauthStart(companyId, platform);
      return socialApi.oauthFinish(companyId, platform, "stub_code", state);
    },
    onSuccess: (account) => {
      pushToast({ title: `Connected ${PLATFORM_META[account.platform].label}`, tone: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.social.accounts(companyId) });
    },
    onError: (err) => {
      pushToast({
        title: "Couldn't connect account",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) => socialApi.deleteAccount(companyId, accountId),
    onSuccess: (account) => {
      pushToast({ title: `Disconnected ${account?.displayName ?? "account"}`, tone: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.social.accounts(companyId) });
    },
    onError: (err) => {
      pushToast({
        title: "Couldn't disconnect",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Connected accounts
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <div className="col-span-full rounded-md border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
              No accounts connected yet — pick a platform below to add one.
            </div>
          ) : (
            accounts.map((account) => {
              const meta = PLATFORM_META[account.platform];
              const Icon = meta.icon;
              return (
                <div
                  key={account.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{account.displayName}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          account.status === "connected"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {account.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>{meta.label}</span>
                      {account.username ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{account.username}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Connected {formatTimestamp(account.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => disconnectMutation.mutate(account.id)}
                    disabled={disconnectMutation.isPending}
                    aria-label={`Disconnect ${account.displayName}`}
                    title="Disconnect"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Add an account
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {TYLER_PRIORITY_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const Icon = meta.icon;
            const supported = supportedPlatforms.includes(platform);
            return (
              <Button
                key={platform}
                variant="outline"
                size="sm"
                onClick={() => connectMutation.mutate(platform)}
                disabled={!supported || connectMutation.isPending}
                title={!supported ? "Adapter not wired yet" : `Connect ${meta.label}`}
                style={!supported ? undefined : { borderColor: `${meta.color}66` }}
              >
                <Plus className="h-3.5 w-3.5" />
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                Connect {meta.label}
              </Button>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          Connect-flows are stubbed today: clicking creates a placeholder account.
          Real OAuth wiring needs Tyler's Meta App / X Developer / Reddit app
          credentials.
        </p>
      </section>
    </div>
  );
}

function formatTimestamp(value: string | Date | null): string {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

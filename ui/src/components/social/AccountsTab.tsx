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
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, ExternalLink, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";
import { socialApi, type FeatureStatus } from "../../api/social";
import { queryKeys } from "../../lib/queryKeys";
import { useToastActions } from "../../context/ToastContext";
import { Button } from "@/components/ui/button";
import { PLATFORM_META, TYLER_PRIORITY_PLATFORMS } from "./platform-meta";
import { cn } from "../../lib/utils";
import { SocialConnectWizard } from "./wizard/SocialConnectWizard";

/** Status-chip color + label per feasibility status. */
const STATUS_TONE: Record<FeatureStatus, { bg: string; fg: string; label: string; symbol: string }> = {
  ok:      { bg: "bg-emerald-500/15", fg: "text-emerald-300", label: "Works", symbol: "✓" },
  review:  { bg: "bg-amber-500/15", fg: "text-amber-300", label: "App Review", symbol: "⚠️" },
  paid:    { bg: "bg-amber-500/15", fg: "text-amber-300", label: "Paid tier", symbol: "💰" },
  self:    { bg: "bg-sky-500/15", fg: "text-sky-300", label: "Self-managed", symbol: "🚧" },
  blocked: { bg: "bg-rose-500/15", fg: "text-rose-300", label: "Gated", symbol: "🔒" },
  missing: { bg: "bg-zinc-500/15", fg: "text-zinc-400", label: "No API", symbol: "—" },
  banned:  { bg: "bg-rose-500/20", fg: "text-rose-300", label: "Banned", symbol: "❌" },
};

interface AccountsTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
  loading: boolean;
}

export function AccountsTab({ companyId, accounts, loading }: AccountsTabProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [wizardPlatform, setWizardPlatform] = useState<SocialPlatform | null>(null);

  const platformsQuery = useQuery({
    queryKey: queryKeys.social.platforms,
    queryFn: () => socialApi.platforms(),
  });

  const supportedPlatforms: SocialPlatform[] =
    platformsQuery.data?.supported ?? TYLER_PRIORITY_PLATFORMS;

  const feasibilityQuery = useQuery({
    queryKey: ["social", "feasibility"],
    queryFn: () => socialApi.feasibility(),
    staleTime: 5 * 60_000,
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
                onClick={() => setWizardPlatform(platform)}
                disabled={!supported}
                title={!supported ? "Adapter not wired yet" : `Connect new ${meta.label} account`}
                data-testid={`connect-new-account-${platform}`}
                style={!supported ? undefined : { borderColor: `${meta.color}66` }}
              >
                <Plus className="h-3.5 w-3.5" />
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                Connect new {meta.label}
              </Button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Click any platform to launch the guided OAuth wizard — register the app,
          paste credentials, connect the account, all in one flow.
        </p>
      </section>

      {wizardPlatform ? (
        <SocialConnectWizard
          open={wizardPlatform !== null}
          onOpenChange={(open) => {
            if (!open) setWizardPlatform(null);
          }}
          companyId={companyId}
          platform={wizardPlatform}
        />
      ) : null}

      {/* Feasibility matrix — per Hermes's social-platform-apis.md research.
          Shows Tyler what each platform actually supports today so he knows
          which features will light up when OAuth is wired vs which are
          permanently gated. */}
      {feasibilityQuery.data ? (
        <>
          <section>
            <header className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Platform feasibility
              </h2>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">
              What each platform supports today via its API. ✓ Works · ⚠️ App Review / Paid ·
              🚧 Self-managed by Paperclip · 🔒 Gated · — No API · ❌ Banned.
            </p>
            <div className="mt-3 overflow-x-auto rounded-md border border-border bg-card">
              <table className="min-w-[640px] w-full text-xs">
                <thead className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Feature</th>
                    {TYLER_PRIORITY_PLATFORMS.map((p) => (
                      <th key={p} className="px-3 py-2 text-left font-medium">
                        {PLATFORM_META[p].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {feasibilityQuery.data.matrix.map((row, i) => (
                    <tr
                      key={row.feature}
                      className={cn(i % 2 === 0 ? "bg-transparent" : "bg-muted/20")}
                    >
                      <td className="px-3 py-2 font-medium">{row.feature}</td>
                      {TYLER_PRIORITY_PLATFORMS.map((p) => {
                        const cell = row.byPlatform[p];
                        if (!cell) {
                          return (
                            <td key={p} className="px-3 py-2 text-muted-foreground">
                              —
                            </td>
                          );
                        }
                        const tone = STATUS_TONE[cell.status];
                        return (
                          <td key={p} className="px-3 py-2">
                            <div
                              className={cn(
                                "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5",
                                tone.bg,
                                tone.fg,
                              )}
                              title={cell.note ?? tone.label}
                            >
                              <span aria-hidden>{tone.symbol}</span>
                              <span className="truncate">{tone.label}</span>
                            </div>
                            {cell.note ? (
                              <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                                {cell.note}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Tyler's Homework — the app-registration + OAuth setup steps
              Paperclip can't do for him. */}
          <section>
            <header className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Tyler's Homework
              </h2>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">
              App registrations + OAuth setup Paperclip can't do for you. Each is required
              before the corresponding platform lights up beyond stub data.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {feasibilityQuery.data.homework.map((item) => (
                <li
                  key={item.title}
                  className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      item.importance === "blocker"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-sky-500/15 text-sky-300",
                    )}
                  >
                    {item.importance}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  >
                    Open
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* Hard never-ship list — surfaces directly so Tyler (and any
              future operator) sees the line. Implementing any of these is
              an instant-ban risk and is explicitly forbidden in the
              adapter contract. */}
          <section>
            <header className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Banned features — never ship
              </h2>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">
              These exist as growth shortcuts on every "scheduling-tool"
              landing page. Don't build any of them — every named platform
              treats them as instant-ban grounds. From Hermes's research,
              verified against current Meta / X / Reddit ToS.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {feasibilityQuery.data.banned.map((item) => (
                <li
                  key={item.title}
                  className="flex items-start gap-3 rounded-md border border-rose-500/20 bg-rose-500/5 p-3"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <div className="min-w-0">
                    <div className="font-medium text-rose-200">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
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

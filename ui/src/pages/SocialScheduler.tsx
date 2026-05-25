/**
 * SocialScheduler — multi-platform social-media scheduling tool.
 *
 * Replaces the previous in-app /social broadcast feed. Modeled after Buffer /
 * Later / Hootsuite — five surfaces stitched together by an internal tab bar:
 *
 *   - Compose:   multi-platform editor with per-platform previews
 *   - Calendar:  month + list views of scheduled posts (color-coded by platform)
 *   - Grid:      Instagram-only 3-col preview of feed-after-scheduled-posts-publish
 *   - Queue:     Buffer-style chronological queue per account
 *   - Accounts:  connected social accounts with Connect / Disconnect actions
 *
 * Everything runs against the existing /api/companies/:id/social/* endpoints +
 * the new scheduler endpoints (validate / feed / queue / oauth). When the user
 * has no accounts connected, every tab degrades to a "connect an account to
 * start" empty state instead of breaking.
 *
 * NOT gated by enableUiV2 — Tyler asked for this as a product change, not a
 * v2 visual reskin.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@/lib/router";
import {
  BarChart3,
  CalendarDays,
  Grid3X3,
  Hash,
  Inbox,
  Link2,
  Mail,
  PenSquare,
  Share2,
  UploadCloud,
  Users,
} from "lucide-react";
import { socialApi } from "../api/social";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import { AccountsTab } from "../components/social/AccountsTab";
import { ComposeTab } from "../components/social/ComposeTab";
import { CalendarTab } from "../components/social/CalendarTab";
import { QueueTab } from "../components/social/QueueTab";
import { InstagramGridTab } from "../components/social/InstagramGridTab";
import { InboxTab } from "../components/social/InboxTab";
import { AnalyticsTab } from "../components/social/AnalyticsTab";
import { CompetitorsTab } from "../components/social/CompetitorsTab";
import { HashtagLabTab } from "../components/social/HashtagLabTab";
import { BulkUploadTab } from "../components/social/BulkUploadTab";

type SchedulerTab =
  | "compose"
  | "calendar"
  | "grid"
  | "queue"
  | "accounts"
  | "inbox"
  | "analytics"
  | "competitors"
  | "hashtags"
  | "bulk-upload";

const TABS: { key: SchedulerTab; label: string; icon: typeof PenSquare }[] = [
  { key: "compose", label: "Compose", icon: PenSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "grid", label: "IG Grid", icon: Grid3X3 },
  { key: "queue", label: "Queue", icon: Inbox },
  { key: "bulk-upload", label: "Bulk Upload", icon: UploadCloud },
  { key: "inbox", label: "Inbox", icon: Mail },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "competitors", label: "Competitors", icon: Users },
  { key: "hashtags", label: "Hashtag Lab", icon: Hash },
  { key: "accounts", label: "Accounts", icon: Link2 },
];

export function SocialScheduler() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [tab, setTab] = useState<SchedulerTab>("compose");

  useEffect(() => {
    setBreadcrumbs([{ label: "Social" }]);
  }, [setBreadcrumbs]);

  // Demo mode (?demo=true) opts back into server-returned stub data so
  // developers can still preview the full UI with seed accounts.
  const demoMode = useMemo(
    () => new URLSearchParams(location.search).get("demo") === "true",
    [location.search],
  );

  const accountsQuery = useQuery({
    queryKey: queryKeys.social.accounts(selectedCompanyId ?? "__none__"),
    queryFn: () => socialApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Share2} message="Select a company to use the scheduler." />;
  }

  // Hide accounts the stub OAuth flow has persisted (metadata.stub === true)
  // unless the page is loaded in demo mode. Otherwise Tyler sees fake handles
  // (@stub_x_handle, etc.) he never registered and the UI implies they are
  // real connected accounts.
  const allAccounts = accountsQuery.data ?? [];
  const accounts = demoMode
    ? allAccounts
    : allAccounts.filter((a) => !(a.metadata && (a.metadata as Record<string, unknown>).stub === true));
  const stubHidden = allAccounts.length - accounts.length;
  const hasNoAccounts = !accountsQuery.isLoading && accounts.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social</h1>
          <p className="text-sm text-muted-foreground">
            Schedule posts across {selectedCompany?.name ?? "your"} connected accounts.
          </p>
        </div>
      </header>

      <nav
        aria-label="Social scheduler sections"
        className="flex flex-wrap items-center gap-1 border-b border-border pb-1"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {hasNoAccounts && tab !== "accounts" ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-medium">Let's connect your first account.</p>
          <p className="mt-1 leading-5">
            Connect Instagram, X, Facebook, Threads, or Reddit to start composing and scheduling posts.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setTab("accounts")}>
            Open the Accounts tab
          </Button>
        </div>
      ) : null}

      {demoMode ? (
        <div className="rounded-md border border-sky-400/60 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
          Demo mode is on — showing seeded stub accounts. Remove <code>?demo=true</code> from the URL to hide them.
        </div>
      ) : stubHidden > 0 ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {stubHidden} stub account{stubHidden === 1 ? "" : "s"} hidden. Append <code>?demo=true</code> to the URL to preview them.
        </div>
      ) : null}

      <section className="min-h-0">
        {tab === "compose" ? <ComposeTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "calendar" ? <CalendarTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "grid" ? <InstagramGridTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "queue" ? <QueueTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "bulk-upload" ? <BulkUploadTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "inbox" ? <InboxTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "analytics" ? <AnalyticsTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "competitors" ? <CompetitorsTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "hashtags" ? <HashtagLabTab companyId={selectedCompanyId} accounts={accounts} /> : null}
        {tab === "accounts" ? <AccountsTab companyId={selectedCompanyId} accounts={accounts} loading={accountsQuery.isLoading} /> : null}
      </section>
    </div>
  );
}

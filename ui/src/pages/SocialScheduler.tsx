/**
 * SocialScheduler — multi-platform social-media management studio.
 *
 * Six surfaces stitched together by an internal tab bar (spec §4):
 *
 *   - Compose:   multi-platform editor + AI captions, with a collapsible
 *                "Hashtags & AI" lab underneath
 *   - Calendar:  month/list calendar, with sub-views for the Buffer-style
 *                Queue and the Instagram Grid lens
 *   - Inbox:     real DM threads only — platforms without DM wiring show a
 *                keyed-off state, never mock threads
 *   - Analytics: own-account metrics where keyed, plus a Competitors sub-view
 *   - Library:   bulk upload → review → schedule content pipeline
 *   - Accounts:  connected accounts, connect wizard, feasibility + homework
 *
 * Everything runs against the existing /api/companies/:id/social/* endpoints.
 * With zero accounts connected every surface degrades to a connect-first
 * empty state instead of breaking. Stub accounts (metadata.stub === true) are
 * never rendered — there is no demo mode (spec §7: no mock data as real).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  FolderOpen,
  Grid3X3,
  Hash,
  Inbox,
  Link2,
  Mail,
  PenSquare,
  Share2,
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

type SchedulerSurface =
  | "compose"
  | "calendar"
  | "inbox"
  | "analytics"
  | "library"
  | "accounts";

const SURFACES: { key: SchedulerSurface; label: string; icon: typeof PenSquare }[] = [
  { key: "compose", label: "Compose", icon: PenSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "inbox", label: "Inbox", icon: Mail },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "library", label: "Library", icon: FolderOpen },
  { key: "accounts", label: "Accounts", icon: Link2 },
];

type CalendarView = "calendar" | "queue" | "grid";
type AnalyticsView = "analytics" | "competitors";

export function SocialScheduler() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<SchedulerSurface>("compose");
  const [calendarView, setCalendarView] = useState<CalendarView>("calendar");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("analytics");
  const [hashtagLabOpen, setHashtagLabOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Social" }]);
  }, [setBreadcrumbs]);

  const accountsQuery = useQuery({
    queryKey: queryKeys.social.accounts(selectedCompanyId ?? "__none__"),
    queryFn: () => socialApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Share2} message="Select a company to use the scheduler." />;
  }

  // Data honesty (spec §7): stub accounts persisted by the old stub OAuth
  // flow (metadata.stub === true) are never shown. No demo mode — Tyler only
  // ever sees accounts he actually connected through the wizard.
  const accounts = (accountsQuery.data ?? []).filter(
    (a) => !(a.metadata && (a.metadata as Record<string, unknown>).stub === true),
  );
  const hasNoAccounts = !accountsQuery.isLoading && accounts.length === 0;

  return (
    <div
      className="flex flex-col gap-5 bg-gradient-to-b from-background via-background to-primary/[0.03]"
      data-pp-page-v2="social"
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Social</h1>
          <p className="text-sm text-muted-foreground">
            Schedule posts across {selectedCompany?.name ?? "your"} connected accounts.
          </p>
        </div>
      </header>

      <nav
        aria-label="Social scheduler sections"
        className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/60 bg-card/40 p-1.5 shadow-sm"
      >
        {SURFACES.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex min-h-[36px] items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border border-primary/40 bg-primary/10 text-foreground"
                  : "border border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={cn("h-4 w-4", active && "text-primary")} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {hasNoAccounts && tab !== "accounts" ? (
        <div className="rounded-2xl border border-[#F4B940]/30 bg-[#F4B940]/[0.08] px-4 py-3 text-sm text-foreground">
          <p className="font-semibold text-[#F4B940]">Let's connect your first account.</p>
          <p className="mt-1 leading-5 text-muted-foreground">
            Connect Instagram, X, Facebook, Threads, or Reddit to start composing and scheduling posts.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setTab("accounts")}>
            Open the Accounts tab
          </Button>
        </div>
      ) : null}

      <section className="min-h-0">
        {tab === "compose" ? (
          <div className="flex flex-col gap-4">
            <ComposeTab companyId={selectedCompanyId} accounts={accounts} />
            <div className="rounded-2xl border border-border/60 bg-card/40">
              <button
                type="button"
                onClick={() => setHashtagLabOpen((open) => !open)}
                aria-expanded={hashtagLabOpen}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Hash className={cn("h-4 w-4", hashtagLabOpen && "text-primary")} />
                Hashtags &amp; AI
                <span className="ml-auto text-xs text-muted-foreground">
                  {hashtagLabOpen ? "Hide" : "Show"}
                </span>
              </button>
              {hashtagLabOpen ? (
                <div className="border-t border-border/60 p-4">
                  <HashtagLabTab companyId={selectedCompanyId} accounts={accounts} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "calendar" ? (
          <div className="flex flex-col gap-3">
            <SubSwitcher
              options={[
                { key: "calendar", label: "Calendar", icon: CalendarDays },
                { key: "queue", label: "Queue", icon: Inbox },
                { key: "grid", label: "IG Grid", icon: Grid3X3 },
              ]}
              value={calendarView}
              onChange={setCalendarView}
              ariaLabel="Calendar views"
            />
            {calendarView === "calendar" ? (
              <CalendarTab companyId={selectedCompanyId} accounts={accounts} />
            ) : null}
            {calendarView === "queue" ? (
              <QueueTab companyId={selectedCompanyId} accounts={accounts} />
            ) : null}
            {calendarView === "grid" ? (
              <InstagramGridTab companyId={selectedCompanyId} accounts={accounts} />
            ) : null}
          </div>
        ) : null}

        {tab === "inbox" ? <InboxTab companyId={selectedCompanyId} accounts={accounts} /> : null}

        {tab === "analytics" ? (
          <div className="flex flex-col gap-3">
            <SubSwitcher
              options={[
                { key: "analytics", label: "Analytics", icon: BarChart3 },
                { key: "competitors", label: "Competitors", icon: Users },
              ]}
              value={analyticsView}
              onChange={setAnalyticsView}
              ariaLabel="Analytics views"
            />
            {analyticsView === "analytics" ? (
              <AnalyticsTab companyId={selectedCompanyId} accounts={accounts} />
            ) : (
              <CompetitorsTab companyId={selectedCompanyId} accounts={accounts} />
            )}
          </div>
        ) : null}

        {tab === "library" ? (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Library</h2>
              <p className="text-sm text-muted-foreground">
                Upload a pile of content, review captions and targets, and let the scheduler spread
                it across your queue.
              </p>
            </div>
            <BulkUploadTab companyId={selectedCompanyId} accounts={accounts} />
          </div>
        ) : null}

        {tab === "accounts" ? (
          <AccountsTab
            companyId={selectedCompanyId}
            accounts={accounts}
            loading={accountsQuery.isLoading}
          />
        ) : null}
      </section>
    </div>
  );
}

function SubSwitcher<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: K; label: string; icon: typeof PenSquare }[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex w-fit flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-card/40 p-1"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border border-primary/40 bg-primary/10 text-foreground"
                : "border border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

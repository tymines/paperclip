import {
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Share2,
  Boxes,
  Repeat,
  GitBranch,
  Settings,
  MessageSquare,
  Megaphone,
  Home as HomeIcon,
  Hexagon,
  Bot,
  Layers,
  MoreHorizontal,
  Plus,
  ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import type { Company } from "@paperclipai/shared";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { SidebarCompanyMenu } from "./SidebarCompanyMenu";

export function Sidebar() {
  const { openNewIssue } = useDialogActions();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;
  const showWorkspacesLink = experimentalSettings?.enableIsolatedWorkspaces === true;
  const uiV1 = experimentalSettings?.enableUiV1 === true;
  const uiV2 = experimentalSettings?.enableUiV2 === true;

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  // v2 sidebar (pass 1) renders a self-contained shell with its own top
  // workspace switcher and bottom account chip — it doesn't share the
  // legacy company-menu + search header above.
  if (uiV2) {
    return (
      <SidebarV2
        openNewIssue={openNewIssue}
        inboxBadge={inboxBadge}
        liveRunCount={liveRunCount}
        showWorkspacesLink={showWorkspacesLink}
        pluginContext={pluginContext}
        company={selectedCompany}
      />
    );
  }

  return (
    <aside className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: Company name (bold) + Search — aligned with top sections (no visible border) */}
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        <SidebarCompanyMenu />
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground shrink-0"
          aria-label="Open search"
          title="Open search"
        >
          <NavLink to="/search">
            <Search className="h-4 w-4" />
          </NavLink>
        </Button>
      </div>

      {uiV1 ? (
        <SidebarV1
          openNewIssue={openNewIssue}
          inboxBadge={inboxBadge}
          liveRunCount={liveRunCount}
          showWorkspacesLink={showWorkspacesLink}
          pluginContext={pluginContext}
        />
      ) : (
        <SidebarLegacy
          openNewIssue={openNewIssue}
          inboxBadge={inboxBadge}
          liveRunCount={liveRunCount}
          showWorkspacesLink={showWorkspacesLink}
          pluginContext={pluginContext}
        />
      )}
    </aside>
  );
}

interface SidebarSharedProps {
  openNewIssue: () => void;
  inboxBadge: ReturnType<typeof useInboxBadge>;
  liveRunCount: number;
  showWorkspacesLink: boolean;
  pluginContext: { companyId: string | null; companyPrefix: string | null };
}

function SidebarLegacy({
  openNewIssue,
  inboxBadge,
  liveRunCount,
  showWorkspacesLink,
  pluginContext,
}: SidebarSharedProps) {
  return (
    <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={openNewIssue}
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          <span className="truncate">New Issue</span>
        </button>
        <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
        <SidebarNavItem
          to="/inbox"
          label="Inbox"
          icon={Inbox}
          badge={inboxBadge.inbox}
          badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
          alert={inboxBadge.failedRuns > 0}
        />
        <PluginSlotOutlet
          slotTypes={["sidebar"]}
          context={pluginContext}
          className="flex flex-col gap-0.5"
          itemClassName="text-[13px] font-medium"
          missingBehavior="placeholder"
        />
      </div>

      <SidebarSection label="Work">
        <SidebarNavItem to="/issues" label="Issues" icon={CircleDot} />
        <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
        <PluginLauncherOutlet
          placementZones={["sidebar"]}
          context={pluginContext}
          className="flex flex-col gap-0.5"
          itemClassName="text-[13px] font-medium"
        />
        <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        {showWorkspacesLink ? (
          <SidebarNavItem to="/workspaces" label="Workspaces" icon={GitBranch} />
        ) : null}
      </SidebarSection>

      <SidebarProjects />

      <SidebarAgents />

      <SidebarSection label="Collaboration">
        <SidebarNavItem to="/rooms" label="Rooms" icon={MessageSquare} />
        <SidebarNavItem to="/social" label="Social" icon={Megaphone} />
      </SidebarSection>

      <SidebarSection label="Company">
        <SidebarNavItem to="/knowledge-graph" label="Knowledge Graph" icon={Share2} />
        <SidebarNavItem to="/org" label="Org" icon={Network} />
        <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
        <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
        <SidebarNavItem to="/activity" label="Activity" icon={History} />
        <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
      </SidebarSection>

      <PluginSlotOutlet
        slotTypes={["sidebarPanel"]}
        context={pluginContext}
        className="flex flex-col gap-3"
        itemClassName="rounded-lg border border-border p-3"
        missingBehavior="placeholder"
      />
    </nav>
  );
}

/**
 * v1.1 Sidebar — trimmed to the 5 items the UX agents converged on:
 * Home, Inbox, Agents, Routines, Settings. Everything else (Issues,
 * Projects, Work, Goals, Rooms, Social, etc.) lives behind a "More"
 * disclosure or is reachable via ⌘K. The 5 are picked for what an
 * operator-CEO checks daily, not for catalog completeness.
 */
function SidebarV1({
  openNewIssue,
  inboxBadge,
  liveRunCount,
  showWorkspacesLink,
  pluginContext,
}: SidebarSharedProps) {
  return (
    <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={openNewIssue}
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          <span className="truncate">New Issue</span>
        </button>
        <SidebarNavItem to="/home" label="Home" icon={HomeIcon} liveCount={liveRunCount} />
        <SidebarNavItem
          to="/inbox"
          label="Action Queue"
          icon={Inbox}
          badge={inboxBadge.inbox}
          badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
          alert={inboxBadge.failedRuns > 0}
        />
        <SidebarNavItem to="/agents" label="Fleet" icon={Bot} />
        <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
        <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
        <PluginSlotOutlet
          slotTypes={["sidebar"]}
          context={pluginContext}
          className="flex flex-col gap-0.5"
          itemClassName="text-[13px] font-medium"
          missingBehavior="placeholder"
        />
      </div>

      <SidebarSection label="More">
        <SidebarNavItem to="/issues" label="Issues" icon={CircleDot} />
        <SidebarNavItem to="/projects" label="Projects" icon={Hexagon} />
        <SidebarNavItem to="/work" label="Work" icon={Layers} />
        <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        <SidebarNavItem to="/rooms" label="Rooms" icon={MessageSquare} />
        <SidebarNavItem to="/social" label="Social" icon={Megaphone} />
        <SidebarNavItem to="/approvals" label="Approvals" icon={MoreHorizontal} />
        <SidebarNavItem to="/knowledge-graph" label="Knowledge Graph" icon={Share2} />
        <SidebarNavItem to="/org" label="Org" icon={Network} />
        <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
        <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
        <SidebarNavItem to="/activity" label="Activity" icon={History} />
        {showWorkspacesLink ? (
          <SidebarNavItem to="/workspaces" label="Workspaces" icon={GitBranch} />
        ) : null}
      </SidebarSection>

      <PluginSlotOutlet
        slotTypes={["sidebarPanel"]}
        context={pluginContext}
        className="flex flex-col gap-3"
        itemClassName="rounded-lg border border-border p-3"
        missingBehavior="placeholder"
      />
    </nav>
  );
}

interface SidebarV2Props extends SidebarSharedProps {
  company: Company | null;
}

function initials(text: string | null | undefined, fallback = "??"): string {
  if (!text) return fallback;
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * v2 Sidebar (pass 1) — ChatGPT-shell skin from home-v2-chatgpt-shell.html.
 * Same 18-item structure as SidebarV1; just a different visual chrome:
 * workspace switcher chip on top, white-pill New Issue, MORE caps label,
 * and a bottom account chip. The v2 CSS lives in index.css gated by
 * :root[data-ui-v2="true"]; this component only stamps the right data
 * attributes so those rules can attach.
 */
function SidebarV2({
  openNewIssue,
  inboxBadge,
  liveRunCount,
  showWorkspacesLink,
  pluginContext,
  company,
}: SidebarV2Props) {
  const workspaceLabel = company?.name ?? "Workspace";
  const workspaceAvatar = initials(company?.issuePrefix ?? company?.name, "??");
  const accountAvatar = initials(company?.issuePrefix ?? company?.name, "PC");
  return (
    <aside
      aria-label="App navigation"
      data-sidebar-v2="true"
      className="flex flex-col"
    >
      <div data-sidebar-v2-inner>
        <NavLink
          to="/search"
          data-sidebar-workspace="v2"
          aria-label="Open workspace switcher / search"
          title="Open search"
        >
          <span className="flex items-center gap-2 min-w-0 flex-1">
            <span data-sidebar-workspace-avatar="v2" aria-hidden="true">
              {workspaceAvatar}
            </span>
            <span data-sidebar-workspace-name>{workspaceLabel}</span>
          </span>
          <span data-sidebar-workspace-actions aria-hidden="true">
            <ChevronDown className="h-4 w-4" />
            <Search className="h-4 w-4" />
          </span>
        </NavLink>

        <nav data-sidebar-v2-nav-stack className="scrollbar-auto-hide">
          <button
            type="button"
            onClick={() => openNewIssue()}
            data-sidebar-new-issue="v2"
            data-sidebar-nav-item="true"
            className="flex items-center gap-2.5"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">New Issue</span>
          </button>
          <SidebarNavItem to="/home" label="Home" icon={HomeIcon} liveCount={liveRunCount} />
          <SidebarNavItem
            to="/inbox"
            label="Action Queue"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          <SidebarNavItem to="/agents" label="Fleet" icon={Bot} />
          <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
          <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />

          <div data-sidebar-section-label="v2">MORE</div>

          <SidebarNavItem to="/issues" label="Issues" icon={CircleDot} />
          <SidebarNavItem to="/projects" label="Projects" icon={Hexagon} />
          <SidebarNavItem to="/work" label="Work" icon={Layers} />
          <SidebarNavItem to="/goals" label="Goals" icon={Target} />
          <SidebarNavItem to="/rooms" label="Rooms" icon={MessageSquare} />
          <SidebarNavItem to="/social" label="Social" icon={Megaphone} />
          <SidebarNavItem to="/approvals" label="Approvals" icon={MoreHorizontal} />
          <SidebarNavItem to="/knowledge-graph" label="Knowledge Graph" icon={Share2} />
          <SidebarNavItem to="/org" label="Org" icon={Network} />
          <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
          <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
          <SidebarNavItem to="/activity" label="Activity" icon={History} />
          {showWorkspacesLink ? (
            <SidebarNavItem to="/workspaces" label="Workspaces" icon={GitBranch} />
          ) : null}

          <PluginSlotOutlet
            slotTypes={["sidebarPanel"]}
            context={pluginContext}
            className="flex flex-col gap-3 mt-2"
            itemClassName="rounded-lg border border-[color:var(--ui-v2-line)] bg-[rgba(255,255,255,0.035)] p-3"
            missingBehavior="placeholder"
          />
        </nav>

        <div data-sidebar-account-chip="v2">
          <div data-sidebar-account-avatar="v2" aria-hidden="true">
            {accountAvatar}
          </div>
          <div className="min-w-0 flex-1">
            <strong data-sidebar-account-name="v2">{company?.name ?? "Paperclip"}</strong>
            <span data-sidebar-account-sub="v2">{company?.issuePrefix ?? ""}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

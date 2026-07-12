import {
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Share2,
  Globe,
  Boxes,
  Library,
  Repeat,
  GitBranch,
  Settings,
  Megaphone,
  Home as HomeIcon,
  Hexagon,
  Bot,
  MoreHorizontal,
  Sparkles,
  Mic,
  Palette,
  ImageIcon,
  Drama,
  Paperclip,
  AppWindow,
  BookOpen,
  Dumbbell,
  Clapperboard,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { useIssueNoun } from "../hooks/useIssueNoun";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { socialApi } from "../api/social";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";

export function Sidebar() {
  const { openNewIssue } = useDialogActions();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const issueNoun = useIssueNoun();
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
  const { data: socialDmBadge } = useQuery({
    queryKey: queryKeys.social.dmsUnreadCount(selectedCompanyId!),
    queryFn: () => socialApi.dmUnreadCount(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });
  const socialUnread = socialDmBadge?.unread ?? 0;
  const showWorkspacesLink = experimentalSettings?.enableIsolatedWorkspaces === true;
  const uiV1 = experimentalSettings?.enableUiV1 === true;
  const uiV2 = experimentalSettings?.enableUiV2 === true;

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  return (
    <aside
      className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col"
      data-pp-sidebar-shell={uiV2 ? "true" : undefined}
    >
      {/* Top bar: Company name (bold) + Search — aligned with top sections (no visible border).
          Under UI v2, this row is restyled into the workspace switcher pill via CSS. */}
      <div
        className="flex items-center gap-1 px-3 h-12 shrink-0"
        data-pp-sidebar-top={uiV2 ? "true" : undefined}
      >
        {/* Paperclip wordmark — replaces the workspace/company switcher block
            ("Acme Corp / Pro plan") per the approved Home redesign. */}
        <NavLink
          to="/home"
          className="flex min-w-0 flex-1 items-center gap-2 px-1 no-underline"
          aria-label="Paperclip home"
          data-pp-sidebar-wordmark="true"
        >
          <Paperclip className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate text-sm font-bold uppercase tracking-wider text-foreground">
            Paperclip
          </span>
        </NavLink>
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
          socialUnread={socialUnread}
          showWorkspacesLink={showWorkspacesLink}
          pluginContext={pluginContext}
          issueNoun={issueNoun}
        />
      ) : (
        <SidebarLegacy
          openNewIssue={openNewIssue}
          inboxBadge={inboxBadge}
          liveRunCount={liveRunCount}
          socialUnread={socialUnread}
          showWorkspacesLink={showWorkspacesLink}
          pluginContext={pluginContext}
          issueNoun={issueNoun}
        />
      )}
    </aside>
  );
}

interface SidebarSharedProps {
  openNewIssue: () => void;
  inboxBadge: ReturnType<typeof useInboxBadge>;
  liveRunCount: number;
  socialUnread: number;
  showWorkspacesLink: boolean;
  pluginContext: { companyId: string | null; companyPrefix: string | null };
  issueNoun: ReturnType<typeof useIssueNoun>;
}

function SidebarLegacy({
  openNewIssue,
  inboxBadge,
  liveRunCount,
  socialUnread,
  showWorkspacesLink,
  pluginContext,
  issueNoun,
}: SidebarSharedProps) {
  return (
    <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => openNewIssue()}
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          data-pp-new-issue="true"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          <span className="truncate">New {issueNoun.capSingular}</span>
        </button>
        <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
        {/* Paperclip redesign: one unified Tasks surface. The former Inbox /
            Action Queue and Work pages are folded into /issues, so the
            attention badge now rides on the single Tasks entry. */}
        <SidebarNavItem
          to="/issues"
          label="Tasks"
          icon={CircleDot}
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
        <SidebarNavItem
          to="/social"
          label="Social"
          icon={Megaphone}
          badge={socialUnread > 0 ? socialUnread : undefined}
        />
      </SidebarSection>

      <SidebarSection label="Company">
        <SidebarNavItem to="/war-room" label="War Room" icon={Sparkles} />
        <SidebarNavItem to="/gym" label="Gym" icon={Dumbbell} />
        <SidebarNavItem to="/app-dev" label="App Dev" icon={AppWindow} />
        <SidebarNavItem to="/world-view" label="World View" icon={Globe} />
        <SidebarNavItem to="/knowledge-graph" label="Knowledge Graph" icon={Share2} />
        <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
        <SidebarNavItem to="/prompts" label="Prompts" icon={Library} />
        <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
        <SidebarNavItem to="/activity" label="Activity" icon={History} />
        <SidebarNavItem to="/design" label="Design" icon={Palette} />
        <SidebarNavItem to="/creative-studio" label="Creative Studio" icon={Clapperboard} />
        <SidebarNavItem to="/image-studio" label="AI Influencer Studio" icon={ImageIcon} />
        <SidebarNavItem to="/book-writing" label="Book Writing" icon={BookOpen} />
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
  socialUnread,
  showWorkspacesLink,
  pluginContext,
  issueNoun,
}: SidebarSharedProps) {
  return (
    <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => openNewIssue()}
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          data-pp-new-issue="true"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          <span className="truncate">New {issueNoun.capSingular}</span>
        </button>
        <SidebarNavItem to="/home" label="Home" icon={HomeIcon} liveCount={liveRunCount} />
        {/* Paperclip redesign: Action Queue + Work folded into unified Tasks. */}
        <SidebarNavItem
          to="/issues"
          label="Tasks"
          icon={CircleDot}
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
        <SidebarNavItem to="/war-room" label="War Room" icon={Sparkles} />
        <SidebarNavItem to="/gym" label="Gym" icon={Dumbbell} />
        <SidebarNavItem to="/app-dev" label="App Dev" icon={AppWindow} />
        <SidebarNavItem to="/voice-memos" label="Voice Memos" icon={Mic} />
        <SidebarNavItem to="/projects" label="Projects" icon={Hexagon} />
        <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        <SidebarNavItem
          to="/social"
          label="Social"
          icon={Megaphone}
          badge={socialUnread > 0 ? socialUnread : undefined}
        />
        <SidebarNavItem to="/approvals" label="Approvals" icon={MoreHorizontal} />
        <SidebarNavItem to="/world-view" label="World View" icon={Globe} />
        <SidebarNavItem to="/knowledge-graph" label="Knowledge Graph" icon={Share2} />
        <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
        <SidebarNavItem to="/prompts" label="Prompts" icon={Library} />
        <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
        <SidebarNavItem to="/activity" label="Activity" icon={History} />
        <SidebarNavItem to="/design" label="Design" icon={Palette} />
        <SidebarNavItem to="/creative-studio" label="Creative Studio" icon={Clapperboard} />
        <SidebarNavItem to="/image-studio" label="AI Influencer Studio" icon={ImageIcon} />
        <SidebarNavItem to="/book-writing" label="Book Writing" icon={BookOpen} />
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

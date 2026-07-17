import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { CloudAccessGate } from "./components/CloudAccessGate";
import { Dashboard } from "./pages/Dashboard";
import { DashboardLive } from "./pages/DashboardLive";
import { Home } from "./pages/Home";
import { Work } from "./pages/Work";
import { Companies } from "./pages/Companies";
import { Agents } from "./pages/Agents";
import { AgentDetail } from "./pages/AgentDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { ProjectWorkspaceDetail } from "./pages/ProjectWorkspaceDetail";
import { Workspaces } from "./pages/Workspaces";
import { Issues } from "./pages/Issues";
import { Tasks } from "./pages/Tasks";
import { Search } from "./pages/Search";
import { IssueDetail } from "./pages/IssueDetail";
import { IssueChatLongThreadPerf } from "./pages/IssueChatLongThreadPerf";
import { Routines } from "./pages/Routines";
import { RoutineDetail } from "./pages/RoutineDetail";
import { UserProfile } from "./pages/UserProfile";
import { ExecutionWorkspaceDetail } from "./pages/ExecutionWorkspaceDetail";
import { Goals } from "./pages/Goals";
import { GoalDetail } from "./pages/GoalDetail";
import { Approvals } from "./pages/Approvals";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Costs } from "./pages/Costs";
import { AppDev } from "./pages/AppDev";
import { CostWatcher } from "./pages/CostWatcher";
import { Activity } from "./pages/Activity";
import { Inbox } from "./pages/Inbox";
import { CompanySettings } from "./pages/CompanySettings";
import { CompanyEnvironments } from "./pages/CompanyEnvironments";
import { CompanyAccess } from "./pages/CompanyAccess";
import { CompanyInvites } from "./pages/CompanyInvites";
import { CompanySkills } from "./pages/CompanySkills";
import { SkillsCatalog } from "./pages/SkillsCatalog";
import { Prompts } from "./pages/Prompts";
import { Secrets } from "./pages/Secrets";
import { CompanyExport } from "./pages/CompanyExport";
import { CompanyImport } from "./pages/CompanyImport";
import { DesignGuide } from "./pages/DesignGuide";
import Design from "./pages/Design";
import DesignLibrary from "./pages/DesignLibrary";
import { ImageStudio } from "./pages/ImageStudio";
import { GymPage } from "./pages/GymPage";
import { CreativeStudio } from "./pages/CreativeStudio";
import { BookWritingPage } from "./pages/BookWritingPage";
import { ErrorBoundary as BookStudioErrorBoundary } from "./components/book-studio/ErrorBoundary";
import { OrgChart } from "./pages/OrgChart";
import { Personas } from "./pages/Personas";
import { PersonaDetail } from "./pages/PersonaDetail";
import { InstanceGeneralSettings } from "./pages/InstanceGeneralSettings";
import { InstanceAccess } from "./pages/InstanceAccess";
import { InstanceSettings } from "./pages/InstanceSettings";
import { InstanceExperimentalSettings } from "./pages/InstanceExperimentalSettings";
import { InstanceProviderKeys } from "./pages/InstanceProviderKeys";
import { ProfileSettings } from "./pages/ProfileSettings";
import { PluginManager } from "./pages/PluginManager";
import { PluginSettings } from "./pages/PluginSettings";
import { AdapterManager } from "./pages/AdapterManager";
import { PluginPage } from "./pages/PluginPage";
import { KnowledgeGraph } from "./pages/KnowledgeGraph";
import { Rooms } from "./pages/Rooms";
import { WarRoom } from "./pages/WarRoom";
import { WorldView } from "./pages/WorldView";
import { RoomDetail } from "./pages/RoomDetail";
// /social now points at the multi-platform scheduler (Buffer/Later-style).
// The legacy in-app broadcast feed `Social.tsx` is no longer routed —
// SocialScheduler replaces it. The legacy page file is kept for now until
// SocialPostDetail and any deep-links can be cleaned up.
import { SocialScheduler } from "./pages/SocialScheduler";
import { SocialPostDetail } from "./pages/SocialPostDetail";
import { NewAgent } from "./pages/NewAgent";
import { AuthPage } from "./pages/Auth";
import { BoardClaimPage } from "./pages/BoardClaim";
import { CliAuthPage } from "./pages/CliAuth";
import { InviteLandingPage } from "./pages/InviteLanding";
import { JoinRequestQueue } from "./pages/JoinRequestQueue";
import { Jarvis } from "./pages/Jarvis";
import { VoiceMemos } from "./pages/VoiceMemos";
import { NotFoundPage } from "./pages/NotFound";
import { useCompany } from "./context/CompanyContext";
import { useDialogActions } from "./context/DialogContext";
import { loadLastInboxTab } from "./lib/inbox";
import { shouldRedirectCompanylessRouteToOnboarding } from "./lib/onboarding-route";

function boardRoutes() {
  return (
    <>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="dashboard/live" element={<DashboardLive />} />
      <Route path="home" element={<Home />} />
      <Route path="work" element={<Work />} />
      <Route path="onboarding" element={<OnboardingRoutePage />} />
      <Route path="companies" element={<Companies />} />
      <Route path="company/settings" element={<CompanySettings />} />
      <Route path="company/settings/environments" element={<CompanyEnvironments />} />
      <Route path="company/settings/access" element={<CompanyAccess />} />
      <Route path="company/settings/invites" element={<CompanyInvites />} />
      <Route path="company/export/*" element={<CompanyExport />} />
      <Route path="company/import" element={<CompanyImport />} />
      <Route path="company/settings/secrets" element={<Secrets />} />
      <Route path="skills" element={<SkillsCatalog />} />
      <Route path="prompts" element={<Prompts />} />
      <Route path="skills/library/*" element={<CompanySkills />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route path="org" element={<OrgChart />} />
      <Route path="knowledge-graph" element={<KnowledgeGraph />} />
      <Route path="world-view" element={<WorldView />} />
      <Route path="rooms" element={<Rooms />} />
      <Route path="war-room" element={<WarRoom />} />
      <Route path="gym" element={<GymPage />} />
      <Route path="creative-studio" element={<CreativeStudio />} />
      <Route path="book-writing" element={<BookStudioErrorBoundary><BookWritingPage /></BookStudioErrorBoundary>} />
      <Route path="rooms/:roomId" element={<RoomDetail />} />
      <Route path="social" element={<SocialScheduler />} />
      <Route path="social/posts/:postId" element={<SocialPostDetail />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/workspaces/:workspaceId" element={<ProjectWorkspaceDetail />} />
      <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
      <Route path="projects/:projectId/configuration" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="workspaces" element={<Workspaces />} />
      {/* Paperclip redesign: /issues is now the unified Tasks surface
          (Tasks + Work + Action Queue folded into one). The pre-redesign
          Tasks page is preserved at /issues/legacy for review/rollback. */}
      <Route path="issues" element={<Tasks />} />
      <Route path="issues/legacy" element={<Issues />} />
      <Route path="search" element={<Search />} />
      <Route path="issues/all" element={<Navigate to="/issues" replace />} />
      <Route path="issues/active" element={<Navigate to="/issues" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
      <Route path="issues/done" element={<Navigate to="/issues" replace />} />
      <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
      <Route path="issues/:issueId" element={<IssueDetail />} />
      {import.meta.env.DEV ? (
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
      ) : null}
      <Route path="routines" element={<Routines />} />
      <Route path="routines/:routineId" element={<RoutineDetail />} />
      <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/services" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/configuration" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/issues" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/routines" element={<ExecutionWorkspaceDetail />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Costs />} />
      <Route path="app-dev" element={<AppDev />} />
      <Route path="cost-watcher" element={<CostWatcher />} />
      <Route path="activity" element={<Activity />} />
      <Route path="inbox" element={<InboxRootRedirect />} />
      <Route path="inbox/mine" element={<Inbox />} />
      <Route path="inbox/recent" element={<Inbox />} />
      <Route path="inbox/unread" element={<Inbox />} />
      <Route path="inbox/blocked" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="inbox/requests" element={<JoinRequestQueue />} />
      <Route path="inbox/new" element={<Navigate to="/inbox/mine" replace />} />
      <Route path="u/:userSlug" element={<UserProfile />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="design" element={<Design />} />
      <Route path="design/library" element={<DesignLibrary />} />
      <Route path="jarvis" element={<Jarvis />} />
      <Route path="voice-memos" element={<VoiceMemos />} />
      <Route path="personas" element={<Personas />} />
      <Route path="personas/:personaId" element={<PersonaDetail />} />
      <Route path="image-studio" element={<ImageStudio />} />
<Route path="gym" element={<GymPage />} />
      <Route path="creative-studio" element={<CreativeStudio />} />
      <Route path="book-writing" element={<BookStudioErrorBoundary><BookWritingPage /></BookStudioErrorBoundary>} />
      {/* Legacy standalone tool routes — collapsed into the unified Image Studio
          workbench. Redirect old links to the matching ?tab= rather than 404. */}
      <Route path="image-studio/tools/photoshoot" element={<LegacyImageToolRedirect tab="photoshoot" />} />
      <Route path="image-studio/tools/female-undresser" element={<LegacyImageToolRedirect tab="undresser" />} />
      <Route path="image-studio/library" element={<LegacyImageToolRedirect tab="library" />} />
      <Route path="instance/settings/adapters" element={<AdapterManager />} />
      <Route path=":pluginRoutePath/*" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </>
  );
}

function InboxRootRedirect() {
  return <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  return <Navigate to={`/instance/settings/general${location.search}${location.hash}`} replace />;
}

function OnboardingRoutePage() {
  const { companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const matchedCompany = companyPrefix
    ? companies.find((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase()) ?? null
    : null;

  const title = matchedCompany
    ? `Add another agent to ${matchedCompany.name}`
    : companies.length > 0
      ? "Create another company"
      : "Create your first company";
  const description = matchedCompany
    ? "Run onboarding again to add an agent and a starter task for this company."
    : companies.length > 0
      ? "Run onboarding again to create another company and seed its first agent."
      : "Get started by creating a company and your first agent.";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <Button
            onClick={() =>
              matchedCompany
                ? openOnboarding({ initialStep: 2, companyId: matchedCompany.id })
                : openOnboarding()
            }
          >
            {matchedCompany ? "Add Agent" : "Start Onboarding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const location = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/dashboard`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

/**
 * Redirects the retired standalone Image Studio tool URLs
 * (`image-studio/tools/*`, `image-studio/library`) into the unified workbench
 * at `<company>/image-studio?tab=<tab>`. Works whether the old URL carried a
 * company prefix (`:companyPrefix` param) or not (typed/bookmarked bare).
 */
function LegacyImageToolRedirect({ tab }: { tab: string }) {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const fromPrefix = companyPrefix
    ? companies.find((c) => c.issuePrefix.toUpperCase() === companyPrefix.toUpperCase()) ?? null
    : null;
  const targetCompany = fromPrefix ?? selectedCompany ?? companies[0] ?? null;

  if (!targetCompany) {
    if (shouldRedirectCompanylessRouteToOnboarding({ pathname: location.pathname, hasCompanies: false })) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/image-studio?tab=${tab}`} replace />;
}

function NoCompaniesStartPage() {
  const { openOnboarding } = useDialogActions();
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {t("app.noCompanies.title", { defaultValue: "Create your first company" })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("app.noCompanies.description", { defaultValue: "Get started by creating a company." })}
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>
            {t("app.noCompanies.newCompany", { defaultValue: "New Company" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="login" element={<Navigate to="/auth" replace />} />
        <Route path="signup" element={<Navigate to="/auth?mode=sign_up" replace />} />
        <Route path="forgot-password" element={<Navigate to="/auth" replace />} />
        <Route path="reset-password" element={<Navigate to="/auth" replace />} />
        <Route path="sso-callback" element={<Navigate to="/auth" replace />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="cli-auth/:id" element={<CliAuthPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />

        <Route element={<CloudAccessGate />}>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="onboarding" element={<OnboardingRoutePage />} />
          <Route path="instance" element={<Navigate to="/instance/settings/general" replace />} />
          <Route path="instance/settings" element={<Layout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="general" element={<InstanceGeneralSettings />} />
            <Route path="access" element={<InstanceAccess />} />
            <Route path="heartbeats" element={<InstanceSettings />} />
            <Route path="experimental" element={<InstanceExperimentalSettings />} />
            <Route path="provider-keys" element={<InstanceProviderKeys />} />
            <Route path="plugins" element={<PluginManager />} />
            <Route path="plugins/:pluginId" element={<PluginSettings />} />
            <Route path="adapters" element={<AdapterManager />} />
          </Route>
          <Route path="companies" element={<UnprefixedBoardRedirect />} />
          <Route path="home" element={<UnprefixedBoardRedirect />} />
          <Route path="work" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="routines" element={<UnprefixedBoardRedirect />} />
          <Route path="routines/:routineId" element={<UnprefixedBoardRedirect />} />
          <Route path="u/:userSlug" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/services" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/routines" element={<UnprefixedBoardRedirect />} />
          <Route path="cost-watcher" element={<UnprefixedBoardRedirect />} />
          <Route path="knowledge-graph" element={<UnprefixedBoardRedirect />} />
          <Route path="rooms" element={<UnprefixedBoardRedirect />} />
          <Route path="rooms/:roomId" element={<UnprefixedBoardRedirect />} />
          <Route path="social" element={<UnprefixedBoardRedirect />} />
          <Route path="social/posts/:postId" element={<UnprefixedBoardRedirect />} />
          <Route path="personas" element={<UnprefixedBoardRedirect />} />
          <Route path="personas/:personaId" element={<UnprefixedBoardRedirect />} />
          <Route path="image-studio" element={<UnprefixedBoardRedirect />} />
          {/* Old standalone tool URLs (often typed directly / bookmarked on mobile)
              had no company prefix and fell through to :companyPrefix → 404.
              Redirect them into the unified workbench with the matching tab. */}
          <Route path="image-studio/tools/photoshoot" element={<LegacyImageToolRedirect tab="photoshoot" />} />
          <Route path="image-studio/tools/female-undresser" element={<LegacyImageToolRedirect tab="undresser" />} />
          <Route path="image-studio/library" element={<LegacyImageToolRedirect tab="library" />} />
          <Route path="jarvis" element={<UnprefixedBoardRedirect />} />
          <Route path="dashboard" element={<UnprefixedBoardRedirect />} />
          <Route path="dashboard/live" element={<UnprefixedBoardRedirect />} />
          <Route path="activity" element={<UnprefixedBoardRedirect />} />
          <Route path="search" element={<UnprefixedBoardRedirect />} />
          <Route path="org" element={<UnprefixedBoardRedirect />} />
          <Route path="design-guide" element={<UnprefixedBoardRedirect />} />
          <Route path="design" element={<UnprefixedBoardRedirect />} />
          <Route path="design/library" element={<UnprefixedBoardRedirect />} />
          <Route path="costs" element={<UnprefixedBoardRedirect />} />
          {/* Bare sidebar links for company-scoped tools — redirect to the
              active company prefix like every other tab (was missing, so
              /app-dev and /prompts fell through to :companyPrefix → "company
              not found"). */}
          <Route path="app-dev" element={<UnprefixedBoardRedirect />} />
          <Route path="prompts" element={<UnprefixedBoardRedirect />} />
          {/* World View: bare /world-view must redirect to the active company
              prefix too. Without this it fell through to :companyPrefix and was
              parsed as company "world-view" → 404 (and the sidebar link then
              compounded to /WORLD-VIEW/world-view). */}
          <Route path="world-view" element={<UnprefixedBoardRedirect />} />
          <Route path="goals" element={<UnprefixedBoardRedirect />} />
          <Route path="goals/:goalId" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/pending" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/all" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/:approvalId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/all" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/active" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/paused" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/error" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/mine" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/recent" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/unread" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/blocked" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/all" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/requests" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/new" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/all" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/active" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/backlog" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/done" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/recent" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/budget" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings/environments" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings/access" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings/invites" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings/secrets" element={<UnprefixedBoardRedirect />} />
          <Route path="company/export/*" element={<UnprefixedBoardRedirect />} />
          <Route path="company/import" element={<UnprefixedBoardRedirect />} />
          <Route path="plugins/:pluginId" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
        </Route>
      </Routes>
      <OnboardingWizard />
    </>
  );
}

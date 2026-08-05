import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useNavigationType, useParams } from "@/lib/router";
import { Sidebar } from "./Sidebar";
import { InstanceSidebar } from "./InstanceSidebar";
import { CompanySettingsSidebar } from "./CompanySettingsSidebar";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { PropertiesPanel } from "./PropertiesPanel";
import { CommandPalette } from "./CommandPalette";
import { NewIssueDialog } from "./NewIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewGoalDialog } from "./NewGoalDialog";
import { NewAgentDialog } from "./NewAgentDialog";
import { CreateComposer } from "./CreateComposer";
import { KeyboardShortcutsCheatsheet } from "./KeyboardShortcutsCheatsheet";
import { ToastViewport } from "./ToastViewport";
import { MobileBottomNav } from "./MobileBottomNav";
import { WorktreeBanner } from "./WorktreeBanner";
import { DevRestartBanner } from "./DevRestartBanner";
import { ResizableSidebarPane } from "./ResizableSidebarPane";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { useDialogActions, useDialogState } from "../context/DialogContext";
import { GeneralSettingsProvider } from "../context/GeneralSettingsContext";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCompanyPageMemory } from "../hooks/useCompanyPageMemory";
import { useUiV1 } from "../hooks/useUiV1";
import { useUiV2 } from "../hooks/useUiV2";
import { IssueNounProvider } from "../hooks/useIssueNoun";
import { healthApi } from "../api/health";
import { instanceSettingsApi } from "../api/instanceSettings";
import { shouldSyncCompanySelectionFromRoute } from "../lib/company-selection";
import {
  DEFAULT_INSTANCE_SETTINGS_PATH,
  normalizeRememberedInstanceSettingsPath,
} from "../lib/instance-settings";
import {
  resetNavigationScroll,
  shouldResetScrollOnNavigation,
} from "../lib/navigation-scroll";
import { queryKeys } from "../lib/queryKeys";
import { scheduleMainContentFocus } from "../lib/main-content-focus";
import { cn } from "../lib/utils";
import { NotFoundPage } from "../pages/NotFound";
import { PluginSlotMount, resolveRouteSidebarSlot, usePluginSlots } from "../plugins/slots";

const INSTANCE_SETTINGS_MEMORY_KEY = "paperclip.lastInstanceSettingsPath";
const MOBILE_DRAWER_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getCompanyRouteSegment(pathname: string, companyPrefix: string | undefined): string | null {
  if (!companyPrefix) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (segments[0]?.toUpperCase() !== companyPrefix.toUpperCase()) return null;
  return segments[1]?.toLowerCase() ?? null;
}

/**
 * Maps a pathname to the v2 page-style hook key. Used to set
 * data-pp-page-v2 on <main> so per-page v2 CSS rules can target
 * routes without per-component edits. Returns "default" for any
 * unmatched route so the generic [data-pp-page-v2] CSS still applies.
 */
function resolveV2PageKey(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "default";
  // /home, /inbox, /agents/all, /agents/:id, /rooms, /rooms/:id, /issues, /projects,
  // /activity, /work, /approvals, /goals, /routines, /social,
  // /knowledge-graph, /org, /company/settings, instance/settings, /search etc.
  const first = segments[0]?.toLowerCase() ?? "";
  // Company-prefixed routes: /<PREFIX>/<segment>/...
  const companyPrefixed = first.length >= 2 && first.length <= 16 && first === first.toUpperCase() && /^[A-Z0-9_-]+$/.test(segments[0] ?? "");
  const route = companyPrefixed && segments.length > 1 ? (segments[1] ?? "").toLowerCase() : first;
  const sub = companyPrefixed && segments.length > 2 ? (segments[2] ?? "").toLowerCase() : (segments[1] ?? "").toLowerCase();

  if (route === "home" || route === "dashboard") return "home";
  if (route === "inbox") return "inbox";
  if (route === "issues") return sub && sub !== "" && !["new"].includes(sub) ? "issue-detail" : "issues";
  if (route === "agents") return sub && !["all", "active", "paused", "error"].includes(sub) ? "agent-detail" : "agents";
  if (route === "rooms") return sub ? "room-detail" : "rooms";
  if (route === "projects") return sub ? "project-detail" : "projects";
  if (route === "activity") return "activity";
  if (route === "work") return "work";
  if (route === "approvals") return "approvals";
  if (route === "goals") return sub ? "goal-detail" : "goals";
  if (route === "routines") return sub ? "routine-detail" : "routines";
  if (route === "social") return "social";
  if (route === "knowledge-graph") return "knowledge-graph";
  if (route === "org") return "org-chart";
  if (route === "skills") return "skills";
  if (route === "costs") return "costs";
  if (route === "search") return "search";
  if (route === "company" && sub === "settings") return "settings";
  if (route === "instance") return "instance-settings";
  // Bare issue identifier under /<PREFIX>/<key>
  if (companyPrefixed && segments.length === 2) return "issue-detail";
  return "default";
}

function readRememberedInstanceSettingsPath(): string {
  if (typeof window === "undefined") return DEFAULT_INSTANCE_SETTINGS_PATH;
  try {
    return normalizeRememberedInstanceSettingsPath(window.localStorage.getItem(INSTANCE_SETTINGS_MEMORY_KEY));
  } catch {
    return DEFAULT_INSTANCE_SETTINGS_PATH;
  }
}

export function Layout() {
  // Mirrors the `enableUiV1` instance flag onto <html> so the v1 theme tokens activate.
  useUiV1();
  // Same for `enableUiV2` — activates the v2 sidebar shell tokens.
  const uiV2 = useUiV2();
  const { sidebarOpen, setSidebarOpen, toggleSidebar, isMobile } = useSidebar();
  const { openNewIssue, openOnboarding } = useDialogActions();
  const { togglePanelVisible } = usePanel();
  const {
    companies,
    loading: companiesLoading,
    selectedCompany,
    selectedCompanyId,
    selectionSource,
    setSelectedCompanyId,
  } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const isInstanceSettingsRoute = location.pathname.startsWith("/instance/");
  const isCompanySettingsRoute = location.pathname.includes("/company/settings");
  const onboardingTriggered = useRef(false);
  const lastMainScrollTop = useRef(0);
  const previousPathname = useRef<string | null>(null);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const sidebarDrawerRef = useRef<HTMLDivElement | null>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const [instanceSettingsTarget, setInstanceSettingsTarget] = useState<string>(() => readRememberedInstanceSettingsPath());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const matchedCompany = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix) ?? null;
  }, [companies, companyPrefix]);
  const hasUnknownCompanyPrefix =
    Boolean(companyPrefix) && !companiesLoading && companies.length > 0 && !matchedCompany;
  const pluginRoutePath = useMemo(
    () => getCompanyRouteSegment(location.pathname, companyPrefix),
    [companyPrefix, location.pathname],
  );
  const routeSidebarCompanyId = matchedCompany?.id ?? null;
  const routeSidebarCompanyPrefix = matchedCompany?.issuePrefix ?? null;
  const { slots: routeSidebarSlots } = usePluginSlots({
    slotTypes: ["page", "routeSidebar"],
    companyId: routeSidebarCompanyId,
    enabled: Boolean(routeSidebarCompanyId && pluginRoutePath),
  });
  const routeSidebarSlot = useMemo(
    () => resolveRouteSidebarSlot(routeSidebarSlots, pluginRoutePath),
    [pluginRoutePath, routeSidebarSlots],
  );
  const sidebarContext = useMemo(
    () => ({
      companyId: routeSidebarCompanyId,
      companyPrefix: routeSidebarCompanyPrefix,
    }),
    [routeSidebarCompanyId, routeSidebarCompanyPrefix],
  );
  const companySidebar = routeSidebarSlot ? (
    <PluginSlotMount
      slot={routeSidebarSlot}
      context={sidebarContext}
      className="h-full w-full"
      missingBehavior="placeholder"
    />
  ) : (
    <Sidebar />
  );
  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as { devServer?: { enabled?: boolean } } | undefined;
      return data?.devServer?.enabled ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });
  const keyboardShortcutsEnabled = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  }).data?.keyboardShortcuts === true;

  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (health?.deploymentMode === "authenticated") return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding, health?.deploymentMode]);

  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;

    if (!matchedCompany) {
      const fallback = (selectedCompanyId ? companies.find((company) => company.id === selectedCompanyId) : null)
        ?? companies[0]
        ?? null;
      if (fallback && selectedCompanyId !== fallback.id) {
        setSelectedCompanyId(fallback.id, { source: "route_sync" });
      }
      return;
    }

    if (companyPrefix !== matchedCompany.issuePrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${matchedCompany.issuePrefix}${suffix}${location.search}`, { replace: true });
      return;
    }

    if (
      shouldSyncCompanySelectionFromRoute({
        selectionSource,
        selectedCompanyId,
        routeCompanyId: matchedCompany.id,
      })
    ) {
      setSelectedCompanyId(matchedCompany.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    matchedCompany,
    location.pathname,
    location.search,
    navigate,
    selectionSource,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const togglePanel = togglePanelVisible;
  const openSearch = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
  }, []);

  useCompanyPageMemory();

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    onNewIssue: () => openNewIssue(),
    onSearch: openSearch,
    onToggleSidebar: toggleSidebar,
    onTogglePanel: togglePanel,
    onShowShortcuts: () => setShortcutsOpen(true),
    onGoto: (target) => {
      switch (target) {
        case "home":
          navigate("/home");
          return;
        case "inbox":
          navigate("/inbox");
          return;
        case "agents":
          navigate("/agents/all");
          return;
        case "routines":
          navigate("/routines");
          return;
        case "settings":
          navigate("/company/settings");
          return;
      }
    },
  });

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      return;
    }
    lastMainScrollTop.current = 0;
    setMobileNavVisible(true);
  }, [isMobile]);

  // Swipe gesture to open/close sidebar on mobile
  useEffect(() => {
    if (!isMobile) return;

    const EDGE_ZONE = 30; // px from left edge to start open-swipe
    const MIN_DISTANCE = 50; // minimum horizontal swipe distance
    const MAX_VERTICAL = 75; // max vertical drift before we ignore

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dy > MAX_VERTICAL) return; // vertical scroll, ignore

      // Swipe right from left edge → open
      if (!sidebarOpen && startX < EDGE_ZONE && dx > MIN_DISTANCE) {
        setSidebarOpen(true);
        return;
      }

      // Swipe left when open → close
      if (sidebarOpen && dx < -MIN_DISTANCE) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const drawer = sidebarDrawerRef.current;
    if (!drawer) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !drawer.contains(activeElement)) {
      sidebarReturnFocusRef.current = activeElement;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = drawer.querySelector<HTMLElement>(MOBILE_DRAWER_FOCUSABLE);
      (firstFocusable ?? drawer).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(MOBILE_DRAWER_FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      const returnTarget = sidebarReturnFocusRef.current;
      sidebarReturnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, location.pathname, setSidebarOpen]);

  const updateMobileNavVisibility = useCallback((currentTop: number) => {
    const delta = currentTop - lastMainScrollTop.current;

    if (currentTop <= 24) {
      setMobileNavVisible(true);
    } else if (delta > 8) {
      setMobileNavVisible(false);
    } else if (delta < -8) {
      setMobileNavVisible(true);
    }

    lastMainScrollTop.current = currentTop;
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      lastMainScrollTop.current = 0;
      return;
    }

    const scrollOwner = mainContentRef.current;
    if (!scrollOwner) return;

    const onScroll = () => updateMobileNavVisibility(scrollOwner.scrollTop);

    onScroll();
    scrollOwner.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scrollOwner.removeEventListener("scroll", onScroll);
    };
  }, [isMobile, updateMobileNavVisibility]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith("/instance/settings/")) return;

    const nextPath = normalizeRememberedInstanceSettingsPath(
      `${location.pathname}${location.search}${location.hash}`,
    );
    setInstanceSettingsTarget(nextPath);

    try {
      window.localStorage.setItem(INSTANCE_SETTINGS_MEMORY_KEY, nextPath);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const mainContent = mainContentRef.current;
    return scheduleMainContentFocus(mainContent);
  }, [location.pathname]);

  useEffect(() => {
    const shouldResetScroll = shouldResetScrollOnNavigation({
      previousPathname: previousPathname.current,
      pathname: location.pathname,
      navigationType,
      state: location.state,
    });

    previousPathname.current = location.pathname;

    if (!shouldResetScroll) return;
    resetNavigationScroll(mainContentRef.current);
  }, [location.pathname, navigationType]);

  return (
    <GeneralSettingsProvider value={{ keyboardShortcutsEnabled }}>
      <IssueNounProvider>
      <div
      className={cn(
        "bg-background text-foreground pt-[env(safe-area-inset-top)]",
        "flex h-dvh flex-col overflow-hidden",
      )}
      >
      <a
        href="#main-content"
        tabIndex={isMobile && sidebarOpen ? -1 : undefined}
        aria-hidden={isMobile && sidebarOpen ? true : undefined}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to Main Content
      </a>
      <WorktreeBanner />
      <DevRestartBanner devServer={health?.devServer} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isMobile && sidebarOpen && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          />
        )}

        {isMobile ? (
          <div
            ref={sidebarDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile sidebar"
            aria-hidden={!sidebarOpen}
            inert={!sidebarOpen ? true : undefined}
            tabIndex={-1}
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex max-w-[calc(100vw-3rem)] flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-100 ease-out",
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="w-60 shrink-0 overflow-hidden">
                {isInstanceSettingsRoute ? (
                  <InstanceSidebar />
                ) : isCompanySettingsRoute ? (
                  <CompanySettingsSidebar />
                ) : (
                  companySidebar
                )}
              </div>
            </div>
            <SidebarAccountMenu
              deploymentMode={health?.deploymentMode}
              instanceSettingsTarget={instanceSettingsTarget}
              version={health?.version}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col shrink-0">
            <div className="flex flex-1 min-h-0">
              <ResizableSidebarPane
                open={sidebarOpen}
                resizable
                className={cn("h-full shrink-0", uiV2 && "pp-sidebar-pane-v2")}
              >
                {isInstanceSettingsRoute ? (
                  <InstanceSidebar />
                ) : isCompanySettingsRoute ? (
                  <CompanySettingsSidebar />
                ) : (
                  companySidebar
                )}
              </ResizableSidebarPane>
            </div>
            <SidebarAccountMenu
              deploymentMode={health?.deploymentMode}
              instanceSettingsTarget={instanceSettingsTarget}
              version={health?.version}
            />
          </div>
        )}

        <div
          className="flex h-full min-w-0 flex-1 flex-col"
          aria-hidden={isMobile && sidebarOpen ? true : undefined}
          inert={isMobile && sidebarOpen ? true : undefined}
        >
          <div
            className={cn(
              isMobile && "z-20 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85",
            )}
          >
            <BreadcrumbBar />
          </div>
          <div className={cn("flex min-h-0 flex-1", isMobile && "overflow-hidden")}>
            <main
              id="main-content"
              ref={mainContentRef}
              tabIndex={-1}
              className={cn(
                "flex-1 p-4 outline-none md:p-6",
                isMobile
                  ? "min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-[calc(5.25rem+env(safe-area-inset-bottom))]"
                  : "overflow-auto",
              )}
              data-pp-page-v2={uiV2 ? resolveV2PageKey(location.pathname) : undefined}
            >
              {hasUnknownCompanyPrefix ? (
                <NotFoundPage
                  scope="invalid_company_prefix"
                  requestedPrefix={companyPrefix ?? selectedCompany?.issuePrefix}
                />
              ) : (
                <Outlet />
              )}
            </main>
            <PropertiesPanel />
          </div>
        </div>
      </div>
      {isMobile && <MobileBottomNav visible={mobileNavVisible} disabled={sidebarOpen} />}
      <CommandPalette />
      <CreateComposerMount />
      <NewIssueDialog />
      <NewProjectDialog />
      <NewGoalDialog />
      <NewAgentDialog />
      <KeyboardShortcutsCheatsheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ToastViewport />
      </div>
      </IssueNounProvider>
    </GeneralSettingsProvider>
  );
}

function CreateComposerMount() {
  const { createComposerOpen } = useDialogState();
  const { closeCreateComposer, openCreateComposer } = useDialogActions();
  return (
    <CreateComposer
      open={createComposerOpen}
      onOpenChange={(v) => (v ? openCreateComposer() : closeCreateComposer())}
    />
  );
}

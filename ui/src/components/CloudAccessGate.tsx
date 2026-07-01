import { Component, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { accessApi } from "@/api/access";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { getRememberedInvitePath } from "@/lib/invite-memory";
import { queryKeys } from "@/lib/queryKeys";

function BootstrapPendingPage({ hasActiveInvite = false }: { hasActiveInvite?: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Instance setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasActiveInvite
            ? "No instance admin exists yet. A bootstrap invite is already active. Check your Paperclip startup logs for the first admin invite URL, or run this command to rotate it:"
            : "No instance admin exists yet. Run this command in your Paperclip environment to generate the first admin invite URL:"}
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
{`pnpm paperclipai auth bootstrap-ceo`}
        </pre>
      </div>
    </div>
  );
}

function NoBoardAccessPage() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">No company access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account is signed in, but it does not have an active company membership or instance-admin access on
          this Paperclip instance.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Use a company invite or sign in with an account that already belongs to this org.
        </p>
      </div>
    </div>
  );
}

function SubtreeCrashPage() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">This page failed to render</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong while building this view. Your account access is fine — this is a client-side error.
          Check the browser console for details, then reload.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm hover:bg-muted/50"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

type GateErrorBoundaryState = { hasError: boolean };

// If anything in the authenticated subtree throws during render (a stale or
// malformed cache, a context that wasn't ready for an empty-companies user,
// a WebGL init failure on a page like Knowledge Graph, etc.), fall back to a
// truthful "render failed" page instead of unmounting the app and showing a
// blank screen. We deliberately do NOT fall back to NoBoardAccessPage here —
// that page accuses the user of lacking access, which is a lie when the real
// problem is a client-side render bug. The access checks above this boundary
// already gate users who actually lack access.
class GateErrorBoundary extends Component<{ children: ReactNode }, GateErrorBoundaryState> {
  override state: GateErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GateErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("CloudAccessGate subtree crashed", { error, componentStack: info.componentStack });
  }

  override render() {
    if (this.state.hasError) return <SubtreeCrashPage />;
    return this.props.children;
  }
}

export function CloudAccessGate() {
  const location = useLocation();
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as
        | { deploymentMode?: "local_trusted" | "authenticated"; bootstrapStatus?: "ready" | "bootstrap_pending" }
        | undefined;
      return data?.deploymentMode === "authenticated" && data.bootstrapStatus === "bootstrap_pending"
        ? 2000
        : false;
    },
    refetchIntervalInBackground: true,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  const boardAccessQuery = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    enabled: isAuthenticatedMode && !!sessionQuery.data,
    retry: false,
  });

  if (
    healthQuery.isLoading ||
    (isAuthenticatedMode && sessionQuery.isLoading) ||
    (isAuthenticatedMode && !!sessionQuery.data && boardAccessQuery.isLoading)
  ) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error || boardAccessQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error
          ? healthQuery.error.message
          : boardAccessQuery.error instanceof Error
            ? boardAccessQuery.error.message
            : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage hasActiveInvite={healthQuery.data.bootstrapInviteActive} />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  if (
    isAuthenticatedMode &&
    sessionQuery.data &&
    !boardAccessQuery.data?.isInstanceAdmin &&
    (boardAccessQuery.data?.companyIds?.length ?? 0) === 0
  ) {
    // A user who just authenticated through CF Access but has no company yet
    // is almost always an invite recipient — send them back to finish the
    // invite instead of stranding them on a dead-end "No company access" page.
    const rememberedInvitePath = getRememberedInvitePath();
    if (rememberedInvitePath && location.pathname !== rememberedInvitePath) {
      return <Navigate to={rememberedInvitePath} replace />;
    }
    return <NoBoardAccessPage />;
  }

  return (
    <GateErrorBoundary>
      <Outlet />
    </GateErrorBoundary>
  );
}

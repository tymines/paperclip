// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksKanban } from "./TasksKanban";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createIssue(status: Issue["status"]): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "A mobile-safe kanban card",
    description: null,
    status,
    workMode: "standard",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    updatedAt: new Date("2026-08-05T00:00:00.000Z"),
    labels: [],
    labelIds: [],
    iterationCount: 0,
    myLastTouchAt: null,
    lastExternalCommentAt: null,
    lastActivityAt: null,
    isUnreadForMe: false,
  };
}

describe("TasksKanban responsive layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the phone board in a labelled contained horizontal scroller while preserving desktop columns", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TasksKanban
            issues={[createIssue("todo")]}
            onIssueClick={vi.fn()}
            onStatusChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    const scroller = container.querySelector('[data-testid="tasks-kanban-scroller"]');
    expect(scroller?.getAttribute("role")).toBe("region");
    expect(scroller?.getAttribute("aria-label")).toContain("Scroll horizontally");
    expect(scroller?.className).toContain("max-w-full");
    expect(scroller?.className).toContain("overflow-x-auto");
    expect(container.querySelector('[class*="w-[240px]"]')).not.toBeNull();

    act(() => root.unmount());
  });
});

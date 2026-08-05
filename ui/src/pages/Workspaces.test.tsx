// @vitest-environment jsdom

import type { Project } from "@paperclipai/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACES_RESPONSIVE_CLASS, WorkspacesProjectLink, buildProjectWorkspaceGroups } from "./Workspaces";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: null, selectedCompanyId: "company-1" }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Workspaces responsive grouping", () => {
  it("mounts a breakable long-name target and navigates through the real router", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const longName = "AReallyLongUnbrokenProjectNameThatMustNotClipAtPhoneWidth";
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/workspaces"]}>
          <Routes>
            <Route path="/workspaces" element={<WorkspacesProjectLink projectRef="long-project" name={longName} />} />
            <Route path="/projects/long-project/workspaces" element={<p data-testid="destination">Workspace destination</p>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.className).toContain("min-h-11");
    expect(link?.className).toContain("max-w-full");
    expect(link?.className).toContain("break-all");
    act(() => link?.click());
    expect(container.querySelector("[data-testid='destination']")?.textContent).toBe("Workspace destination");
    expect(WORKSPACES_RESPONSIVE_CLASS).toContain("overflow-x-hidden");
    act(() => root.unmount());
  });

  it("prioritizes running workspaces", () => {
    const projects = [
      { id: "project-idle", name: "Idle", urlKey: "idle", description: null, primaryWorkspace: null, workspaces: [{ id: "workspace-idle", name: "Idle workspace", isPrimary: true, runtimeServices: [], runtimeConfig: null, updatedAt: new Date("2026-08-04T00:00:00Z") }] },
      { id: "project-running", name: "Running", urlKey: "running", description: null, primaryWorkspace: null, workspaces: [{ id: "workspace-running", name: "Running workspace", isPrimary: true, runtimeServices: [{ id: "service-1", status: "running" }], runtimeConfig: null, updatedAt: new Date("2026-08-05T00:00:00Z") }] },
    ] as Project[];
    const groups = buildProjectWorkspaceGroups({ projects, issues: [], executionWorkspaces: [] });
    expect(groups[0]?.project.id).toBe("project-running");
    expect(groups[0]?.runningServiceCount).toBeGreaterThan(0);
  });
});

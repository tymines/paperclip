import type { Project } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { WORKSPACES_RESPONSIVE_CLASS, buildProjectWorkspaceGroups } from "./Workspaces";

describe("Workspaces responsive grouping", () => {
  it("contains phone overflow, restores desktop button density, and prioritizes running workspaces", () => {
    expect(WORKSPACES_RESPONSIVE_CLASS).toContain("overflow-x-hidden");
    expect(WORKSPACES_RESPONSIVE_CLASS).toContain("[&_button]:min-h-11");
    expect(WORKSPACES_RESPONSIVE_CLASS).toContain("sm:[&_button]:min-h-0");

    const projects = [
      {
        id: "project-idle",
        name: "Idle",
        urlKey: "idle",
        description: null,
        primaryWorkspace: null,
        workspaces: [{
          id: "workspace-idle",
          name: "Idle workspace",
          isPrimary: true,
          runtimeServices: [],
          runtimeConfig: null,
          updatedAt: new Date("2026-08-04T00:00:00Z"),
        }],
      },
      {
        id: "project-running",
        name: "Running",
        urlKey: "running",
        description: null,
        primaryWorkspace: null,
        workspaces: [{
          id: "workspace-running",
          name: "Running workspace",
          isPrimary: true,
          runtimeServices: [{ id: "service-1", status: "running" }],
          runtimeConfig: null,
          updatedAt: new Date("2026-08-05T00:00:00Z"),
        }],
      },
    ] as Project[];

    const groups = buildProjectWorkspaceGroups({ projects, issues: [], executionWorkspaces: [] });
    expect(groups[0]?.project.id).toBe("project-running");
    expect(groups[0]?.runningServiceCount).toBeGreaterThan(0);
  });
});

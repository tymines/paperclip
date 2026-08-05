import { describe, expect, it } from "vitest";
import {
  EXECUTION_WORKSPACE_RESPONSIVE_CLASS,
  buildExecutionWorkspacePatch,
} from "./ExecutionWorkspaceDetail";

describe("ExecutionWorkspaceDetail phone form", () => {
  it("keeps phone actions and text controls at 44px while preserving desktop values and patch behavior", () => {
    expect(EXECUTION_WORKSPACE_RESPONSIVE_CLASS).toContain("[&_button]:min-h-11");
    expect(EXECUTION_WORKSPACE_RESPONSIVE_CLASS).toContain("input:not([type=checkbox])");
    expect(EXECUTION_WORKSPACE_RESPONSIVE_CLASS).toContain("sm:[&_button]:min-h-0");

    const initial = {
      name: "Workspace",
      cwd: "C:\\workspace",
      repoUrl: "",
      baseRef: "origin/master",
      branchName: "feature",
      providerRef: "",
      provisionCommand: "",
      teardownCommand: "",
      cleanupCommand: "",
      inheritRuntime: true,
      workspaceRuntime: "",
    } as Parameters<typeof buildExecutionWorkspacePatch>[0];
    expect(buildExecutionWorkspacePatch(initial, { ...initial, branchName: "mobile" })).toEqual({ branchName: "mobile" });
  });
});

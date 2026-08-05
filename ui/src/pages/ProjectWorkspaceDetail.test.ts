import { describe, expect, it } from "vitest";
import {
  PROJECT_WORKSPACE_RESPONSIVE_CLASS,
  buildProjectWorkspacePatch,
  validateProjectWorkspaceForm,
} from "./ProjectWorkspaceDetail";

const validForm = {
  name: "Primary",
  sourceType: "local_path",
  cwd: "C:\\workspace",
  repoUrl: "",
  repoRef: "",
  defaultRef: "",
  visibility: "default",
  setupCommand: "",
  cleanupCommand: "",
  remoteProvider: "",
  remoteWorkspaceRef: "",
  sharedWorkspaceKey: "",
  runtimeConfig: "",
} as Parameters<typeof validateProjectWorkspaceForm>[0];

describe("ProjectWorkspaceDetail phone form", () => {
  it("keeps phone controls at 44px, restores desktop density, and validates/saves changed fields", () => {
    expect(PROJECT_WORKSPACE_RESPONSIVE_CLASS).toContain("[&_input]:min-h-11");
    expect(PROJECT_WORKSPACE_RESPONSIVE_CLASS).toContain("sm:[&_input]:min-h-0");
    expect(validateProjectWorkspaceForm(validForm)).toBeNull();
    expect(validateProjectWorkspaceForm({ ...validForm, cwd: "relative/path" })).toContain("absolute");
    expect(buildProjectWorkspacePatch(validForm, { ...validForm, name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

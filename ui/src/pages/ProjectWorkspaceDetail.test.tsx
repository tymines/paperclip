// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_WORKSPACE_RESPONSIVE_CLASS,
  ProjectWorkspaceRuntimeConfigControl,
  buildProjectWorkspacePatch,
  validateProjectWorkspaceForm,
} from "./ProjectWorkspaceDetail";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectWorkspaceDetail phone form", () => {
  it("mounts the 44px advanced control and sends runtime JSON edits", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<ProjectWorkspaceRuntimeConfigControl value="{}" onChange={onChange} />);
    });

    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(summary?.className).toContain("min-h-11");
    expect(summary?.className).toContain("sm:min-h-0");
    act(() => summary?.click());
    expect(details?.open).toBe(true);

    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          textarea,
          '{"commands":[]}',
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(onChange).toHaveBeenCalledWith('{"commands":[]}');

    expect(PROJECT_WORKSPACE_RESPONSIVE_CLASS).toContain("overflow-x-hidden");
    expect(validateProjectWorkspaceForm(validForm)).toBeNull();
    expect(validateProjectWorkspaceForm({ ...validForm, cwd: "relative/path" })).toContain("absolute");
    expect(buildProjectWorkspacePatch(validForm, { ...validForm, name: "Renamed" })).toEqual({ name: "Renamed" });
    act(() => root.unmount());
  });
});

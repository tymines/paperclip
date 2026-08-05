// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXECUTION_WORKSPACE_RESPONSIVE_CLASS,
  ExecutionWorkspaceRuntimeConfigControl,
  ExecutionWorkspaceTabs,
  buildExecutionWorkspacePatch,
} from "./ExecutionWorkspaceDetail";

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: true }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function RuntimeConfigHarness() {
  const [state, setState] = useState({ inheritRuntime: true, workspaceRuntime: "" });
  return (
    <ExecutionWorkspaceRuntimeConfigControl
      {...state}
      inheritedRuntimeConfig={{ commands: [] }}
      onChange={setState}
    />
  );
}

function TabsHarness() {
  const [activeTab, setActiveTab] = useState<"issues" | "services" | "configuration" | "runtime_logs" | "routines">("issues");
  return (
    <div>
      <ExecutionWorkspaceTabs activeTab={activeTab} onValueChange={setActiveTab} />
      <output>{activeTab}</output>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ExecutionWorkspaceDetail phone form", () => {
  it("mounts the advanced form, toggles inheritance through its 44px label, and restores desktop density", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<RuntimeConfigHarness />));

    const summary = container.querySelector("summary");
    const details = container.querySelector("details");
    const checkbox = container.querySelector<HTMLInputElement>("#inherit-runtime-config");
    const label = container.querySelector<HTMLLabelElement>("label[for='inherit-runtime-config']");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(summary?.className).toContain("min-h-11");
    expect(summary?.className).toContain("sm:min-h-0");
    expect(label?.className).toContain("min-h-11");
    expect(checkbox?.className).toContain("h-11");
    expect(checkbox?.className).toContain("sm:h-4");

    act(() => summary?.click());
    expect(details?.open).toBe(true);
    act(() => label?.click());
    expect(checkbox?.checked).toBe(false);
    expect(textarea?.disabled).toBe(false);
    expect(textarea?.value).toContain('"commands"');

    expect(EXECUTION_WORKSPACE_RESPONSIVE_CLASS).toContain("overflow-x-hidden");
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
    act(() => root.unmount());
  });

  it("mounts the phone tab selector and changes workspace sections", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<TabsHarness />));
    const select = container.querySelector<HTMLSelectElement>("select[aria-label='Page section']");
    expect(select?.className).toContain("h-11");
    act(() => {
      if (select) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "configuration");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(container.querySelector("output")?.textContent).toBe("configuration");
    act(() => root.unmount());
  });
});

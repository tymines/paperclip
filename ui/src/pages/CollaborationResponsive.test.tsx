// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ActivityTypeFilter } from "./Activity";
import { ApprovalStatusFilter } from "./Approvals";
import { ApprovalCommentInput, ApprovalHeading, ApprovalPayloadDisclosure } from "./ApprovalDetail";
import { GoalsCreateAction } from "./Goals";
import { RoomMessageComposer } from "./RoomDetail";
import { RoomTypeSelect } from "./Rooms";
import { RoutineDetailTabList } from "./RoutineDetail";
import { RoutineListRow } from "../components/RoutineList";

vi.mock("../components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("@/lib/router", () => ({ Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => <a href={to} {...props}>{children}</a> }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

function openSelect(trigger: HTMLElement) {
  act(() => trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
}

beforeEach(() => {
  if (!(globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent) {
    Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true });
  }
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: () => {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { value: () => {}, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Collaboration responsive workflows", () => {
  it("opens the Activity portal filter with phone-sized, desktop-restored items", () => {
    const onChange = vi.fn();
    const { container, root } = mount(<ActivityTypeFilter value="all" entityTypes={["goal", "issue"]} onValueChange={onChange} />);
    openSelect(container.querySelector<HTMLElement>("button")!);
    const goal = Array.from(document.body.querySelectorAll<HTMLElement>("[role='option']")).find((item) => item.textContent === "Goal")!;
    expect(goal.className).toContain("min-h-11");
    expect(goal.className).toContain("sm:min-h-0");
    act(() => goal.click());
    expect(onChange).toHaveBeenCalledWith("goal");
    act(() => root.unmount());
  });

  it("changes the mounted Approvals status tab", () => {
    const onChange = vi.fn();
    const { container, root } = mount(<ApprovalStatusFilter value="pending" pendingCount={2} onValueChange={onChange} />);
    const all = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-slot='tabs-trigger']")).find((button) => button.textContent === "All")!;
    act(() => all.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(onChange).toHaveBeenCalledWith("all");
    act(() => root.unmount());
  });

  it("invokes the mounted phone Goals primary action", () => {
    const onCreate = vi.fn();
    const { container, root } = mount(<GoalsCreateAction onCreate={onCreate} />);
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("sm:h-8");
    act(() => button.click());
    expect(onCreate).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("sends a mounted Room message with Enter", () => {
    const onSend = vi.fn();
    function Harness() {
      const [value, setValue] = useState("");
      return <RoomMessageComposer value={value} pending={false} onChange={setValue} onSend={onSend} />;
    }
    const { container, root } = mount(<Harness />);
    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "hello room");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSend).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("switches mounted Routine Detail tabs with phone and desktop geometry", () => {
    const { container, root } = mount(<Tabs defaultValue="triggers"><RoutineDetailTabList hasLiveRun /></Tabs>);
    const list = container.querySelector<HTMLElement>("[data-slot='tabs-list']")!;
    const runs = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-slot='tabs-trigger']")).find((button) => button.textContent?.includes("Runs"))!;
    expect(list.className).toContain("min-h-[50px]");
    expect(list.className).toContain("sm:h-9");
    act(() => runs.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(runs.getAttribute("data-state")).toBe("active");
    act(() => root.unmount());
  });

  it("opens the Routine row action portal with restored item geometry", () => {
    const routine = { id: "routine-1", title: "Daily sync", status: "active", projectId: null, assigneeAgentId: null };
    const { container, root } = mount(
      <RoutineListRow
        routine={routine}
        projectById={new Map()}
        agentById={new Map()}
        runningRoutineId={null}
        statusMutationRoutineId={null}
        href="/routines/routine-1"
        onRunNow={() => {}}
        onToggleEnabled={() => {}}
        onToggleArchived={() => {}}
      />,
    );
    openSelect(container.querySelector<HTMLElement>('button[aria-label^="More actions"]')!);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"));
    expect(items.length).toBeGreaterThan(2);
    expect(items.every((item) => item.className.includes("min-h-11") && item.className.includes("sm:min-h-0"))).toBe(true);
    act(() => root.unmount());
  });

  it("opens the Rooms dialog select portal and chooses a room type", () => {
    const onChange = vi.fn();
    const { container, root } = mount(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Create room</DialogTitle>
          <DialogDescription>Choose a room type.</DialogDescription>
          <RoomTypeSelect value="collaboration" onValueChange={onChange} />
        </DialogContent>
      </Dialog>,
    );
    openSelect(document.body.querySelector<HTMLElement>("button[role='combobox']")!);
    const warRoom = Array.from(document.body.querySelectorAll<HTMLElement>("[role='option']")).find((item) => item.textContent === "War Room")!;
    expect(warRoom.className).toContain("min-h-11");
    act(() => warRoom.click());
    expect(onChange).toHaveBeenCalledWith("war-room");
    act(() => root.unmount());
  });

  it("keeps long approval content available and preserves the shared desktop textarea baseline", () => {
    const long = "subject".repeat(80);
    const { container, root } = mount(
      <div>
        <ApprovalHeading label={long} id={long} />
        <ApprovalPayloadDisclosure type="unknown" payload={{ command: long }} />
        <ApprovalCommentInput value="" onChange={() => {}} />
      </div>,
    );
    const heading = container.querySelector("h2")!;
    expect(heading.className).toContain("[overflow-wrap:anywhere]");
    expect(container.querySelector('[aria-label^="Approval request summary"]')).not.toBeNull();
    const textarea = container.querySelector("textarea")!;
    expect(textarea.className).toContain("min-h-16");
    expect(textarea.className).not.toContain("sm:min-h-0");
    const disclosure = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => disclosure.click());
    expect(container.querySelector('pre[aria-label^="Full approval request"]')?.textContent).toContain(long);
    act(() => root.unmount());
  });
});

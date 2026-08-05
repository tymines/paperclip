// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ModelDropdown } from "./AgentConfigForm";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("./MarkdownEditor", () => ({ MarkdownEditor: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function ModelDropdownHarness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <ModelDropdown
      models={[
        { id: "openai/gpt-5.6-sol", label: "GPT-5.6 SOL" },
        { id: "moonshot/kimi-k3", label: "Kimi K3" },
      ]}
      value={value}
      onChange={setValue}
      open={open}
      onOpenChange={setOpen}
      allowDefault={false}
      required={false}
      groupByProvider
      creatable
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("opens the portaled model picker and clears search through an accessible phone-sized control", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => root.render(
    <TooltipProvider>
      <ModelDropdownHarness />
    </TooltipProvider>,
  ));
  const trigger = container.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')!;
  await act(async () => trigger.click());

  const portal = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!;
  expect(portal).not.toBeNull();
  const search = portal.querySelector<HTMLInputElement>('input[placeholder^="Search models"]')!;
  expect(search.className).toContain("min-h-11");
  expect(search.className).toContain("sm:min-h-0");
  await act(async () => {
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setInputValue.call(search, "kimi");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const clear = document.body.querySelector<HTMLButtonElement>('button[aria-label="Clear model search"]')!;
  expect(clear).not.toBeNull();
  expect(clear.className).toContain("h-11");
  expect(clear.className).toContain("w-11");
  expect(clear.className).toContain("sm:h-7");
  expect(clear.className).toContain("sm:w-7");
  await act(async () => clear.click());
  expect(search.value).toBe("");

  await act(async () => root.unmount());
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NewAgentFooterActions } from "./NewAgent";

vi.mock("../components/AgentConfigForm", () => ({
  AgentConfigForm: () => null,
  AdapterEnvironmentResult: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

it("mounts stacked phone actions and preserves cancel, test, and create interactions", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCancel = vi.fn();
  const onTest = vi.fn();
  const onCreate = vi.fn();

  act(() => root.render(
    <NewAgentFooterActions
      name="Athena"
      creating={false}
      testDisabled={false}
      testPending={false}
      onCancel={onCancel}
      onTest={onTest}
      onCreate={onCreate}
    />,
  ));

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  expect(buttons).toHaveLength(3);
  for (const button of buttons) {
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("sm:h-8");
  }
  act(() => buttons.forEach((button) => button.click()));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onTest).toHaveBeenCalledOnce();
  expect(onCreate).toHaveBeenCalledOnce();

  act(() => root.unmount());
});

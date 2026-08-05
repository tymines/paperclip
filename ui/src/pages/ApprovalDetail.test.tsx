// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ApprovalPayloadDisclosure } from "./ApprovalDetail";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

it("reveals a long approval payload in a labeled local scroller", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ApprovalPayloadDisclosure type="unknown" payload={{ command: "x".repeat(200) }} />));
  const button = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  expect(button?.className).toContain("min-h-11");
  expect(button?.className).toContain("sm:min-h-0");
  act(() => button?.click());
  expect(button?.getAttribute("aria-expanded")).toBe("true");
  const payload = container.querySelector<HTMLElement>("pre[aria-label]");
  expect(payload?.className).toContain("overflow-x-auto");
  expect(payload?.getAttribute("tabindex")).toBe("0");
  act(() => root.unmount());
});

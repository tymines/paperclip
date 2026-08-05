// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AgentDetailNavigation } from "./AgentDetail";

const mockSidebar = vi.hoisted(() => ({ isMobile: true }));

vi.mock("../components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => mockSidebar }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  mockSidebar.isMobile = true;
  document.body.innerHTML = "";
});

it("mounts the phone detail selector and changes the active Fleet section", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onValueChange = vi.fn();

  act(() => root.render(<AgentDetailNavigation value="dashboard" onValueChange={onValueChange} />));
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Page section"]')!;
  expect(select.className).toContain("h-11");
  expect(select.value).toBe("dashboard");
  act(() => {
    select.value = "runs";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onValueChange).toHaveBeenCalledWith("runs");

  act(() => root.unmount());
});

it("restores the desktop tab bar and its section interaction", () => {
  mockSidebar.isMobile = false;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onValueChange = vi.fn();

  act(() => root.render(<AgentDetailNavigation value="dashboard" onValueChange={onValueChange} />));
  expect(container.querySelector('select[aria-label="Page section"]')).toBeNull();
  const runs = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-slot='tabs-trigger']"))
    .find((button) => button.textContent === "Runs")!;
  act(() => runs.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  expect(onValueChange).toHaveBeenCalledWith("runs");

  act(() => root.unmount());
});

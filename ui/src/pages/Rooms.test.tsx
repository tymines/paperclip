// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Room } from "@paperclipai/shared";
import { afterEach, expect, it, vi } from "vitest";
import { RoomCard } from "./Rooms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens a room card with keyboard and preserves its phone-sized card target", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClick = vi.fn();
  const room = {
    id: "room-1",
    companyId: "company-1",
    name: "Planning room",
    description: "Coordinate the release",
    type: "collaboration",
    status: "active",
    createdAt: new Date("2026-08-05T00:00:00Z"),
  } as Room;

  act(() => root.render(<RoomCard room={room} onClick={onClick} />));
  const card = container.querySelector<HTMLElement>("[role='button']");
  expect(card?.className).toContain("p-5");
  act(() => card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onClick).toHaveBeenCalledOnce();
  act(() => root.unmount());
});

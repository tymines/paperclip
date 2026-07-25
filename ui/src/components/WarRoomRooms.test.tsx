// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WarRoomRooms } from "./WarRoomRooms";

const listRoomsMock = vi.hoisted(() => vi.fn());
const getRoomMock = vi.hoisted(() => vi.fn());
const listMessagesMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const createRoomMock = vi.hoisted(() => vi.fn());
const createIssueMock = vi.hoisted(() => vi.fn());
const listAgentsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/rooms", () => ({
  roomsApi: {
    list: (companyId: string) => listRoomsMock(companyId),
    get: (companyId: string, roomId: string) => getRoomMock(companyId, roomId),
    listMessages: (companyId: string, roomId: string, cursor?: string, limit?: number) =>
      listMessagesMock(companyId, roomId, cursor, limit),
    sendMessage: (companyId: string, roomId: string, data: unknown) =>
      sendMessageMock(companyId, roomId, data),
    create: (companyId: string, data: unknown) => createRoomMock(companyId, data),
  },
}));

vi.mock("@/api/issues", () => ({
  issuesApi: {
    create: (companyId: string, data: unknown) => createIssueMock(companyId, data),
  },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: {
    list: (companyId: string) => listAgentsMock(companyId),
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip" },
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("@/lib/router", () => ({
  useNavigate: () => navigateMock,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ROOMS = [
  {
    id: "room-a",
    companyId: "company-1",
    name: "launch-war-room",
    description: null,
    status: "active",
    type: "war-room",
    createdBy: null,
    completedAt: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  {
    id: "room-b",
    companyId: "company-1",
    name: "design-council",
    description: null,
    status: "active",
    type: "council",
    createdBy: null,
    completedAt: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
  },
];

const MESSAGES_BY_ROOM: Record<string, unknown[]> = {
  "room-a": [
    {
      id: "msg-a1",
      roomId: "room-a",
      senderId: "agent-1",
      senderType: "agent",
      senderName: "Zeus",
      content: "Spec draft is frozen and armed for gate.",
      messageType: "chat",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-07-25T10:00:00.000Z",
    },
  ],
  "room-b": [
    {
      id: "msg-b1",
      roomId: "room-b",
      senderId: "user-1",
      senderType: "user",
      senderName: null,
      content: "Council: pick the hero layout.",
      messageType: "chat",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-07-25T09:00:00.000Z",
    },
  ],
};

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

// useQueries settle over multiple ticks — flush until the condition holds.
async function flushUntil(cond: () => boolean, tries = 15) {
  for (let i = 0; i < tries && !cond(); i += 1) {
    await flushReact();
  }
}

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  });
  return { container, root, qc };
}

describe("WarRoomRooms", () => {
  beforeEach(() => {
    listRoomsMock.mockResolvedValue(ROOMS);
    getRoomMock.mockImplementation((_cid: string, roomId: string) =>
      Promise.resolve({
        ...ROOMS.find((r) => r.id === roomId),
        members: [{ id: "mem-1", roomId, agentId: "agent-1", userId: null, role: "member" }],
      }),
    );
    listMessagesMock.mockImplementation((_cid: string, roomId: string) =>
      Promise.resolve({ messages: MESSAGES_BY_ROOM[roomId] ?? [], hasMore: false, cursor: null }),
    );
    listAgentsMock.mockResolvedValue([{ id: "agent-1", name: "Zeus" }]);
    sendMessageMock.mockResolvedValue({ id: "msg-new" });
    createRoomMock.mockImplementation((_cid: string, data: { name: string }) =>
      Promise.resolve({ id: "room-new", name: data.name }),
    );
    createIssueMock.mockResolvedValue({ id: "issue-1", identifier: "AUG-99" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders every room lane simultaneously with live previews", async () => {
    const { container, root } = render(<WarRoomRooms />);
    await flushUntil(() => container.textContent?.includes("Spec draft is frozen") ?? false);

    // Both rooms visible at once — no click-through required (Tyler's lanes rule)
    expect(container.querySelector('[data-testid="room-lane-room-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="room-lane-room-b"]')).not.toBeNull();
    expect(container.textContent).toContain("launch-war-room");
    expect(container.textContent).toContain("design-council");

    // Live previews render inside each lane
    expect(container.textContent).toContain("Spec draft is frozen and armed for gate.");
    expect(container.textContent).toContain("Council: pick the hero layout.");
    expect(container.textContent).toContain("Zeus");

    act(() => root.unmount());
  });

  it("posts from a lane composer to that lane's room only", async () => {
    const { container, root } = render(<WarRoomRooms />);
    await flushUntil(() => !!container.querySelector('[data-testid="room-lane-room-b"]'));

    const laneB = container.querySelector('[data-testid="room-lane-room-b"]')!;
    const input = laneB.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "layout 2 wins");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith("company-1", "room-b", {
      content: "layout 2 wins",
      senderType: "user",
    });

    act(() => root.unmount());
  });

  it("promotes a message to the Kanban board as a durable handoff", async () => {
    const { container, root } = render(<WarRoomRooms />);
    await flushReact();

    const laneA = container.querySelector('[data-testid="room-lane-room-a"]')!;
    await flushUntil(() =>
      Array.from(laneA.querySelectorAll("button")).some(
        (b) => b.getAttribute("aria-label") === "Promote message to Kanban",
      ),
    );
    const handoffBtn = Array.from(laneA.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Promote message to Kanban",
    )!;
    await act(async () => {
      handoffBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    const [cid, payload] = createIssueMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cid).toBe("company-1");
    expect(payload.status).toBe("backlog");
    expect(String(payload.title)).toContain("Spec draft is frozen");
    expect(String(payload.description)).toContain("launch-war-room");
    expect(String(payload.description)).toContain("Zeus");

    act(() => root.unmount());
  });

  it("creates a new room from the header dialog", async () => {
    const { container, root } = render(<WarRoomRooms />);
    await flushReact();

    const newBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("New room"),
    )!;
    await act(async () => {
      newBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const nameInput = document.getElementById("war-room-rooms-name") as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(nameInput, "incident-response");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const createBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Create room",
    )!;
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(createRoomMock).toHaveBeenCalledTimes(1);
    const [cid, payload] = createRoomMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cid).toBe("company-1");
    expect(payload.name).toBe("incident-response");
    expect(payload.type).toBe("collaboration");

    act(() => root.unmount());
  });

  it("navigates to the full room page on Open", async () => {
    const { container, root } = render(<WarRoomRooms />);
    await flushUntil(() =>
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.getAttribute("aria-label") === "Open launch-war-room",
      ),
    );

    const openBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Open launch-war-room",
    )!;
    await act(async () => {
      openBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/rooms/room-a");

    act(() => root.unmount());
  });
});

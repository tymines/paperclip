// @vitest-environment jsdom
//
// ChatDrawer — the window that IS Calliope (Spec v1.4). Proves the request
// shape, the live-agent provenance chip, and the honest unavailable state.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDrawer } from "./ChatDrawer";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no scrollIntoView — ChatDrawer auto-scrolls on new messages.
Element.prototype.scrollIntoView = vi.fn();

let container: HTMLDivElement;
let root: Root;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function mount() {
  await act(async () => {
    root.render(
      <ChatDrawer
        bookId="book-1"
        companySlug="company-1"
        isOpen={true}
        onClose={() => {}}
        activeBookTitle="My Book"
      />,
    );
  });
}

async function sendMessage(text: string) {
  const input = container.querySelector("input")!;
  const buttons = container.querySelectorAll("button");
  const sendBtn = buttons[buttons.length - 1] as HTMLButtonElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    sendBtn.click();
  });
}

describe("ChatDrawer — Calliope window (Spec v1.4)", () => {
  it("loads history and posts the message to the book chat endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] })) // GET history
      .mockResolvedValueOnce(
        jsonResponse({ turnId: "turn-1", reply: "Ooh, tell me more!", messageId: "m2", userMessageId: "m1", status: "completed", via: "calliope", delegationId: "del-1" }),
      );

    await mount();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/companies/company-1/book-studio/books/book-1/chat");

    await sendMessage("Give me a twist for chapter 3");

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/companies/company-1/book-studio/books/book-1/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ message: "Give me a twist for chapter 3" });

    expect(container.textContent).toContain("Ooh, tell me more!");
  });

  it("shows the live-agent provenance chip when Calliope answers", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ turnId: "turn-1", reply: "A twist!", messageId: "m2", userMessageId: "m1", status: "completed", via: "calliope" }),
      );

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("via Calliope ✦ live agent");
    expect(container.textContent).not.toContain("model fallback");
  });

  it("shows an unavailable state instead of representing a model reply", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          error: "Calliope is unavailable. Your message was saved, but no reply was generated.",
          messageId: "m1",
          via: "none",
          agentLane: "unavailable",
          agentLaneError: "Book Studio calliope lane unavailable: peer unreachable (timeout)",
        }, 503),
      );

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("Calliope is unavailable. No reply was generated.");
    expect(container.textContent).not.toContain("model fallback");
    expect(container.textContent).not.toContain("via Calliope ✦ live agent");
  });

  it("surfaces a send failure instead of a fabricated reply", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "AI service temporarily unavailable", via: "none" }, 503));

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("Calliope is unavailable. No reply was generated.");
  });

  it("is titled as Calliope's window", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [] }));
    await mount();
    expect(container.textContent).toContain("Calliope — Brainstorm");
  });

  it("shows a visible reset error and keeps the transcript when archive reset fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        messages: [{
          turnId: "turn-existing",
          userMessage: "Keep this",
          reply: "Still here",
          messageId: "m2",
          userMessageId: "m1",
          createdAt: new Date().toISOString(),
          status: "completed",
          via: "calliope",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "reset unavailable" }, 503));
    vi.stubGlobal("confirm", vi.fn(() => true));

    await mount();
    const reset = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Reset chat"),
    ) as HTMLButtonElement;
    await act(async () => reset.click());

    expect(container.textContent).toContain("Chat reset could not be confirmed. The displayed transcript was not cleared");
    expect(container.textContent).toContain("Keep this");
    expect(container.textContent).toContain("Still here");
  });

  it("shows a visible error when the persisted history cannot be loaded", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "history unavailable" }, 503));
    await mount();
    expect(container.textContent).toContain("Chat history could not be loaded");
  });

  it("does not repopulate archived history when reset wins a pending history load", async () => {
    let resolveHistory!: (response: Response) => void;
    const pendingHistory = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    fetchMock
      .mockReturnValueOnce(pendingHistory)
      .mockResolvedValueOnce(jsonResponse({ messages: [], archivedCount: 1, activeCount: 0 }));
    vi.stubGlobal("confirm", vi.fn(() => true));

    await mount();
    const reset = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Reset chat"),
    ) as HTMLButtonElement;
    await act(async () => reset.click());

    await act(async () => {
      resolveHistory(jsonResponse({
        messages: [{
          turnId: "stale-turn",
          userMessage: "Stale question",
          reply: "Stale answer",
          messageId: "stale-a",
          userMessageId: "stale-u",
          createdAt: new Date().toISOString(),
          status: "completed",
          via: "calliope",
        }],
      }));
      await pendingHistory;
    });

    expect(container.textContent).not.toContain("Stale question");
    expect(container.textContent).not.toContain("Stale answer");
  });
});

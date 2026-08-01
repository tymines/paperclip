// @vitest-environment jsdom
//
// ChatDrawer — the window that IS Calliope (PR #30). Proves the request
// shape, the live-agent provenance chip, and the visible degraded failure
// (Tyler's law: no raw-model substitute is ever shown as Calliope).
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
  const sendBtn = container.querySelectorAll("button")[1] as HTMLButtonElement; // [close, send]
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    sendBtn.click();
  });
}

describe("ChatDrawer — Calliope window (PR #30)", () => {
  it("loads history and posts the message to the book chat endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] })) // GET history
      .mockResolvedValueOnce(
        jsonResponse({
          reply: "Ooh, tell me more!",
          messageId: "m2",
          userMessageId: "m1",
          provenance: { agent: "calliope", model: "sol", status: "live" },
          delegationId: "del-1",
        }),
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

  it("shows the live-agent provenance chip (with model) when Calliope answers", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          reply: "A twist!",
          messageId: "m2",
          userMessageId: "m1",
          provenance: { agent: "calliope", model: "sol", status: "live" },
        }),
      );

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("via Calliope ✦ live agent · sol");
    expect(container.textContent).not.toContain("degraded");
  });

  it("shows the visible degraded failure when Calliope is unreachable — no model substitute (Tyler's law)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Calliope is unreachable — no reply was generated (no raw-model substitute).",
            messageId: "m1",
            provenance: {
              agent: "calliope",
              model: null,
              status: "degraded",
              detail: "Book Studio calliope lane unavailable: peer unreachable (timeout)",
            },
          },
          502,
        ),
      );

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("Calliope is unreachable — no reply was generated (no raw-model substitute).");
    expect(container.textContent).toContain("Calliope unreachable — degraded, no model substitute");
    expect(container.textContent).not.toContain("via Calliope ✦ live agent");
  });

  it("surfaces a generic send failure instead of a fabricated reply", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    await mount();
    await sendMessage("hi");

    expect(container.textContent).toContain("Failed to get reply. Please try again.");
  });

  it("is titled as Calliope's window", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [] }));
    await mount();
    expect(container.textContent).toContain("Calliope — Brainstorm");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDrawer } from "./ChatDrawer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const turn = (overrides: Record<string, unknown> = {}) => ({ turnId: "turn-1", userMessage: "Question", reply: "Answer", messageId: "a-1", userMessageId: "u-1", createdAt: new Date().toISOString(), status: "completed", via: "calliope", ...overrides });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function flush() { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); }

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(props: Partial<ComponentProps<typeof ChatDrawer>> = {}) {
  await act(async () => root.render(<ChatDrawer bookId="book-1" companySlug="company-1" isOpen onClose={() => {}} activeBookTitle="My Book" {...props} />));
}
function setTextarea(value: string) {
  const textarea = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  return textarea;
}
async function send(value: string) {
  setTextarea(value);
  await act(async () => (container.querySelector('[aria-label="Send message"]') as HTMLButtonElement).click());
}

describe("ChatDrawer v4", () => {
  it("renders one honest loading status before a successful empty history, never blank reply cards", async () => {
    let resolveHistory!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveHistory = resolve; }));
    await render();
    expect(container.textContent).toContain("Loading conversation");
    expect(container.querySelectorAll(".bg-gray-800")).toHaveLength(0);
    await act(async () => resolveHistory(response({ messages: [] })));
    await flush();
    expect(container.textContent).toContain("Ask Calliope about this book");
    expect(container.textContent).not.toContain("Loading conversation");
  });

  it("uses dialog semantics and closes on Escape while returning focus", async () => {
    fetchMock.mockResolvedValue(response({ messages: [] }));
    const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
    const onClose = vi.fn(); await render({ onClose }); await flush();
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });

  it("is docked without a backdrop and keeps the editor outside the panel interactive", async () => {
    fetchMock.mockResolvedValue(response({ messages: [] })); await render();
    const panel = container.querySelector("[data-docked-chat]")!;
    expect(panel.tagName).toBe("ASIDE"); expect(panel.className).toContain("md:right-0");
    expect(container.querySelector("[data-chat-backdrop]")).toBeNull();
  });

  it("loads book-scoped history chronologically and posts to the same book", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ messages: [turn({ turnId: "old", userMessage: "First", reply: "One" })] }))
      .mockResolvedValueOnce(response({ ...turn(), reply: "Ooh, tell me more!" }))
      .mockResolvedValueOnce(response({ messages: [turn({ reply: "Ooh, tell me more!" })] }));
    await render(); await send("Give me a twist");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/companies/company-1/book-studio/books/book-1/chat");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ message: "Give me a twist" });
    expect(container.textContent).toContain("Ooh, tell me more!");
    expect(container.textContent).toContain("via Calliope ✦ live agent");
  });

  it("uses a three-line textarea; Enter sends and Shift+Enter preserves a newline", async () => {
    fetchMock.mockResolvedValue(response({ messages: [] })); await render();
    const textarea = setTextarea("line one");
    expect(textarea.rows).toBe(3); expect(textarea.className).toContain("max-h-[200px]");
    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response(turn())).mockResolvedValueOnce(response({ messages: [turn()] }));
    await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("disables whitespace sends and preserves a separate unsent draft for each book", async () => {
    fetchMock.mockResolvedValue(response({ messages: [] })); await render();
    setTextarea("   "); expect((container.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    setTextarea("draft one"); await flush();
    await render({ bookId: "book-2", activeBookTitle: "Other" }); await flush();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    setTextarea("draft two"); await render({ bookId: "book-1" }); await flush();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("draft one");
  });

  it("shows persisted pending/failed state and retries by durable turn id", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ messages: [turn({ status: "failed", reply: "", error: "peer offline" })] }))
      .mockResolvedValueOnce(response(turn()))
      .mockResolvedValueOnce(response({ messages: [turn()] }));
    await render();
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry"))!;
    await act(async () => (retry as HTMLButtonElement).click());
    expect(fetchMock.mock.calls[1][0]).toContain("/chat/turn-1/retry");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("does not offer a retry for an indeterminate delegation", async () => {
    fetchMock.mockResolvedValueOnce(response({ messages: [turn({ status: "failed", reply: "", retryable: false, error: "lane outcome unknown" })] }));
    await render();
    expect(container.textContent).toContain("cannot be retried safely");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Retry"))).toBe(false);
  });

  it("surfaces an honest Calliope failure and never labels a fallback as Calliope", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ messages: [] }))
      .mockResolvedValueOnce(response({ error: "Calliope is unavailable", status: "failed", via: "none" }, 503))
      .mockResolvedValueOnce(response({ messages: [turn({ status: "failed", reply: "", via: undefined, error: "Calliope is unavailable" })] }));
    await render(); await send("hello");
    expect(container.textContent).toContain("Calliope is unavailable");
    expect(container.textContent).not.toContain("model fallback");
    expect(container.textContent).not.toContain("via Calliope ✦ live agent");
  });

  it("disables reset while pending and archives only after confirmation", async () => {
    fetchMock.mockResolvedValueOnce(response({ messages: [turn({ status: "pending", reply: "" })] })); await render();
    let reset = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("New conversation")) as HTMLButtonElement;
    expect(reset.disabled).toBe(true); expect(reset.title).toContain("Wait for the active");
    fetchMock.mockResolvedValueOnce(response({ messages: [turn()] })); await act(async () => { root.unmount(); root = createRoot(container); }); await render();
    vi.stubGlobal("confirm", vi.fn(() => true)); fetchMock.mockResolvedValueOnce(response({ archivedCount: 2, messages: [] }));
    reset = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("New conversation")) as HTMLButtonElement;
    await act(async () => reset.click());
    expect(fetchMock.mock.calls.at(-1)![0]).toContain("/chat/reset");
  });

  it("opens a read-only, book-scoped archive view grouped by date", async () => {
    fetchMock.mockResolvedValueOnce(response({ messages: [] })).mockResolvedValueOnce(response({ archives: [{ archivedAt: "2026-08-04T12:00:00.000Z", messages: [turn({ userMessage: "Archived question", reply: "Archived answer" })] }] }));
    await render();
    const history = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("History"))!;
    await act(async () => (history as HTMLButtonElement).click());
    expect(fetchMock.mock.calls[1][0]).toContain("/chat/archives");
    expect(container.textContent).toContain("Archived question"); expect(container.textContent).toContain("Archived answer");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("keeps an in-flight turn bound to its originating book when props switch", async () => {
    let resolvePost!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response({ messages: [] })).mockReturnValueOnce(new Promise((resolve) => { resolvePost = resolve; }));
    await render();
    setTextarea("for book one");
    act(() => (container.querySelector('[aria-label="Send message"]') as HTMLButtonElement).click());
    await flush();
    fetchMock.mockResolvedValueOnce(response({ messages: [] })); await render({ bookId: "book-2", activeBookTitle: "Two" });
    setTextarea("for book two");
    expect((container.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolvePost(response(turn({ reply: "Book one answer" })))); await flush();
    expect(container.textContent).not.toContain("Book one answer"); expect(container.textContent).toContain("Two");
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexPanel } from "./CodexPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const persisted = {
  id: "lore-1", name: "Persisted name", summary: "Persisted summary", details: {},
  locked: false, source: "authored", updatedAt: "2026-08-08T12:00:00.000Z",
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? "Conflict" : "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CodexPanel editing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows a labelled Edit action in every Codex section", async () => {
    const relationship = {
      id: "rel-1", bookId: "book-1", fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "location", toEntityId: "w-1", type: "knows", arcStage: "open",
      meter: 0, rules: [], locked: false, updatedAt: persisted.updatedAt,
    };
    const fact = {
      id: "fact-1", bookId: "book-1", statement: "Known fact", knownAsOf: 1,
      provenance: "authored", locked: false, entityRefs: [], updatedAt: persisted.updatedAt,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("codex-relationships")) return response({ available: true, relationships: [relationship] });
      if (url.includes("codex-facts")) return response({ available: true, known: [fact], withheld: [] });
      return response({ available: true, entities: [persisted] });
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const section of ["lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary", "relationships", "facts"] as const) {
      await act(async () => root.render(<CodexPanel bookId="book-1" companySlug="co-1" activeSection={section} showSectionPicker={false} />));
      await flush();
      expect([...host.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Edit"), section).toBe(true);
    }
  });

  it("keeps Edit visible and Cancel restores persisted values without a request", async () => {
    const fetchMock = vi.fn(async () => response({ available: true, entities: [persisted] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CodexPanel bookId="book-1" companySlug="co-1" activeSection="lore" showSectionPicker={false} />));
    await flush();

    const edit = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!;
    expect(edit).toBeTruthy();
    await act(async () => edit.click());
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await act(async () => changeInput(name, "Unsaved"));
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Cancel")!;
    await act(async () => cancel.click());

    expect(host.textContent).toContain("Persisted name");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains the draft after a failed Save and adopts the exact returned row after success", async () => {
    const returned = { ...persisted, name: "Server normalized", summary: "Saved", updatedAt: "2026-08-08T12:01:00.000Z" };
    let patchAttempt = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patchAttempt += 1;
        return patchAttempt === 1 ? response({ error: "stale" }, 409) : response({ available: true, entity: returned });
      }
      return response({ available: true, entities: [persisted] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CodexPanel bookId="book-1" companySlug="co-1" activeSection="lore" showSectionPicker={false} />));
    await flush();

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!.click());
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await act(async () => changeInput(name, "Draft survives"));
    let save = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save")!;
    await act(async () => save.click());
    await flush();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.value).toBe("Draft survives");
    expect(host.textContent).toContain("stale");

    save = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save")!;
    await act(async () => save.click());
    await flush();
    expect(host.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(host.textContent).toContain("Server normalized");
  });

  it("discards an unsaved draft when the section or book changes", async () => {
    const fetchMock = vi.fn(async () => response({ available: true, entities: [persisted] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CodexPanel bookId="book-1" companySlug="co-1" activeSection="lore" showSectionPicker={false} />));
    await flush();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!.click());
    expect(host.querySelector('input[aria-label="Name"]')).not.toBeNull();

    await act(async () => root.render(<CodexPanel bookId="book-2" companySlug="co-1" activeSection="themes" showSectionPicker={false} />));
    await flush();
    expect(host.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(host.textContent).toContain("Persisted name");
  });
});

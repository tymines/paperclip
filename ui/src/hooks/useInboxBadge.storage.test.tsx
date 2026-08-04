// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISSED_KEYS, READ_ITEMS_KEYS } from "../lib/inbox";
import { useDismissedInboxAlerts, useReadInboxItems } from "./useInboxBadge";

function DismissedProbe() {
  const { dismissed } = useDismissedInboxAlerts();
  return <div data-value={[...dismissed].join(",")} />;
}

function ReadItemsProbe() {
  const { readItems } = useReadInboxItems();
  return <div data-value={[...readItems].join(",")} />;
}

describe("inbox storage event compatibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function render(probe: "dismissed" | "read") {
    await act(async () => {
      root.render(probe === "dismissed" ? <DismissedProbe /> : <ReadItemsProbe />);
    });
  }

  async function dispatchAndRefresh(...keys: string[]) {
    await act(async () => {
      for (const key of keys) {
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }
      vi.runOnlyPendingTimers();
    });
  }

  it.each([
    ["dismissed canonical", "dismissed", DISMISSED_KEYS.canonical, DISMISSED_KEYS.canonical, "alert:canonical"],
    ["dismissed compatibility", "dismissed", DISMISSED_KEYS.compatibility, DISMISSED_KEYS.compatibility, "alert:legacy"],
    ["read canonical", "read", READ_ITEMS_KEYS.canonical, READ_ITEMS_KEYS.canonical, "issue:canonical"],
    ["read compatibility", "read", READ_ITEMS_KEYS.compatibility, READ_ITEMS_KEYS.compatibility, "issue:legacy"],
  ] as const)("accepts the %s key without writing from the handler", async (_name, probe, storageKey, eventKey, value) => {
    await render(probe);
    localStorage.setItem(storageKey, JSON.stringify([value]));
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await dispatchAndRefresh(eventKey);

    expect(container.firstElementChild?.getAttribute("data-value")).toBe(value);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("falls back from invalid canonical data to sanitized compatibility data for a paired batch", async () => {
    await render("dismissed");
    const invalidCanonical = JSON.stringify({ bad: true });
    const mixedCompatibility = JSON.stringify(["alert:legacy-update", "not-an-alert", 42]);
    localStorage.setItem(DISMISSED_KEYS.canonical, invalidCanonical);
    localStorage.setItem(DISMISSED_KEYS.compatibility, mixedCompatibility);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await dispatchAndRefresh(DISMISSED_KEYS.compatibility, DISMISSED_KEYS.canonical);

    expect(container.firstElementChild?.getAttribute("data-value")).toBe("alert:legacy-update");
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(getItem).toHaveBeenNthCalledWith(1, DISMISSED_KEYS.canonical);
    expect(getItem).toHaveBeenNthCalledWith(2, DISMISSED_KEYS.compatibility);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISMISSED_KEYS.canonical)).toBe(invalidCanonical);
    expect(localStorage.getItem(DISMISSED_KEYS.compatibility)).toBe(mixedCompatibility);
  });

  it.each([
    ["dismissed", "dismissed", DISMISSED_KEYS, "alert:stale", "alert:legacy-update"],
    ["read", "read", READ_ITEMS_KEYS, "issue:stale", "issue:legacy-update"],
  ] as const)("uses a legacy-only %s event even when canonical storage is stale but valid", async (
    _name,
    probe,
    keys,
    staleValue,
    legacyValue,
  ) => {
    await render(probe);
    localStorage.setItem(keys.canonical, JSON.stringify([staleValue]));
    localStorage.setItem(keys.compatibility, JSON.stringify([legacyValue]));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await dispatchAndRefresh(keys.compatibility);

    expect(container.firstElementChild?.getAttribute("data-value")).toBe(legacyValue);
    expect(getItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledWith(keys.compatibility);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([
    ["dismissed", "dismissed", DISMISSED_KEYS.canonical, "alert:updated"],
    ["read", "read", READ_ITEMS_KEYS.canonical, "issue:updated"],
  ] as const)("ignores unrelated keys for %s state", async (_name, probe, storageKey, value) => {
    await render(probe);
    localStorage.setItem(storageKey, JSON.stringify([value]));

    await dispatchAndRefresh("olympus:inbox:unrelated");

    expect(container.firstElementChild?.getAttribute("data-value")).toBe("");
  });

  it.each([
    ["dismissed compatibility-first", "dismissed", DISMISSED_KEYS, "alert:canonical", "alert:legacy", "compatibility-first"],
    ["dismissed canonical-first", "dismissed", DISMISSED_KEYS, "alert:canonical", "alert:legacy", "canonical-first"],
    ["read compatibility-first", "read", READ_ITEMS_KEYS, "issue:canonical", "issue:legacy", "compatibility-first"],
    ["read canonical-first", "read", READ_ITEMS_KEYS, "issue:canonical", "issue:legacy", "canonical-first"],
  ] as const)("coalesces conflicting paired same-tick %s events and chooses canonical", async (
    _name,
    probe,
    keys,
    canonicalValue,
    compatibilityValue,
    order,
  ) => {
    await render(probe);
    localStorage.setItem(keys.canonical, JSON.stringify([canonicalValue]));
    localStorage.setItem(keys.compatibility, JSON.stringify([compatibilityValue]));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await dispatchAndRefresh(...(order === "canonical-first"
      ? [keys.canonical, keys.compatibility]
      : [keys.compatibility, keys.canonical]));

    expect(container.firstElementChild?.getAttribute("data-value")).toBe(canonicalValue);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith(keys.canonical);
    expect(setItem).not.toHaveBeenCalled();
  });
});

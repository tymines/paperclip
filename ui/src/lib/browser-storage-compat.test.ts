import { describe, expect, it, vi } from "vitest";
import {
  buildBrowserStorageKeys,
  getBrowserStorage,
  isBrowserStorageKey,
  readBrowserStorageIdentity,
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from "./browser-storage-compat";

const codec = {
  decode: (raw: string) => raw === "valid" ? raw : undefined,
  encode: (value: string) => value,
};

function createStorage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: vi.fn((key: string) => entries.delete(key)),
  };
}

function restoreLocalStorageDescriptor(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, "localStorage", descriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

describe("browser storage compatibility", () => {
  const keys = buildBrowserStorageKeys(":", "inbox:test");

  it("constructs exact keys from the shared product slugs", () => {
    expect(keys).toEqual({
      canonical: "olympus:inbox:test",
      compatibility: "paperclip:inbox:test",
    });
    expect(buildBrowserStorageKeys(".", "selectedCompanyId")).toEqual({
      canonical: "olympus.selectedCompanyId",
      compatibility: "paperclip.selectedCompanyId",
    });
  });

  it("returns null when global storage is absent or its property getter throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Reflect.deleteProperty(globalThis, "localStorage");
      expect(getBrowserStorage()).toBeNull();

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
          throw new Error("storage access blocked");
        },
      });
      expect(getBrowserStorage()).toBeNull();
    } finally {
      restoreLocalStorageDescriptor(descriptor);
    }
  });

  it("returns defaults and makes writes and removals no-ops without storage", () => {
    const encode = vi.fn(String);

    expect(readBrowserStorageValue(null, keys, codec)).toBeUndefined();
    expect(readBrowserStorageIdentity(undefined, keys, "canonical", codec.decode)).toBeUndefined();
    expect(() => writeBrowserStorageValue(null, keys, "valid", encode)).not.toThrow();
    expect(() => removeBrowserStorageValue(undefined, keys)).not.toThrow();
    expect(encode).not.toHaveBeenCalled();
  });

  it("prefers a valid canonical value without touching compatibility storage", () => {
    const storage = createStorage({
      [keys.canonical]: "valid",
      [keys.compatibility]: "valid",
    });

    expect(readBrowserStorageValue(storage, keys, codec)).toBe("valid");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("copies a valid compatibility value forward without deleting it", () => {
    const storage = createStorage({ [keys.compatibility]: "valid" });

    expect(readBrowserStorageValue(storage, keys, codec)).toBe("valid");
    expect(storage.entries.get(keys.canonical)).toBe("valid");
    expect(storage.entries.get(keys.compatibility)).toBe("valid");
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("falls back from invalid canonical data and rejects invalid compatibility data", () => {
    const fallbackStorage = createStorage({
      [keys.canonical]: "invalid",
      [keys.compatibility]: "valid",
    });
    expect(readBrowserStorageValue(fallbackStorage, keys, codec)).toBe("valid");

    const invalidStorage = createStorage({ [keys.compatibility]: "invalid" });
    expect(readBrowserStorageValue(invalidStorage, keys, codec)).toBeUndefined();
    expect(invalidStorage.setItem).not.toHaveBeenCalled();
  });

  it("isolates canonical and compatibility read and copy-forward failures", () => {
    const storage = createStorage({ [keys.compatibility]: "valid" });
    storage.getItem.mockImplementation((key: string) => {
      if (key === keys.canonical) throw new Error("canonical read blocked");
      return storage.entries.get(key) ?? null;
    });
    storage.setItem.mockImplementation(() => {
      throw new Error("canonical write blocked");
    });

    expect(readBrowserStorageValue(storage, keys, codec)).toBe("valid");
    expect(storage.entries.get(keys.compatibility)).toBe("valid");
  });

  it("returns safely when compatibility storage cannot be read", () => {
    const storage = createStorage();
    storage.getItem.mockImplementation((key: string) => {
      if (key === keys.compatibility) throw new Error("compatibility read blocked");
      return null;
    });

    expect(readBrowserStorageValue(storage, keys, codec)).toBeUndefined();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("can read for an event refresh without writing", () => {
    const storage = createStorage({ [keys.compatibility]: "valid" });

    expect(readBrowserStorageValue(storage, keys, codec, { copyForward: false })).toBe("valid");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("reads one exact identity without consulting or writing the other", () => {
    const storage = createStorage({
      [keys.canonical]: "valid",
      [keys.compatibility]: "invalid",
    });

    expect(readBrowserStorageIdentity(storage, keys, "compatibility", codec.decode)).toBeUndefined();
    expect(storage.getItem).toHaveBeenCalledOnce();
    expect(storage.getItem).toHaveBeenCalledWith(keys.compatibility);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("writes canonical first and isolates failures for either key", () => {
    const calls: string[] = [];
    const storage = {
      setItem: vi.fn((key: string) => {
        calls.push(key);
        if (key === keys.canonical) throw new Error("blocked");
      }),
    };

    writeBrowserStorageValue(storage, keys, "valid", String);
    expect(calls).toEqual([keys.canonical, keys.compatibility]);

    const entries = new Map<string, string>();
    const compatibilityFailure = {
      setItem: vi.fn((key: string, value: string) => {
        if (key === keys.compatibility) throw new Error("blocked");
        entries.set(key, value);
      }),
    };
    expect(() => writeBrowserStorageValue(compatibilityFailure, keys, "valid", String)).not.toThrow();
    expect(entries.get(keys.canonical)).toBe("valid");
  });

  it("removes both keys independently for explicit semantic clearing", () => {
    const calls: string[] = [];
    const storage = {
      removeItem: vi.fn((key: string) => {
        calls.push(key);
        if (key === keys.canonical) throw new Error("blocked");
      }),
    };

    removeBrowserStorageValue(storage, keys);
    expect(calls).toEqual([keys.canonical, keys.compatibility]);
  });

  it("matches only exact canonical and compatibility keys", () => {
    expect(isBrowserStorageKey(keys.canonical, keys)).toBe(true);
    expect(isBrowserStorageKey(keys.compatibility, keys)).toBe(true);
    expect(isBrowserStorageKey(`${keys.canonical}:extra`, keys)).toBe(false);
    expect(isBrowserStorageKey(null, keys)).toBe(false);
  });
});

import { PRODUCT_IDENTIFIERS } from "@paperclipai/shared/brand";

export interface BrowserStorageKeys {
  canonical: string;
  compatibility: string;
}

export interface BrowserStorageCodec<T> {
  decode: (raw: string) => T | undefined;
  encode: (value: T) => string;
}

export type BrowserStorageIdentity = keyof BrowserStorageKeys;

type ReadableBrowserStorage = Pick<Storage, "getItem" | "setItem">;
type WritableBrowserStorage = Pick<Storage, "setItem">;
type RemovableBrowserStorage = Pick<Storage, "removeItem">;

export function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function buildBrowserStorageKeys(
  separator: "." | ":",
  suffix: string,
): BrowserStorageKeys {
  return {
    canonical: `${PRODUCT_IDENTIFIERS.canonical.slug}${separator}${suffix}`,
    compatibility: `${PRODUCT_IDENTIFIERS.compatibility.slug}${separator}${suffix}`,
  };
}

function readDecoded<T>(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
  decode: BrowserStorageCodec<T>["decode"],
): T | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : decode(raw);
  } catch {
    return undefined;
  }
}

export function readBrowserStorageIdentity<T>(
  storage: Pick<Storage, "getItem"> | null | undefined,
  keys: BrowserStorageKeys,
  identity: BrowserStorageIdentity,
  decode: BrowserStorageCodec<T>["decode"],
): T | undefined {
  return readDecoded(storage, keys[identity], decode);
}

export function readBrowserStorageValue<T>(
  storage: ReadableBrowserStorage | null | undefined,
  keys: BrowserStorageKeys,
  codec: BrowserStorageCodec<T>,
  options: { copyForward?: boolean } = {},
): T | undefined {
  if (!storage) return undefined;
  const canonicalValue = readDecoded(storage, keys.canonical, codec.decode);
  if (canonicalValue !== undefined) return canonicalValue;

  const compatibilityValue = readDecoded(storage, keys.compatibility, codec.decode);
  if (compatibilityValue === undefined) return undefined;

  if (options.copyForward !== false) {
    try {
      storage.setItem(keys.canonical, codec.encode(compatibilityValue));
    } catch {
      // The compatibility value remains readable when canonical storage is restricted.
    }
  }
  return compatibilityValue;
}

export function writeBrowserStorageValue<T>(
  storage: WritableBrowserStorage | null | undefined,
  keys: BrowserStorageKeys,
  value: T,
  encode: (value: T) => string,
): void {
  if (!storage) return;
  let raw: string;
  try {
    raw = encode(value);
  } catch {
    return;
  }
  try {
    storage.setItem(keys.canonical, raw);
  } catch {
    // Continue so rollback-compatible storage still has a chance to succeed.
  }
  try {
    storage.setItem(keys.compatibility, raw);
  } catch {
    // Canonical storage may still have succeeded.
  }
}

export function removeBrowserStorageValue(
  storage: RemovableBrowserStorage | null | undefined,
  keys: BrowserStorageKeys,
): void {
  if (!storage) return;
  try {
    storage.removeItem(keys.canonical);
  } catch {
    // Continue so the compatibility key is still cleared when possible.
  }
  try {
    storage.removeItem(keys.compatibility);
  } catch {
    // Canonical removal may still have succeeded.
  }
}

export function isBrowserStorageKey(
  key: string | null,
  keys: BrowserStorageKeys,
): boolean {
  return key === keys.canonical || key === keys.compatibility;
}

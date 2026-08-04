import { beforeEach, describe, expect, it } from "vitest";
import {
  getRememberedPathOwnerCompanyId,
  sanitizeRememberedPathForCompany,
} from "../lib/company-page-memory";
import {
  COMPANY_PATHS_STORAGE_KEYS,
  getCompanyPaths,
  saveCompanyPath,
} from "./useCompanyPageMemory";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
});

beforeEach(() => {
  localStorage.clear();
});

const companies = [
  { id: "for", issuePrefix: "FOR" },
  { id: "pap", issuePrefix: "PAP" },
];

describe("getRememberedPathOwnerCompanyId", () => {
  it("uses the route company instead of stale selected-company state for prefixed routes", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/FOR/issues/FOR-1",
        fallbackCompanyId: "pap",
      }),
    ).toBe("for");
  });

  it("skips saving when a prefixed route cannot yet be resolved to a known company", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies: [],
        pathname: "/FOR/issues/FOR-1",
        fallbackCompanyId: "pap",
      }),
    ).toBeNull();
  });

  it("falls back to the previous company for unprefixed board routes", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/dashboard",
        fallbackCompanyId: "pap",
      }),
    ).toBe("pap");
  });

  it("treats unprefixed skills routes as board routes instead of company prefixes", () => {
    expect(
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: "/skills/skill-123/files/SKILL.md",
        fallbackCompanyId: "pap",
      }),
    ).toBe("pap");
  });
});

describe("sanitizeRememberedPathForCompany", () => {
  it("keeps remembered issue paths that belong to the target company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/issues/PAP-12",
        companyPrefix: "PAP",
      }),
    ).toBe("/issues/PAP-12");
  });

  it("falls back to dashboard for remembered issue identifiers from another company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/issues/FOR-1",
        companyPrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("falls back to dashboard when no remembered path exists", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: null,
        companyPrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("keeps remembered skills paths intact for the target company", () => {
    expect(
      sanitizeRememberedPathForCompany({
        path: "/skills/skill-123/files/SKILL.md",
        companyPrefix: "PAP",
      }),
    ).toBe("/skills/skill-123/files/SKILL.md");
  });
});

describe("company page-memory storage compatibility", () => {
  it("migrates valid legacy JSON without deleting it", () => {
    const raw = JSON.stringify({ pap: "/issues/PAP-12?tab=activity" });
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.compatibility, raw);

    expect(getCompanyPaths()).toEqual({ pap: "/issues/PAP-12?tab=activity" });
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEYS.canonical)).toBe(raw);
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEYS.compatibility)).toBe(raw);
  });

  it("prefers valid canonical JSON", () => {
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.canonical, JSON.stringify({ pap: "/dashboard" }));
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.compatibility, JSON.stringify({ pap: "/issues/PAP-1" }));

    expect(getCompanyPaths()).toEqual({ pap: "/dashboard" });
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEYS.compatibility)).toBe(
      JSON.stringify({ pap: "/issues/PAP-1" }),
    );
  });

  it("falls back from malformed canonical data and defaults when neither value is valid", () => {
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.canonical, JSON.stringify(["/dashboard"]));
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.compatibility, JSON.stringify({ pap: "/dashboard" }));
    expect(getCompanyPaths()).toEqual({ pap: "/dashboard" });

    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.canonical, JSON.stringify({ pap: "https://example.com" }));
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEYS.compatibility, "not-json");
    expect(getCompanyPaths()).toEqual({});
  });

  it("writes canonical first and keeps the compatibility map current", () => {
    saveCompanyPath("pap", "/issues/PAP-12");

    const expected = JSON.stringify({ pap: "/issues/PAP-12" });
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEYS.canonical)).toBe(expected);
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEYS.compatibility)).toBe(expected);
  });
});

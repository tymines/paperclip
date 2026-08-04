// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { queryKeys } from "../lib/queryKeys";
import {
  CompanyProvider,
  resolveBootstrapCompanySelection,
  SELECTED_COMPANY_STORAGE_KEYS,
  shouldClearStoredCompanySelection,
  useCompany,
} from "./CompanyContext";

const mockCompaniesApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

const activeCompany = { id: "company-1" };
const secondActiveCompany = { id: "company-2" };
const archivedCompany = { id: "archived-company" };

function makeCompany(id: string): Company {
  return {
    id,
    name: "Paperclip",
    description: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "PAP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 10 * 1024 * 1024,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function Probe({ onSelectedCompanyId }: { onSelectedCompanyId: (companyId: string | null) => void }) {
  const { selectedCompanyId } = useCompany();
  useEffect(() => {
    onSelectedCompanyId(selectedCompanyId);
  }, [onSelectedCompanyId, selectedCompanyId]);
  return <div data-selected-company-id={selectedCompanyId ?? ""} />;
}

describe("resolveBootstrapCompanySelection", () => {
  it("does not expose a stale stored company id before companies load", () => {
    expect(resolveBootstrapCompanySelection({
      companies: [],
      sidebarCompanies: [],
      selectedCompanyId: null,
      storedCompanyId: "stale-company",
    })).toBeNull();
  });

  it("replaces a stale stored company id with the first loaded company", () => {
    expect(resolveBootstrapCompanySelection({
      companies: [activeCompany],
      sidebarCompanies: [activeCompany],
      selectedCompanyId: null,
      storedCompanyId: "stale-company",
    })).toBe("company-1");
  });

  it("keeps a valid selected company ahead of stored bootstrap state", () => {
    expect(resolveBootstrapCompanySelection({
      companies: [activeCompany],
      sidebarCompanies: [activeCompany],
      selectedCompanyId: "company-1",
      storedCompanyId: "stale-company",
    })).toBe("company-1");
  });

  it("keeps a valid stored company id instead of falling back to the first company", () => {
    expect(resolveBootstrapCompanySelection({
      companies: [activeCompany, secondActiveCompany],
      sidebarCompanies: [activeCompany, secondActiveCompany],
      selectedCompanyId: null,
      storedCompanyId: "company-2",
    })).toBe("company-2");
  });

  it("uses selectable sidebar companies before archived companies", () => {
    expect(resolveBootstrapCompanySelection({
      companies: [archivedCompany, activeCompany],
      sidebarCompanies: [activeCompany],
      selectedCompanyId: null,
      storedCompanyId: "archived-company",
    })).toBe("company-1");
  });
});

describe("shouldClearStoredCompanySelection", () => {
  it("does not clear the stored company selection during an unauthorized company list response", () => {
    expect(shouldClearStoredCompanySelection({
      companies: [],
      isLoading: false,
      unauthorized: true,
    })).toBe(false);
  });

  it("clears the stored company selection when an authorized company list is empty", () => {
    expect(shouldClearStoredCompanySelection({
      companies: [],
      isLoading: false,
      unauthorized: false,
    })).toBe(true);
  });
});

describe("CompanyProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("does not expose a stale stored company id before companies load", async () => {
    localStorage.setItem("paperclip.selectedCompanyId", "stale-company");
    mockCompaniesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyProvider>
            <Probe onSelectedCompanyId={(companyId) => seen.push(companyId)} />
          </CompanyProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null]);
  });

  it("replaces a stale stored company id with the first loaded company", async () => {
    localStorage.setItem("paperclip.selectedCompanyId", "stale-company");
    queryClient.setQueryData(queryKeys.companies.all, {
      companies: [makeCompany("company-1")],
      unauthorized: false,
    });
    mockCompaniesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyProvider>
            <Probe onSelectedCompanyId={(companyId) => seen.push(companyId)} />
          </CompanyProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null, "company-1"]);
    expect(localStorage.getItem("paperclip.selectedCompanyId")).toBe("company-1");
    expect(localStorage.getItem("olympus.selectedCompanyId")).toBe("company-1");
  });

  it("prefers a valid canonical company selection", async () => {
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.canonical, "company-2");
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility, "company-1");
    queryClient.setQueryData(queryKeys.companies.all, {
      companies: [makeCompany("company-1"), makeCompany("company-2")],
      unauthorized: false,
    });
    mockCompaniesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyProvider>
            <Probe onSelectedCompanyId={(companyId) => seen.push(companyId)} />
          </CompanyProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null, "company-2"]);
    expect(localStorage.getItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility)).toBe("company-2");
  });

  it("falls back from a stale canonical selection and copies valid legacy state forward", async () => {
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.canonical, "stale-company");
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility, "company-2");
    queryClient.setQueryData(queryKeys.companies.all, {
      companies: [makeCompany("company-1"), makeCompany("company-2")],
      unauthorized: false,
    });
    mockCompaniesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyProvider>
            <Probe onSelectedCompanyId={(companyId) => seen.push(companyId)} />
          </CompanyProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null, "company-2"]);
    expect(localStorage.getItem(SELECTED_COMPANY_STORAGE_KEYS.canonical)).toBe("company-2");
    expect(localStorage.getItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility)).toBe("company-2");
  });

  it("removes both company selection keys when the authorized company list is empty", async () => {
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.canonical, "company-1");
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility, "company-1");
    queryClient.setQueryData(queryKeys.companies.all, {
      companies: [],
      unauthorized: false,
    });
    mockCompaniesApi.list.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyProvider>
            <Probe onSelectedCompanyId={() => {}} />
          </CompanyProvider>
        </QueryClientProvider>,
      );
    });

    expect(localStorage.getItem(SELECTED_COMPANY_STORAGE_KEYS.canonical)).toBeNull();
    expect(localStorage.getItem(SELECTED_COMPANY_STORAGE_KEYS.compatibility)).toBeNull();
  });
});

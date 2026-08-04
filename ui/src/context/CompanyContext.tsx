import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { companiesApi } from "../api/companies";
import { ApiError } from "../api/client";
import {
  buildBrowserStorageKeys,
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from "../lib/browser-storage-compat";
import { queryKeys } from "../lib/queryKeys";
import type { CompanySelectionSource } from "../lib/company-selection";
type CompanySelectionOptions = { source?: CompanySelectionSource };
type CompanyListResult = { companies: Company[]; unauthorized: boolean };

interface CompanyContextValue {
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  selectionSource: CompanySelectionSource;
  loading: boolean;
  error: Error | null;
  setSelectedCompanyId: (companyId: string, options?: CompanySelectionOptions) => void;
  reloadCompanies: () => Promise<void>;
  createCompany: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Company>;
}

export const SELECTED_COMPANY_STORAGE_KEYS = buildBrowserStorageKeys(".", "selectedCompanyId");

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function resolveBootstrapCompanySelection(input: {
  companies: Array<Pick<Company, "id">>;
  sidebarCompanies: Array<Pick<Company, "id">>;
  selectedCompanyId: string | null;
  storedCompanyId: string | null;
}) {
  if (input.companies.length === 0) return null;

  const selectableCompanies = input.sidebarCompanies.length > 0
    ? input.sidebarCompanies
    : input.companies;
  if (input.selectedCompanyId && selectableCompanies.some((company) => company.id === input.selectedCompanyId)) {
    return input.selectedCompanyId;
  }
  if (input.storedCompanyId && selectableCompanies.some((company) => company.id === input.storedCompanyId)) {
    return input.storedCompanyId;
  }
  return selectableCompanies[0]?.id ?? null;
}

export function shouldClearStoredCompanySelection(input: {
  companies: Array<Pick<Company, "id">>;
  isLoading: boolean;
  unauthorized: boolean;
}) {
  return !input.isLoading && !input.unauthorized && input.companies.length === 0;
}

function readStoredCompanySelection(selectableCompanyIds: ReadonlySet<string>): string | null {
  return readBrowserStorageValue(localStorage, SELECTED_COMPANY_STORAGE_KEYS, {
    decode: (raw) => selectableCompanyIds.has(raw) ? raw : undefined,
    encode: String,
  }) ?? null;
}

function saveStoredCompanySelection(companyId: string): void {
  writeBrowserStorageValue(localStorage, SELECTED_COMPANY_STORAGE_KEYS, companyId, String);
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] = useState<CompanySelectionSource>("bootstrap");
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);

  const { data: companiesResult = { companies: [], unauthorized: false }, isLoading, error } = useQuery<CompanyListResult>({
    queryKey: queryKeys.companies.all,
    queryFn: async () => {
      try {
        return { companies: await companiesApi.list(), unauthorized: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return { companies: [], unauthorized: true };
        }
        throw err;
      }
    },
    retry: false,
  });
  // Defense in depth: if another component populates this query key with a raw
  // Company[] (legacy shape) or a malformed payload, fall back to a safe shape
  // instead of letting `.filter` crash and black-screen the app.
  const companies = Array.isArray(companiesResult?.companies)
    ? companiesResult.companies
    : Array.isArray(companiesResult as unknown as Company[])
      ? (companiesResult as unknown as Company[])
      : [];
  const companyListUnauthorized = Boolean(companiesResult?.unauthorized);
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies],
  );

  // Auto-select first company when list loads
  useEffect(() => {
    if (isLoading) return;
    if (companies.length === 0) {
      if (shouldClearStoredCompanySelection({ companies, isLoading: false, unauthorized: companyListUnauthorized })) {
        if (selectedCompanyId !== null) {
          setSelectedCompanyIdState(null);
        }
        removeBrowserStorageValue(localStorage, SELECTED_COMPANY_STORAGE_KEYS);
      }
      return;
    }

    const selectableCompanyIds = new Set(sidebarCompanies.length > 0
      ? sidebarCompanies.map((company) => company.id)
      : companies.map((company) => company.id));
    const next = resolveBootstrapCompanySelection({
      companies,
      sidebarCompanies,
      selectedCompanyId,
      storedCompanyId: readStoredCompanySelection(selectableCompanyIds),
    });
    if (next === null || next === selectedCompanyId) return;
    setSelectedCompanyIdState(next);
    setSelectionSource("bootstrap");
    saveStoredCompanySelection(next);
  }, [companies, companyListUnauthorized, isLoading, selectedCompanyId, sidebarCompanies]);

  const setSelectedCompanyId = useCallback((companyId: string, options?: CompanySelectionOptions) => {
    setSelectedCompanyIdState(companyId);
    setSelectionSource(options?.source ?? "manual");
    saveStoredCompanySelection(companyId);
  }, []);

  const reloadCompanies = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) =>
      companiesApi.create(data),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(company.id);
    },
  });

  const createCompany = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    }),
    [
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      isLoading,
      error,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    ],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return ctx;
}

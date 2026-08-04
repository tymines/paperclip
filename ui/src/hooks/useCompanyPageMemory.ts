import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { toCompanyRelativePath } from "../lib/company-routes";
import {
  buildBrowserStorageKeys,
  readBrowserStorageValue,
  writeBrowserStorageValue,
} from "../lib/browser-storage-compat";
import {
  getRememberedPathOwnerCompanyId,
  isRememberableCompanyPath,
  sanitizeRememberedPathForCompany,
} from "../lib/company-page-memory";

export const COMPANY_PATHS_STORAGE_KEYS = buildBrowserStorageKeys(".", "companyPaths");

function decodeCompanyPaths(raw: string): Record<string, string> | undefined {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const entries = Object.entries(parsed);
  if (!entries.every(([companyId, path]) => (
    companyId.length > 0
    && typeof path === "string"
    && path.startsWith("/")
    && !path.startsWith("//")
  ))) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

const companyPathsCodec = {
  decode: decodeCompanyPaths,
  encode: (paths: Record<string, string>) => JSON.stringify(paths),
};

export function getCompanyPaths(): Record<string, string> {
  return readBrowserStorageValue(localStorage, COMPANY_PATHS_STORAGE_KEYS, companyPathsCodec) ?? {};
}

export function saveCompanyPath(companyId: string, path: string) {
  const paths = getCompanyPaths();
  paths[companyId] = path;
  writeBrowserStorageValue(localStorage, COMPANY_PATHS_STORAGE_KEYS, paths, companyPathsCodec.encode);
}

/**
 * Remembers the last visited page per company and navigates to it on company switch.
 * Falls back to /dashboard if no page was previously visited for a company.
 */
export function useCompanyPageMemory() {
  const { companies, selectedCompanyId, selectedCompany, selectionSource } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const prevCompanyId = useRef<string | null>(selectedCompanyId);
  const rememberedPathOwnerCompanyId = useMemo(
    () =>
      getRememberedPathOwnerCompanyId({
        companies,
        pathname: location.pathname,
        fallbackCompanyId: prevCompanyId.current,
      }),
    [companies, location.pathname],
  );

  // Save current path for current company on every location change.
  // Uses prevCompanyId ref so we save under the correct company even
  // during the render where selectedCompanyId has already changed.
  const fullPath = location.pathname + location.search;
  useEffect(() => {
    const companyId = rememberedPathOwnerCompanyId;
    const relativePath = toCompanyRelativePath(fullPath);
    if (companyId && isRememberableCompanyPath(relativePath)) {
      saveCompanyPath(companyId, relativePath);
    }
  }, [fullPath, rememberedPathOwnerCompanyId]);

  // Navigate to saved path when company changes
  useEffect(() => {
    if (!selectedCompanyId) return;

    if (
      prevCompanyId.current !== null &&
      selectedCompanyId !== prevCompanyId.current
    ) {
      if (selectionSource !== "route_sync" && selectedCompany) {
        const paths = getCompanyPaths();
        const targetPath = sanitizeRememberedPathForCompany({
          path: paths[selectedCompanyId],
          companyPrefix: selectedCompany.issuePrefix,
        });
        navigate(`/${selectedCompany.issuePrefix}${targetPath}`, { replace: true });
      }
    }
    prevCompanyId.current = selectedCompanyId;
  }, [selectedCompany, selectedCompanyId, selectionSource, navigate]);
}

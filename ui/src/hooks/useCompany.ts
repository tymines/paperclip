/**
 * useCompany hook — provides the currently selected company context.
 *
 * In production this reads from a React context provider.
 * For now, returns a placeholder company for development.
 */

import { useState, useEffect } from "react";

export interface Company {
  id: string;
  name: string;
  slug: string;
}

/**
 * Get the active company from URL params, context, or localStorage.
 */
export function useCompany(): { company: Company | null } {
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    // Try to read from URL pattern: /:company/book-writing
    const match = window.location.pathname.match(/^\/([^/]+)/);
    const slug = match?.[1];

    if (slug && slug !== "login" && slug !== "register") {
      setCompany({
        id: slug,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        slug,
      });
    } else {
      // Fallback: check localStorage
      const stored = localStorage.getItem("paperclip_company");
      if (stored) {
        try {
          setCompany(JSON.parse(stored));
        } catch {
          // ignore
        }
      }
    }
  }, []);

  return { company };
}

export default useCompany;

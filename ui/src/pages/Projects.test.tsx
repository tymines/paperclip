// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { Projects } from "./Projects";

const openNewProject = vi.hoisted(() => vi.fn());

vi.mock("../api/projects", () => ({ projectsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/costs", () => ({ costsApi: { byProject: vi.fn().mockResolvedValue([]) } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openNewProject }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  openNewProject.mockReset();
});

it("preserves compact desktop sizing while exposing and activating the 44px phone create action", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.projects.list("company-1"), []);
  queryClient.setQueryData([...queryKeys.projects.list("company-1"), "cost-by-project"], []);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Projects />
      </QueryClientProvider>,
    );
  });

  const rootElement = container.querySelector('[data-testid="projects-responsive-root"]');
  const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Project"));
  expect(rootElement?.className).toContain("overflow-x-hidden");
  expect(addButton?.className).toContain("h-11");
  expect(addButton?.className).toContain("sm:h-8");

  act(() => addButton?.click());
  expect(openNewProject).toHaveBeenCalledOnce();

  act(() => root.unmount());
});

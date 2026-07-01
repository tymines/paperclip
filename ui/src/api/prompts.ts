import { api } from "./client";

export interface Prompt {
  id: string;
  companyId: string | null;
  title: string;
  body: string;
  category: string;
  tags: string[];
  variables: string[];
  isTemplate: boolean;
  source: string | null;
  sourceUrl: string | null;
  license: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  editable: boolean;
}

export interface PromptCategory {
  id: string;
  companyId: string | null;
  key: string;
  label: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  count: number;
}

export interface PromptTagFacet {
  tag: string;
  count: number;
}

export interface PromptsResponse {
  prompts: Prompt[];
  categories: PromptCategory[];
  tags: PromptTagFacet[];
}

export interface PromptInput {
  title: string;
  body: string;
  category: string;
  tags: string[];
}

export const promptsApi = {
  list: (companyId: string) =>
    api.get<PromptsResponse>(`/companies/${companyId}/prompts`),
  create: (companyId: string, input: PromptInput) =>
    api.post<{ prompt: Prompt }>(`/companies/${companyId}/prompts`, input),
  update: (companyId: string, id: string, input: Partial<PromptInput>) =>
    api.put<{ prompt: Prompt }>(`/companies/${companyId}/prompts/${id}`, input),
  remove: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/prompts/${id}`),
};

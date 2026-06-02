import { api } from "./client";

export interface ImageProvider {
  id: string;
  companyId: string | null;
  name: string;
  type: "local_lora" | "external_api";
  providerKey: string | null;
  endpoint: string | null;
  model: string | null;
  defaultParams: Record<string, unknown> | null;
  costPerUnit: string;
  status: string | null;
  statusDetail: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const imageStudioApi = {
  /** List all image providers for a company */
  listProviders: (companyId: string) =>
    api.get<{ providers: ImageProvider[] }>(`/companies/${companyId}/image-studio/providers`),

  /** Create a new provider */
  createProvider: (companyId: string, opts: {
    name: string;
    type?: "local_lora" | "external_api";
    providerKey?: string;
    endpoint?: string;
    model?: string;
    defaultParams?: Record<string, unknown>;
    costPerUnit?: string;
    status?: string;
    statusDetail?: string;
  }) =>
    api.post<{ provider: ImageProvider }>(`/companies/${companyId}/image-studio/providers`, opts),

  /** Update a provider */
  updateProvider: (companyId: string, providerId: string, opts: Partial<ImageProvider>) =>
    api.patch<{ provider: ImageProvider }>(
      `/companies/${companyId}/image-studio/providers/${providerId}`,
      opts,
    ),

  /** Delete a provider */
  deleteProvider: (companyId: string, providerId: string) =>
    api.delete<{ provider: ImageProvider }>(
      `/companies/${companyId}/image-studio/providers/${providerId}`,
    ),
};

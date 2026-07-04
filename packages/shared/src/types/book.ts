export interface Book {
  id: string;
  companyId: string;
  slug: string;
  title: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

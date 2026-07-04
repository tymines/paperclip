export const API_PREFIX = "/api";

export const API = {
  health: `${API_PREFIX}/health`,
  companies: `${API_PREFIX}/companies`,
  agents: `${API_PREFIX}/agents`,
  projects: `${API_PREFIX}/projects`,
  issues: `${API_PREFIX}/issues`,
  issueTreeControl: `${API_PREFIX}/issues/:issueId/tree-control`,
  issueTreeHolds: `${API_PREFIX}/issues/:issueId/tree-holds`,
  goals: `${API_PREFIX}/goals`,
  approvals: `${API_PREFIX}/approvals`,
  secrets: `${API_PREFIX}/secrets`,
  secretProviderConfigs: `${API_PREFIX}/secret-provider-configs`,
  costs: `${API_PREFIX}/costs`,
  activity: `${API_PREFIX}/activity`,
  dashboard: `${API_PREFIX}/dashboard`,
  sidebarBadges: `${API_PREFIX}/sidebar-badges`,
  sidebarPreferences: `${API_PREFIX}/sidebar-preferences`,
  books: `${API_PREFIX}/books`,
  invites: `${API_PREFIX}/invites`,
  joinRequests: `${API_PREFIX}/join-requests`,
  members: `${API_PREFIX}/members`,
  admin: `${API_PREFIX}/admin`,
  bookStudio: {
    books: (companyId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books`,
    book: (companyId: string, bookId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}`,
    characters: (companyId: string, bookId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/characters`,
    character: (companyId: string, bookId: string, id: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/characters/${id}`,
    worldLocations: (companyId: string, bookId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/world-locations`,
    worldLocation: (companyId: string, bookId: string, id: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/world-locations/${id}`,
    style: (companyId: string, bookId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/style`,
    styleEntry: (companyId: string, bookId: string, id: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/style/${id}`,
    outline: (companyId: string, bookId: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/outline`,
    outlineEntry: (companyId: string, bookId: string, id: string) =>
      `${API_PREFIX}/companies/${companyId}/book-studio/books/${bookId}/outline/${id}`,
  },
} as const;

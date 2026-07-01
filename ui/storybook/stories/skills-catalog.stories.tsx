import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import type { CompanySkillListItem } from "@paperclipai/shared";
import { SkillsCatalog } from "@/pages/SkillsCatalog";
import { queryKeys } from "@/lib/queryKeys";

const SKILLS_COMPANY_ID = "company-storybook";

const SKILLS_LIBRARY: CompanySkillListItem[] = [
  {
    id: "skill-web-search",
    companyId: SKILLS_COMPANY_ID,
    key: "web-search",
    slug: "web-search",
    name: "Web Search",
    description:
      "Let agents query the public web for fresh context before answering. Uses the configured search provider with safe-search and per-call budgets.",
    sourceType: "catalog",
    sourceLocator: "paperclip/web-search",
    sourceRef: "v2.0.1",
    trustLevel: "scripts_executables",
    compatibility: "compatible",
    fileInventory: [
      { path: "SKILL.md", kind: "skill" },
      { path: "scripts/fetch.ts", kind: "script" },
    ],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-03-12T09:00:00Z"),
    updatedAt: new Date("2026-05-18T15:30:00Z"),
    attachedAgentCount: 6,
    totalAgentCount: 7,
    usage30d: { invocations: 4321, successRate: 0.97, avgLatencyMs: 412, totalCostCents: 1230 },
    editable: false,
    editableReason: "Built-in skill",
    sourceLabel: "Paperclip",
    sourceBadge: "paperclip",
    sourcePath: "skills/web-search",
  },
  {
    id: "skill-code-exec",
    companyId: SKILLS_COMPANY_ID,
    key: "code-execution",
    slug: "code-execution",
    name: "Code Execution",
    description:
      "Run sandboxed Python or Node scripts to compute, test, and verify. Each invocation runs in a fresh ephemeral container with 30s and 256MB caps.",
    sourceType: "catalog",
    sourceLocator: "paperclip/code-execution",
    sourceRef: "v1.4.0",
    trustLevel: "scripts_executables",
    compatibility: "compatible",
    fileInventory: [
      { path: "SKILL.md", kind: "skill" },
      { path: "scripts/run-node.ts", kind: "script" },
      { path: "scripts/run-python.ts", kind: "script" },
    ],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-02-04T10:00:00Z"),
    updatedAt: new Date("2026-05-22T12:00:00Z"),
    attachedAgentCount: 4,
    totalAgentCount: 7,
    usage30d: { invocations: 1845, successRate: 0.88, avgLatencyMs: 920, totalCostCents: 740 },
    editable: false,
    editableReason: "Built-in skill",
    sourceLabel: "Paperclip",
    sourceBadge: "paperclip",
    sourcePath: "skills/code-execution",
  },
  {
    id: "skill-readfs",
    companyId: SKILLS_COMPANY_ID,
    key: "read-filesystem",
    slug: "read-filesystem",
    name: "Read Filesystem",
    description:
      "Scoped read access into project workspaces and shared knowledge — never writes, never leaves the workspace boundary.",
    sourceType: "catalog",
    sourceLocator: "paperclip/read-filesystem",
    sourceRef: "v1.2.0",
    trustLevel: "assets",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-02-20T11:00:00Z"),
    updatedAt: new Date("2026-05-10T09:30:00Z"),
    attachedAgentCount: 7,
    totalAgentCount: 7,
    usage30d: { invocations: 9120, successRate: 0.99, avgLatencyMs: 84, totalCostCents: 0 },
    editable: false,
    editableReason: "Built-in skill",
    sourceLabel: "Paperclip",
    sourceBadge: "paperclip",
    sourcePath: "skills/read-filesystem",
  },
  {
    id: "skill-mcp-notion",
    companyId: SKILLS_COMPANY_ID,
    key: "notion-mcp",
    slug: "notion-mcp",
    name: "Notion MCP",
    description:
      "Bridges the Notion MCP server so agents can search, read, and append to Notion pages they have access to.",
    sourceType: "github",
    sourceLocator: "paperclipai/plugin-notion",
    sourceRef: "abc12345f",
    trustLevel: "scripts_executables",
    compatibility: "compatible",
    fileInventory: [
      { path: "SKILL.md", kind: "skill" },
      { path: "scripts/list-pages.ts", kind: "script" },
    ],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-04-02T10:00:00Z"),
    updatedAt: new Date("2026-05-20T08:30:00Z"),
    attachedAgentCount: 2,
    totalAgentCount: 7,
    usage30d: { invocations: 312, successRate: 0.94, avgLatencyMs: 230, totalCostCents: 0 },
    editable: false,
    editableReason: null,
    sourceLabel: "GitHub plugin",
    sourceBadge: "github",
    sourcePath: "plugin-notion/skills/notion-mcp",
  },
  {
    id: "skill-translate",
    companyId: SKILLS_COMPANY_ID,
    key: "translate",
    slug: "translate",
    name: "Translate",
    description:
      "Translate text between supported languages. Custom skill the team added to support multilingual ticket triage.",
    sourceType: "local_path",
    sourceLocator: "skills/translate",
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    enabled: false,
    iconKey: null,
    createdAt: new Date("2026-05-15T15:00:00Z"),
    updatedAt: new Date("2026-05-22T09:00:00Z"),
    attachedAgentCount: 1,
    totalAgentCount: 7,
    usage30d: { invocations: 18, successRate: 0.78, avgLatencyMs: 612, totalCostCents: 22 },
    editable: true,
    editableReason: null,
    sourceLabel: "Local",
    sourceBadge: "local",
    sourcePath: "skills/translate",
  },
  {
    id: "skill-design-guide",
    companyId: SKILLS_COMPANY_ID,
    key: "design-guide",
    slug: "design-guide",
    name: "Design guide",
    description:
      "Paperclip UI design system reference: tokens, typography, status colors, and reusable component patterns.",
    sourceType: "local_path",
    sourceLocator: "skills/design-guide",
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    enabled: true,
    iconKey: null,
    createdAt: new Date("2026-04-15T10:00:00Z"),
    updatedAt: new Date("2026-04-25T12:00:00Z"),
    attachedAgentCount: 2,
    totalAgentCount: 7,
    usage30d: { invocations: 64, successRate: 1, avgLatencyMs: 38, totalCostCents: 0 },
    editable: true,
    editableReason: null,
    sourceLabel: "Local",
    sourceBadge: "local",
    sourcePath: "skills/design-guide",
  },
];

function PopulatedCatalogStory() {
  const queryClient = useQueryClient();
  queryClient.setQueryData(queryKeys.companySkills.list(SKILLS_COMPANY_ID), SKILLS_LIBRARY);
  return <SkillsCatalog />;
}

function EmptyCatalogStory() {
  const queryClient = useQueryClient();
  queryClient.setQueryData(queryKeys.companySkills.list(SKILLS_COMPANY_ID), []);
  return <SkillsCatalog />;
}

const meta: Meta = {
  title: "Surfaces / Skills catalog",
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;

type Story = StoryObj;

export const Populated: Story = {
  render: () => <PopulatedCatalogStory />,
};

export const EmptyState: Story = {
  render: () => <EmptyCatalogStory />,
};

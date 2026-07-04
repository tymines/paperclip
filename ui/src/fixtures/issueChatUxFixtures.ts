import type { Agent } from "@paperclipai/shared";
import type {
  IssueChatComment,
  IssueChatTranscriptEntry,
} from "../lib/issue-chat-messages";
import type { IssueTimelineEvent } from "../lib/issue-timeline-events";
import type {
  AskUserQuestionsInteraction,
  RequestConfirmationInteraction,
  SuggestTasksInteraction,
} from "../lib/issue-thread-interactions";

function createAgent(
  id: string,
  name: string,
  icon: string,
  urlKey: string,
): Agent {
  const now = new Date("2026-04-06T12:00:00.000Z");
  return {
    id,
    companyId: "company-ux",
    name,
    role: "engineer",
    title: null,
    icon,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
  };
}

function createComment(overrides: Partial<IssueChatComment>): IssueChatComment {
  const merged: IssueChatComment = {
    id: "comment-default",
    companyId: "company-ux",
    issueId: "issue-ux",
    authorType: overrides.authorAgentId ? "agent" : "user",
    authorAgentId: null,
    authorUserId: overrides.authorAgentId ? null : "user-1",
    body: "",
    presentation: null,
    metadata: null,
    authorName: null,
    resolvedAuthorName: null,
    createdAt: new Date("2026-04-06T12:00:00.000Z"),
    updatedAt: new Date("2026-04-06T12:00:00.000Z"),
    ...overrides,
  };
  return merged;
}

const primaryAgent = createAgent("agent-1", "CodexCoder", "code", "codexcoder");
const reviewAgent = createAgent("agent-2", "ClaudeFixer", "sparkles", "claudefixer");

export const issueChatUxAgentMap = new Map<string, Agent>([
  [primaryAgent.id, primaryAgent],
  [reviewAgent.id, reviewAgent],
]);

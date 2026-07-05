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

// ponytail: stub exports — IssueChatUxLab is a dev-only UX playground.
// Full fixtures were removed upstream; empty defaults unblock CI.
export const issueChatUxFeedbackVotes = new Map();
export const issueChatUxLinkedRuns: any[] = [];
export const issueChatUxLiveComments: any[] = [];
export const issueChatUxLiveEvents: any[] = [];
export const issueChatUxLiveRuns: any[] = [];
export const issueChatUxMentions: any[] = [];
export const issueChatUxReassignOptions: any[] = [];
export const issueChatUxReviewComments: any[] = [];
export const issueChatUxReviewEvents: any[] = [];
export const issueChatUxSubmittingComments: any[] = [];
export const issueChatUxTranscriptsByRunId = new Map();

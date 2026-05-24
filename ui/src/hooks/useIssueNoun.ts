import { useUiV2 } from "./useUiV2";

export interface IssueNoun {
  singular: string;
  plural: string;
  capSingular: string;
  capPlural: string;
}

const TASK_NOUN: IssueNoun = {
  singular: "task",
  plural: "tasks",
  capSingular: "Task",
  capPlural: "Tasks",
};

const ISSUE_NOUN: IssueNoun = {
  singular: "issue",
  plural: "issues",
  capSingular: "Issue",
  capPlural: "Issues",
};

/**
 * Returns the user-facing noun for an "issue" record. Gated by the
 * enableUiV2 experimental flag: when v2 is on, every visible label that
 * said "Issue/Issues" should say "Task/Tasks". Routes, DB tables, API
 * endpoints, type names, and the issue key format (e.g. TYL-99) stay
 * unchanged — only visible English copy swaps.
 */
export function useIssueNoun(): IssueNoun {
  const uiV2 = useUiV2();
  return uiV2 ? TASK_NOUN : ISSUE_NOUN;
}

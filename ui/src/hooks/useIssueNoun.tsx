import { createContext, useContext, useMemo, type ReactNode } from "react";
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
 * Context that supplies the user-facing noun for an "issue" record.
 * Defaults to ISSUE_NOUN so components rendered outside a provider
 * (e.g. in vitest unit tests) keep the legacy "issue/issues" wording
 * without needing a QueryClientProvider in their test harness.
 */
const IssueNounContext = createContext<IssueNoun>(ISSUE_NOUN);

/**
 * Wraps app content with the issue/task noun derived from the
 * enableUiV2 experimental flag. Mounted once at the app shell level
 * (Layout). Reads the flag via useUiV2() — when v2 is on, every visible
 * label that said "Issue/Issues" reads as "Task/Tasks". Routes, DB
 * tables, API endpoints, type names, and the issue key format
 * (e.g. TYL-99) are unaffected.
 */
export function IssueNounProvider({ children }: { children: ReactNode }) {
  const uiV2 = useUiV2();
  const value = useMemo<IssueNoun>(() => (uiV2 ? TASK_NOUN : ISSUE_NOUN), [uiV2]);
  return <IssueNounContext.Provider value={value}>{children}</IssueNounContext.Provider>;
}

export function useIssueNoun(): IssueNoun {
  return useContext(IssueNounContext);
}

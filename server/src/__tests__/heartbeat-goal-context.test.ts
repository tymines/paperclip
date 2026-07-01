import { describe, expect, it } from "vitest";
import { GOAL_LEVELS, GOAL_STATUSES, type GoalLevel, type GoalStatus } from "@paperclipai/shared";
import { applyIssueGoalContext, readIssueGoalTitle, type IssueGoalContext } from "../lib/goal-context.js";

function createGoal(overrides: Partial<IssueGoalContext> = {}): IssueGoalContext {
  return {
    id: "goal-1",
    title: "Ship the feature",
    description: "Deliver the operator-visible change",
    level: "task",
    status: "active",
    ...overrides,
  };
}

describe("applyIssueGoalContext", () => {
  it("injects goal fields into the adapter context", () => {
    const context: Record<string, unknown> = { issueId: "issue-1", taskId: "issue-1" };

    applyIssueGoalContext(context, createGoal());

    expect(context).toMatchObject({
      issueId: "issue-1",
      taskId: "issue-1",
      goalId: "goal-1",
      goalTitle: "Ship the feature",
      goalDescription: "Deliver the operator-visible change",
      goalLevel: "task",
      goalStatus: "active",
    });
  });

  it("keeps unrelated context values intact", () => {
    const context: Record<string, unknown> = {
      issueId: "issue-1",
      projectId: "project-1",
      paperclipWorkspace: { cwd: "/tmp/workspace" },
    };

    applyIssueGoalContext(context, createGoal({ id: "goal-2", title: "Keep context stable" }));

    expect(context.projectId).toBe("project-1");
    expect(context.paperclipWorkspace).toEqual({ cwd: "/tmp/workspace" });
    expect(context.goalId).toBe("goal-2");
    expect(context.goalTitle).toBe("Keep context stable");
  });

  it("writes null descriptions through to the prompt context", () => {
    const context: Record<string, unknown> = {};

    applyIssueGoalContext(context, createGoal({ description: null }));

    expect(context.goalDescription).toBeNull();
  });

  it("clears stale goal fields when an issue no longer has a goal", () => {
    const context: Record<string, unknown> = {
      issueId: "issue-1",
      goalId: "stale-goal",
      goalTitle: "Old goal",
      goalDescription: "Old description",
      goalLevel: "company",
      goalStatus: "planned",
    };

    applyIssueGoalContext(context, null);

    expect(context.issueId).toBe("issue-1");
    expect(context.goalId).toBeUndefined();
    expect(context.goalTitle).toBeUndefined();
    expect(context.goalDescription).toBeUndefined();
    expect(context.goalLevel).toBeUndefined();
    expect(context.goalStatus).toBeUndefined();
  });

  it("replaces prior goal fields when a different goal is linked", () => {
    const context: Record<string, unknown> = {
      goalId: "old-goal",
      goalTitle: "Old goal",
      goalDescription: "Old description",
      goalLevel: "company",
      goalStatus: "planned",
    };

    applyIssueGoalContext(
      context,
      createGoal({
        id: "new-goal",
        title: "New goal",
        description: "New description",
        level: "team",
        status: "achieved",
      }),
    );

    expect(context).toMatchObject({
      goalId: "new-goal",
      goalTitle: "New goal",
      goalDescription: "New description",
      goalLevel: "team",
      goalStatus: "achieved",
    });
  });

  it("supports every shipped goal level", () => {
    for (const level of GOAL_LEVELS) {
      const context: Record<string, unknown> = {};
      applyIssueGoalContext(context, createGoal({ level: level as GoalLevel }));
      expect(context.goalLevel).toBe(level);
    }
  });

  it("supports every shipped goal status", () => {
    for (const status of GOAL_STATUSES) {
      const context: Record<string, unknown> = {};
      applyIssueGoalContext(context, createGoal({ status: status as GoalStatus }));
      expect(context.goalStatus).toBe(status);
    }
  });
});

describe("readIssueGoalTitle", () => {
  it("returns the linked goal title when present", () => {
    expect(
      readIssueGoalTitle({
        id: "issue-1",
        goalId: "goal-1",
        goal: { title: "Make the site functional" },
      }),
    ).toBe("Make the site functional");
  });

  it("returns null when the issue has no goal object", () => {
    expect(readIssueGoalTitle({ id: "issue-1", goalId: null, goal: null })).toBeNull();
    expect(readIssueGoalTitle({ id: "issue-1", goalId: null })).toBeNull();
  });

  it("returns null when the goal title is not a string", () => {
    expect(readIssueGoalTitle({ id: "issue-1", goal: { title: 123 } })).toBeNull();
  });
});

import { z } from "zod";
import { GOAL_LEVELS, GOAL_STATUSES, GOAL_REVIEW_POLICIES } from "../constants.js";

export const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  level: z.enum(GOAL_LEVELS).optional().default("task"),
  status: z.enum(GOAL_STATUSES).optional().default("planned"),
  reviewPolicy: z.enum(GOAL_REVIEW_POLICIES).optional().default("owner"),
  parentId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
});

export type CreateGoal = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = createGoalSchema.partial();

export type UpdateGoal = z.infer<typeof updateGoalSchema>;

export const linkProjectToGoalSchema = z.object({
  projectId: z.string().uuid(),
});

export type LinkProjectToGoal = z.infer<typeof linkProjectToGoalSchema>;

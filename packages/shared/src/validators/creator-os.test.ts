import { describe, expect, it } from "vitest";
import {
  createCreatorCampaignSchema,
  createCreatorFlowSchema,
  decideCreatorReviewSchema,
  scheduleCreatorSocialDraftSchema,
} from "./creator-os.js";

describe("Creator OS contracts", () => {
  it("rejects campaign deadlines and multi-persona payloads", () => {
    const base = { personaId: "11111111-1111-4111-8111-111111111111", name: "Launch" };
    expect(createCreatorCampaignSchema.safeParse({ ...base, deadline: "2026-09-01" }).success).toBe(false);
    expect(createCreatorCampaignSchema.safeParse({ ...base, personaIds: [base.personaId] }).success).toBe(false);
    expect(createCreatorCampaignSchema.safeParse(base).success).toBe(true);
    expect(createCreatorCampaignSchema.safeParse({ ...base, channels: ["instagram", "tiktok"] }).success).toBe(true);
    expect(createCreatorCampaignSchema.safeParse({ ...base, channels: ["not-a-channel"] }).success).toBe(false);
  });

  it("requires ordered flow steps but has no execution flag on save", () => {
    const result = createCreatorFlowSchema.safeParse({
      personaId: "11111111-1111-4111-8111-111111111111",
      name: "Launch",
      steps: [{ name: "Hero", config: { prompt: "hero" } }],
      run: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires feedback for rejection and at least one Social target", () => {
    expect(decideCreatorReviewSchema.safeParse({ decision: "rejected" }).success).toBe(false);
    expect(decideCreatorReviewSchema.safeParse({ decision: "approved" }).success).toBe(true);
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    expect(scheduleCreatorSocialDraftSchema.safeParse({ confirmPublish: true, accountIds: [], scheduledAt }).success).toBe(false);
    expect(scheduleCreatorSocialDraftSchema.safeParse({ accountIds: ["11111111-1111-4111-8111-111111111111"], scheduledAt }).success).toBe(false);
    expect(scheduleCreatorSocialDraftSchema.safeParse({ confirmPublish: true, accountIds: ["11111111-1111-4111-8111-111111111111"], scheduledAt }).success).toBe(true);
  });
});

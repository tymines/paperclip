import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDb,
  companies,
  agents,
  activityLog,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { loadHermesRunAttributions } from "../services/fleet-cost-dashboard.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// Regression coverage for Atlas PR #27 rereview P1: run attribution must
// return only the issue id resolved by the company-scoped issues join. Raw
// context/activity references that fail the scoped join (cross-company,
// missing, non-UUID, or stale) must stay unattributed with no raw id leakage.
describeEmbeddedPostgres("fleet run attribution company boundary (real DB)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const agentId = randomUUID();
  const issueId = randomUUID();
  const foreignIssueId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-fleet-attribution-");
    db = createDb(tempDb.connectionString);

    await db.insert(companies).values([
      { id: companyId, name: "Fleet Co", issuePrefix: "FLT", requireBoardApprovalForNewAgents: false },
      { id: otherCompanyId, name: "Other Co", issuePrefix: "OTH", requireBoardApprovalForNewAgents: false },
    ]);
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Fleet Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values([
      { id: issueId, companyId, title: "Own issue", identifier: "FLT-1", status: "in_progress" },
      { id: foreignIssueId, companyId: otherCompanyId, title: "Foreign issue", identifier: "OTH-1", status: "in_progress" },
    ]);
  }, 30_000);

  beforeEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function insertRun(input: {
    sessionId: string;
    contextIssueId?: string | null;
    activityIssueId?: string | null;
  }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "succeeded",
      resultJson: { session_id: input.sessionId },
      contextSnapshot: input.contextIssueId ? { issueId: input.contextIssueId } : {},
    });
    if (input.activityIssueId) {
      await db.insert(activityLog).values({
        companyId,
        actorType: "agent",
        actorId: agentId,
        action: "issue.updated",
        entityType: "issue",
        entityId: input.activityIssueId,
        runId,
      });
    }
    return runId;
  }

  it("resolves a valid same-company context issue reference", async () => {
    await insertRun({ sessionId: "session-own", contextIssueId: issueId });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: "session-own",
      issueId,
      issueIdentifier: "FLT-1",
      issueTitle: "Own issue",
    });
  });

  it("resolves a valid same-company activity-log issue link", async () => {
    await insertRun({ sessionId: "session-activity", activityIssueId: issueId });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBe(issueId);
  });

  it("leaves a cross-company issue UUID unattributed without leaking the raw id", async () => {
    await insertRun({ sessionId: "session-foreign", contextIssueId: foreignIssueId });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBeNull();
    expect(rows[0].issueIdentifier).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(foreignIssueId);
  });

  it("leaves a missing issue UUID unattributed without leaking the raw id", async () => {
    const missingIssueId = randomUUID();
    await insertRun({ sessionId: "session-missing", contextIssueId: missingIssueId });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(missingIssueId);
  });

  it("leaves a non-UUID external issue identifier unattributed without leaking it", async () => {
    await insertRun({ sessionId: "session-external", contextIssueId: "EXT-991" });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain("EXT-991");
  });

  it("leaves a stale activity-log link unattributed without leaking the raw id", async () => {
    const staleIssueId = randomUUID();
    await insertRun({ sessionId: "session-stale", activityIssueId: staleIssueId });

    const rows = await loadHermesRunAttributions(db, companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(staleIssueId);
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FleetCostDashboardPanel } from "./FleetCostDashboardPanel";
import type { FleetCostDashboardPayload } from "@paperclipai/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(payload: FleetCostDashboardPayload) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<FleetCostDashboardPanel payload={payload} />);
  });
  return container;
}

function payload(): FleetCostDashboardPayload {
  return {
    companyId: "company-1",
    grain: "day",
    filters: { projectId: "project-1", agentId: "agent-1", model: "model-included" },
    freshness: {
      observedAt: "2026-07-24T01:02:10.000Z",
      checkpoint: { sequence: 7, cursor: "state.db:7" },
      errors: ["Hermes sidecar missing"],
    },
    availability: {
      modelSpeed: {
        avgLatencyMs: "available",
        avgTtftMs: "available",
        throughputOutputTokensPerSecond: "available",
      },
      taskSpeed: {
        avgLatencyMs: "available",
        avgTtftMs: "available",
        throughputOutputTokensPerSecond: "available",
      },
      stalls: "unavailable",
    },
    sources: [
      {
        boxId: "mac-local",
        collectorId: "hermes-local",
        profileId: null,
        kind: "hermes-local",
        status: "ok",
        observedAt: "2026-07-24T01:02:10.000Z",
        checkpoint: { sequence: 7, cursor: "state.db:7" },
        errors: [],
        detail: null,
      },
      {
        boxId: "box-2-windows",
        collectorId: "hermes-windows-envelope",
        profileId: "ares",
        kind: "envelope-file",
        status: "unavailable",
        observedAt: null,
        checkpoint: null,
        errors: ["Windows envelope collector failed: ENOENT"],
        detail: "ENOENT",
      },
    ],
    trends: [{ bucket: "2026-07-24", costUsd: 0, inputTokens: 900, outputTokens: 600, completedTasks: 1 }],
    modelRows: [
      {
        provider: "provider-a",
        model: "model-included",
        billingMode: "subscription_included",
        costStatus: "included",
        costSource: "none",
        pricingVersion: "hermes-2026-07",
        estimatedCostUsd: 0,
        actualCostUsd: null,
        inputTokens: 900,
        outputTokens: 600,
        cacheReadTokens: 200,
        cacheWriteTokens: 50,
        reasoningTokens: 25,
        usageApiCalls: 3,
        speedSampleApiCalls: 2,
        speedAmbiguousOmittedApiCalls: 0,
        speedAvailability: "available",
        avgLatencyMs: 2000,
        avgTtftMs: 420,
        throughputOutputTokensPerSecond: 300,
        completedTasks: 1,
        costPerCompletedTaskUsd: 0,
        avgTaskWallClockMs: 10000,
        turns: 1,
        compactions: 2,
        stalls: null,
        stallsAvailability: "unavailable",
        boxes: ["box-2-windows", "mac-local"],
      },
      {
        provider: "provider-b",
        model: "model-unknown",
        billingMode: "unknown",
        costStatus: "unknown",
        costSource: "none",
        pricingVersion: null,
        estimatedCostUsd: 0.1234,
        actualCostUsd: null,
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        usageApiCalls: 1,
        speedSampleApiCalls: null,
        speedAmbiguousOmittedApiCalls: 1,
        speedAvailability: "ambiguous",
        avgLatencyMs: null,
        avgTtftMs: null,
        throughputOutputTokensPerSecond: null,
        completedTasks: 0,
        costPerCompletedTaskUsd: null,
        avgTaskWallClockMs: null,
        turns: null,
        compactions: 0,
        stalls: null,
        stallsAvailability: "unavailable",
        boxes: ["mac-local"],
      },
    ],
    taskRows: [
      {
        issueId: "issue-1",
        issueIdentifier: "PAP-1",
        issueTitle: "Ship dashboard",
        projectId: "project-1",
        projectName: "Cost visibility",
        agentId: "agent-1",
        agentName: "Fleet Agent",
        runIds: ["run-1"],
        sessionIds: ["20260724_010203_aaaaaaaa"],
        completionState: "succeeded",
        costUsd: 0,
        costPerCompletedTaskUsd: 0,
        inputTokens: 900,
        outputTokens: 600,
        wallClockMs: 10000,
        turns: 1,
        throughputOutputTokensPerSecond: 300,
        avgLatencyMs: 2000,
        avgTtftMs: 420,
        compactions: 2,
        stalls: null,
        boxes: ["box-2-windows", "mac-local"],
        models: [],
      },
    ],
    unattributedSessions: [
      {
        sessionId: "20260724_010203_bbbbbbbb",
        boxId: "box-2-windows",
        startedAt: null,
        billingMode: "metered",
        costStatus: "actual",
        estimatedCostUsd: 999,
        actualCostUsd: 999,
      },
    ],
  } as unknown as FleetCostDashboardPayload;
}

describe("FleetCostDashboardPanel", () => {
  it("renders cost and speed together with billing semantics and freshness", () => {
    const node = render(payload());

    expect(node.textContent).toContain("Hermes fleet cost");
    expect(node.textContent).toContain("Included");
    expect(node.textContent).toContain("Unknown");
    expect(node.textContent).toContain("estimated $0.1234");
    expect(node.textContent).not.toContain("Observed cost");
    expect(node.textContent).toContain("Estimated or included cost");
    expect(node.textContent).toContain("actual unavailable");
    expect(node.textContent).toContain("10.0s wall");
    expect(node.textContent).toContain("300.00 tok/s");
    expect(node.textContent).toContain("2.0s latency");
    expect(node.textContent).toContain("420ms TTFT");
    expect(node.textContent).toContain("2026-07-24");
    expect(node.textContent).toContain("day trend");
    expect(node.textContent).toContain("PAP-1");
    expect(node.textContent).toContain("Completed tasks");
    expect(node.textContent).toContain("Cost / completed");
    expect(node.textContent).toContain("Task wall");
    expect(node.textContent).toContain("Stalls unavailable");
    expect(node.textContent).toContain("Unattributed sessions");
    expect(node.textContent).toContain("Hermes sidecar missing");
    expect(node.textContent).toContain("mac-local · ok");
    expect(node.textContent).toContain("box-2-windows · unavailable");
    expect(node.textContent).toContain("box-2-windows, mac-local");
    expect(node.textContent).toContain("box-2-windows:20260724_010203_bbbbbbbb");
  });

  it("labels call-count sources and per-row speed availability so they cannot be misread", () => {
    const node = render(payload());

    // The Hermes state.db usage count and the observed sidecar speed-sample
    // count are labeled with their sources; a bare ambiguous "apiCalls"
    // figure is never shown.
    expect(node.textContent).toContain("3 usage calls (state.db)");
    expect(node.textContent).toContain("2 observed speed samples");
    // Ambiguous split billing identities render an explicit ambiguous label
    // instead of a zero or a guessed count, and turns are unavailable.
    expect(node.textContent).toContain("speed ambiguous");
    expect(node.textContent).toContain("turns unavailable");
    expect(node.textContent).not.toContain("apiCalls");
  });

  it("renders partial speed coverage with included and omitted sample counts and unique-sample metrics", () => {
    // AUTONOMOUS GAP-FILL C: partial = unique samples coexist with ambiguous
    // omitted samples. The UI must visibly label the partial state and
    // disclose both counts while still rendering the unique-sample metrics.
    const mixed = payload();
    mixed.modelRows[0] = {
      ...mixed.modelRows[0],
      speedAvailability: "partial",
      speedSampleApiCalls: 2,
      speedAmbiguousOmittedApiCalls: 1,
    } as FleetCostDashboardPayload["modelRows"][number];
    const node = render(mixed);

    expect(node.textContent).toContain("2 observed speed samples");
    expect(node.textContent).toContain("partial coverage");
    expect(node.textContent).toContain("1 ambiguous omitted");
    // unique-sample metrics still render for partial rows
    expect(node.textContent).toContain("300.00 tok/s");
    expect(node.textContent).toContain("2.0s latency");
    expect(node.textContent).toContain("420ms TTFT");
    // the ambiguous row keeps its explicit non-partial label
    expect(node.textContent).toContain("speed ambiguous");
  });
});

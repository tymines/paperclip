import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS,
  startIssueLeaseRenewalLoop,
} from "../services/heartbeat.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("issue ownership lease renewal loop", () => {
  it("renews every five minutes without overlapping a slow renewal", async () => {
    vi.useFakeTimers();
    let finishRenewal!: () => void;
    const renew = vi.fn(() => new Promise<void>((resolve) => {
      finishRenewal = resolve;
    }));
    const onLost = vi.fn();
    const stop = startIssueLeaseRenewalLoop(renew, onLost);

    expect(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS).toBe(5 * 60_000);
    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(1);

    finishRenewal();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();
    stop();
  });

  it("retries one transient renewal failure without losing the lease", async () => {
    vi.useFakeTimers();
    const renew = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);
    const onLost = vi.fn();
    const stop = startIssueLeaseRenewalLoop(renew, onLost);

    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();
    stop();
  });

  it("stops the loop and reports lease loss once after the retry fails", async () => {
    vi.useFakeTimers();
    const error = new Error("lease lost");
    const renew = vi.fn().mockRejectedValue(error);
    const onLost = vi.fn();
    startIssueLeaseRenewalLoop(renew, onLost);

    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onLost).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(2 * ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

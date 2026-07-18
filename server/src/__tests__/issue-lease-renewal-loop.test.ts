import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS,
  startIssueLeaseRenewalLoop,
} from "../services/heartbeat.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("issue ownership lease renewal loop", () => {
  it("retries one renewal failure before declaring lease loss", async () => {
    vi.useFakeTimers();
    const transient = new Error("transient");
    const terminal = new Error("lease lost");
    const renew = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(terminal);
    const onLost = vi.fn();
    const stop = startIssueLeaseRenewalLoop(renew, onLost);

    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(4);
    expect(onLost).toHaveBeenCalledWith(terminal);

    await vi.advanceTimersByTimeAsync(2 * ISSUE_OWNERSHIP_LEASE_RENEW_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(4);
    expect(onLost).toHaveBeenCalledTimes(1);
    stop();
  });
});

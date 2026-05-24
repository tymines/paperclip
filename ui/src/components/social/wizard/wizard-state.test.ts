// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { WizardPlatformSpec } from "@paperclipai/shared";
import { WIZARD_PLATFORM_SPECS } from "@paperclipai/shared";
import {
  acknowledgeGate,
  advance,
  blankState,
  canAdvance,
  clearState,
  loadState,
  markConnected,
  markCredentialsSaved,
  regress,
  saveState,
  setRedditChoice,
  stepIndex,
  unacknowledgeGate,
} from "./wizard-state";

const ig = WIZARD_PLATFORM_SPECS.instagram as WizardPlatformSpec;
const x = WIZARD_PLATFORM_SPECS.twitter as WizardPlatformSpec;
const reddit = WIZARD_PLATFORM_SPECS.reddit as WizardPlatformSpec;
const fb = WIZARD_PLATFORM_SPECS.facebook as WizardPlatformSpec;

describe("SocialConnectWizard step machine", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("step indexing", () => {
    it("starts at step 1 (what-you-need)", () => {
      const s = blankState("instagram");
      expect(s.currentStep).toBe("what-you-need");
      expect(stepIndex(s.currentStep)).toBe(0);
    });

    it("regress is bounded at step 1", () => {
      const s = blankState("instagram");
      expect(regress(s).currentStep).toBe("what-you-need");
    });
  });

  describe("Instagram business-only gate", () => {
    it("blocks advance until business-account gate is acknowledged", () => {
      const s = blankState("instagram");
      const check = canAdvance(s, ig);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.reason).toMatch(/business/i);
      }
    });

    it("allows advance once business-account gate is acknowledged", () => {
      let s = blankState("instagram");
      s = acknowledgeGate(s, "instagram_business_account");
      expect(canAdvance(s, ig).ok).toBe(true);
      const advanced = advance(s, ig);
      expect(advanced.currentStep).toBe("register-app");
      expect(advanced.completedSteps).toContain("what-you-need");
    });

    it("un-acknowledging the gate re-blocks advance", () => {
      let s = blankState("instagram");
      s = acknowledgeGate(s, "instagram_business_account");
      s = unacknowledgeGate(s, "instagram_business_account");
      expect(canAdvance(s, ig).ok).toBe(false);
    });
  });

  describe("X paid-tier gate", () => {
    it("blocks advance until pay-per-use gate is confirmed", () => {
      const s = blankState("twitter");
      const check = canAdvance(s, x);
      expect(check.ok).toBe(false);
    });

    it("allows advance once paid-tier gate is acknowledged", () => {
      let s = blankState("twitter");
      s = acknowledgeGate(s, "x_paid_tier");
      const check = canAdvance(s, x);
      expect(check.ok).toBe(true);
    });
  });

  describe("Reddit commercial routing", () => {
    it("blocks advance with no choice made", () => {
      const s = blankState("reddit");
      expect(canAdvance(s, reddit).ok).toBe(false);
    });

    it("blocks advance and reports commercial-exit when commercial is picked", () => {
      let s = blankState("reddit");
      s = setRedditChoice(s, "commercial");
      const check = canAdvance(s, reddit);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.reason).toMatch(/commercial/i);
      }
    });

    it("advances when personal use is picked", () => {
      let s = blankState("reddit");
      s = setRedditChoice(s, "personal");
      expect(canAdvance(s, reddit).ok).toBe(true);
      const next = advance(s, reddit);
      expect(next.currentStep).toBe("register-app");
    });
  });

  describe("Facebook (no gates)", () => {
    it("can advance from step 1 immediately", () => {
      const s = blankState("facebook");
      // Facebook spec has no blocking gates.
      expect(canAdvance(s, fb).ok).toBe(true);
    });
  });

  describe("step 3 → 4 (credentials gate)", () => {
    it("requires credentialLast4 before advancing past paste-creds", () => {
      let s = blankState("instagram");
      s = acknowledgeGate(s, "instagram_business_account");
      s = advance(s, ig); // → register-app
      s = advance(s, ig); // → paste-creds
      expect(s.currentStep).toBe("paste-creds");
      expect(canAdvance(s, ig).ok).toBe(false);
      s = markCredentialsSaved(s, "abcd");
      expect(canAdvance(s, ig).ok).toBe(true);
      s = advance(s, ig);
      expect(s.currentStep).toBe("connect");
    });
  });

  describe("step 4 (connect)", () => {
    it("requires connectedAccountId before the wizard reports complete", () => {
      let s = blankState("instagram");
      s = acknowledgeGate(s, "instagram_business_account");
      s = advance(s, ig);
      s = advance(s, ig);
      s = markCredentialsSaved(s, "1234");
      s = advance(s, ig);
      expect(s.currentStep).toBe("connect");
      expect(canAdvance(s, ig).ok).toBe(false);
      s = markConnected(s, "account-xyz");
      expect(s.connectedAccountId).toBe("account-xyz");
      expect(s.completedSteps).toContain("connect");
    });
  });

  describe("localStorage persistence", () => {
    it("round-trips state by platform", () => {
      let s = blankState("instagram");
      s = acknowledgeGate(s, "instagram_business_account");
      saveState(s);
      const loaded = loadState("instagram");
      expect(loaded).not.toBeNull();
      expect(loaded?.acknowledgedGates).toContain("instagram_business_account");
    });

    it("keeps separate state per platform", () => {
      saveState(acknowledgeGate(blankState("instagram"), "instagram_business_account"));
      saveState(setRedditChoice(blankState("reddit"), "personal"));
      const igLoaded = loadState("instagram");
      const redditLoaded = loadState("reddit");
      expect(igLoaded?.acknowledgedGates).toContain("instagram_business_account");
      expect(redditLoaded?.redditUseChoice).toBe("personal");
      expect(igLoaded?.redditUseChoice).toBeUndefined();
    });

    it("clearState removes the entry", () => {
      saveState(acknowledgeGate(blankState("instagram"), "instagram_business_account"));
      clearState("instagram");
      expect(loadState("instagram")).toBeNull();
    });

    it("expires entries older than 7 days", () => {
      const stale = {
        ...blankState("instagram"),
        updatedAt: Date.now() - 8 * 24 * 3600_000,
      };
      window.localStorage.setItem(
        "paperclip.social-wizard.v1.instagram",
        JSON.stringify(stale),
      );
      expect(loadState("instagram")).toBeNull();
      // and the read should have evicted it
      expect(window.localStorage.getItem("paperclip.social-wizard.v1.instagram")).toBeNull();
    });
  });
});

/**
 * Pure state-machine + persistence helpers for the SocialConnectWizard.
 *
 * Split out from the component so it's trivial to test (no React, no DOM)
 * and so the localStorage-resume contract has a single owner.
 *
 * Step semantics:
 *   1. "what-you-need"  — gates + cost confirmation (e.g. IG Business
 *                          check, X paid-tier consent, Reddit commercial
 *                          routing).
 *   2. "register-app"   — deep-link to dev console, show app config.
 *   3. "paste-creds"    — paste & test client ID / secret.
 *   4. "connect"        — popup to OAuth consent, wait for callback.
 *
 * The wizard treats steps as numbered 1..4. Internally we hold an array
 * of step ids so the order can change per-platform without renumbering.
 */
import type {
  SocialPlatform,
  WizardGateKind,
  WizardPlatformSpec,
} from "@paperclipai/shared";

export type WizardStepId =
  | "what-you-need"
  | "register-app"
  | "paste-creds"
  | "connect";

export const DEFAULT_STEP_ORDER: WizardStepId[] = [
  "what-you-need",
  "register-app",
  "paste-creds",
  "connect",
];

export interface WizardState {
  platform: SocialPlatform;
  currentStep: WizardStepId;
  /** Steps the user has explicitly completed (Next pressed). */
  completedSteps: WizardStepId[];
  /** Gate confirmations the user has ticked, keyed by gate kind. */
  acknowledgedGates: WizardGateKind[];
  /**
   * For Reddit only — "personal" advances, "commercial" routes the user
   * out of the wizard with an instructional exit screen.
   */
  redditUseChoice?: "personal" | "commercial";
  /** Mirrored last-4 of the saved secret (so re-opening shows confirmation). */
  credentialLast4?: string | null;
  /** When step 4 successfully completed, the new account id. */
  connectedAccountId?: string | null;
  /** Tracking last-edit timestamp so we can decay old states (TTL 7d). */
  updatedAt: number;
}

const STORAGE_KEY_PREFIX = "paperclip.social-wizard.v1.";
const STATE_TTL_MS = 7 * 24 * 3600_000;

export function storageKey(platform: SocialPlatform): string {
  return `${STORAGE_KEY_PREFIX}${platform}`;
}

export function blankState(platform: SocialPlatform): WizardState {
  return {
    platform,
    currentStep: "what-you-need",
    completedSteps: [],
    acknowledgedGates: [],
    updatedAt: Date.now(),
  };
}

export function loadState(platform: SocialPlatform): WizardState | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const raw = window.localStorage.getItem(storageKey(platform));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WizardState;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.platform !== platform) return null;
    if (typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > STATE_TTL_MS) {
      window.localStorage.removeItem(storageKey(platform));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: WizardState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const toWrite: WizardState = { ...state, updatedAt: Date.now() };
  window.localStorage.setItem(storageKey(state.platform), JSON.stringify(toWrite));
}

export function clearState(platform: SocialPlatform): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(storageKey(platform));
}

/**
 * Decide if the user can advance from `state.currentStep` to the next
 * step. Returns either { ok: true } or { ok: false, reason }.
 *
 * The reason string is shown next to the disabled Next button — keep it
 * short and actionable.
 */
export function canAdvance(
  state: WizardState,
  spec: WizardPlatformSpec | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!spec) return { ok: false, reason: "Platform spec not loaded" };

  switch (state.currentStep) {
    case "what-you-need": {
      // Every blocking gate must be acknowledged.
      for (const gate of spec.gates) {
        if (!gate.blocking) continue;
        if (gate.kind === "reddit_commercial_route") {
          if (!state.redditUseChoice) {
            return { ok: false, reason: "Pick personal or commercial first" };
          }
          if (state.redditUseChoice === "commercial") {
            return {
              ok: false,
              reason: "Commercial route exits the wizard — contact Reddit",
            };
          }
          continue;
        }
        if (!state.acknowledgedGates.includes(gate.kind)) {
          return { ok: false, reason: `Confirm: ${gate.label}` };
        }
      }
      return { ok: true };
    }
    case "register-app":
      // No machine-checkable preconditions; user advances when they've
      // configured the app on the platform's dashboard.
      return { ok: true };
    case "paste-creds":
      if (!state.credentialLast4) {
        return { ok: false, reason: "Save & test credentials first" };
      }
      return { ok: true };
    case "connect":
      if (!state.connectedAccountId) {
        return { ok: false, reason: "Finish the OAuth handshake to close out" };
      }
      return { ok: true };
  }
}

/** Move forward; returns the new state. No-op if cannot advance. */
export function advance(
  state: WizardState,
  spec: WizardPlatformSpec | null | undefined,
): WizardState {
  if (!canAdvance(state, spec).ok) return state;
  const idx = DEFAULT_STEP_ORDER.indexOf(state.currentStep);
  if (idx < 0 || idx >= DEFAULT_STEP_ORDER.length - 1) return state;
  const completed = state.completedSteps.includes(state.currentStep)
    ? state.completedSteps
    : [...state.completedSteps, state.currentStep];
  return {
    ...state,
    currentStep: DEFAULT_STEP_ORDER[idx + 1],
    completedSteps: completed,
    updatedAt: Date.now(),
  };
}

/** Step back; cannot go before step 1. */
export function regress(state: WizardState): WizardState {
  const idx = DEFAULT_STEP_ORDER.indexOf(state.currentStep);
  if (idx <= 0) return state;
  return {
    ...state,
    currentStep: DEFAULT_STEP_ORDER[idx - 1],
    updatedAt: Date.now(),
  };
}

export function acknowledgeGate(state: WizardState, kind: WizardGateKind): WizardState {
  if (state.acknowledgedGates.includes(kind)) return state;
  return {
    ...state,
    acknowledgedGates: [...state.acknowledgedGates, kind],
    updatedAt: Date.now(),
  };
}

export function unacknowledgeGate(state: WizardState, kind: WizardGateKind): WizardState {
  if (!state.acknowledgedGates.includes(kind)) return state;
  return {
    ...state,
    acknowledgedGates: state.acknowledgedGates.filter((k) => k !== kind),
    updatedAt: Date.now(),
  };
}

export function setRedditChoice(
  state: WizardState,
  choice: "personal" | "commercial",
): WizardState {
  return { ...state, redditUseChoice: choice, updatedAt: Date.now() };
}

export function markCredentialsSaved(
  state: WizardState,
  last4: string | null,
): WizardState {
  return { ...state, credentialLast4: last4, updatedAt: Date.now() };
}

export function markConnected(state: WizardState, accountId: string): WizardState {
  return {
    ...state,
    connectedAccountId: accountId,
    completedSteps: state.completedSteps.includes("connect")
      ? state.completedSteps
      : [...state.completedSteps, "connect"],
    updatedAt: Date.now(),
  };
}

export function stepIndex(stepId: WizardStepId): number {
  const i = DEFAULT_STEP_ORDER.indexOf(stepId);
  return i < 0 ? 0 : i;
}

export function totalSteps(): number {
  return DEFAULT_STEP_ORDER.length;
}

/**
 * Standalone demo entry for capturing wizard screenshots.
 *
 * Mounts the SocialConnectWizard with a mocked socialApi and a hard-coded
 * `?step=N&platform=instagram` query string so a Playwright script can
 * walk through each step deterministically without spinning up the full
 * backend stack.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WIZARD_PLATFORM_SPECS } from "@paperclipai/shared";
import type {
  SocialAppCredentialPublic,
  SocialAppCredentialTestResult,
  SocialPlatform,
} from "@paperclipai/shared";
import "./index.css";
import { SocialConnectWizard } from "./components/social/wizard/SocialConnectWizard";
import {
  acknowledgeGate,
  blankState,
  markConnected,
  markCredentialsSaved,
  saveState,
  setRedditChoice,
} from "./components/social/wizard/wizard-state";
import { queryKeys } from "./lib/queryKeys";
import { ToastProvider } from "./context/ToastContext";

const params = new URLSearchParams(window.location.search);
const platform = (params.get("platform") ?? "instagram") as SocialPlatform;
const stepParam = Number.parseInt(params.get("step") ?? "1", 10);

// Pre-populated mock data — read by both the prefilled React Query cache
// (so step 1 doesn't show "Loading wizard…") and by the mutation handlers
// that replace fetch calls.
const mockCredentials: SocialAppCredentialPublic = {
  platform,
  clientId: "1234567890123456",
  clientSecretLast4: "f00d",
  redirectUri: `https://paperclip.augiport.com/auth/social-callback/${platform}`,
  lastValidatedAt: new Date(),
  lastValidationStatus: "ok",
  lastValidationMessage: "Format looks correct.",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTestResult: SocialAppCredentialTestResult = {
  ok: true,
  message: "Format looks correct. Step 4 will exchange these for a real token.",
};

// Seed the wizard state for the requested step.
function seedState() {
  let s = blankState(platform);
  if (platform === "instagram" && stepParam >= 2) {
    s = acknowledgeGate(s, "instagram_business_account");
  }
  if (platform === "twitter" && stepParam >= 2) {
    s = acknowledgeGate(s, "x_paid_tier");
  }
  if (platform === "reddit" && stepParam >= 2) {
    s = setRedditChoice(s, "personal");
  }
  if (stepParam >= 2) s = { ...s, currentStep: "register-app", completedSteps: ["what-you-need"] };
  if (stepParam >= 3) {
    s = { ...s, currentStep: "paste-creds", completedSteps: [...s.completedSteps, "register-app"] };
    s = markCredentialsSaved(s, "f00d");
  }
  if (stepParam >= 4) {
    s = { ...s, currentStep: "connect", completedSteps: [...s.completedSteps, "paste-creds"] };
  }
  if (stepParam >= 5) {
    s = markConnected(s, "demo-account-id");
  }
  saveState(s);
}
seedState();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

// Pre-seed query cache so the wizard renders steps without hitting network.
queryClient.setQueryData(queryKeys.social.wizardSpecs, {
  callbackBase: "https://paperclip.augiport.com/auth/social-callback",
  specs: WIZARD_PLATFORM_SPECS,
});
queryClient.setQueryData(
  queryKeys.social.credentialsByPlatform(platform),
  stepParam >= 3 ? mockCredentials : null,
);

// Override the socialApi mutation handlers so Save/Test/Authorize don't
// 404 against the demo Vite server (no backend running here).
import("./api/social").then(({ socialApi }) => {
  socialApi.testCredentials = async () => mockTestResult;
  socialApi.saveCredentials = async () => mockCredentials;
  socialApi.wizardAuthorize = async () => ({
    authUrl: "about:blank",
    state: "demo-state",
    scopes: WIZARD_PLATFORM_SPECS[platform]?.oauth.scopes ?? [],
  });
});

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
          <SocialConnectWizard
            open
            onOpenChange={() => {}}
            companyId="demo-company"
            platform={platform}
          />
        </div>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// @vitest-environment jsdom

/**
 * Regression test for the iOS Safari popup-blocker bug on the X consent
 * button: window.open() must run *synchronously* inside the click handler
 * to preserve the user-gesture context. If it runs after an awaited fetch
 * (the old code did `onSuccess: (res) => window.open(res.authUrl)`), iOS
 * Safari silently swallows the popup and the button appears to do nothing.
 *
 * These tests don't render the full wizard (heavy: react-query + dialog
 * portal + toast provider). Instead they verify the StepConnect button
 * fires window.open synchronously, the popup is navigated once the
 * authorize URL arrives, and a top-level navigation fallback fires when
 * the popup is blocked.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WIZARD_PLATFORM_SPECS, type WizardPlatformSpec } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialConnectWizard } from "./SocialConnectWizard";
import { ToastProvider } from "../../../context/ToastContext";

const mockWizardSpecs = vi.hoisted(() => vi.fn());
const mockGetCredentials = vi.hoisted(() => vi.fn());
const mockWizardAuthorize = vi.hoisted(() => vi.fn());

vi.mock("../../../api/social", () => ({
  socialApi: {
    wizardSpecs: mockWizardSpecs,
    getCredentials: mockGetCredentials,
    wizardAuthorize: mockWizardAuthorize,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const xSpec = WIZARD_PLATFORM_SPECS.x as WizardPlatformSpec;

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function waitForButton(re: RegExp, attempts = 20): Promise<HTMLButtonElement> {
  for (let i = 0; i < attempts; i++) {
    const buttons = Array.from(
      document.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const btn = buttons.find((b) => re.test(b.textContent ?? ""));
    if (btn) return btn;
    await flush();
  }
  const buttons = Array.from(
    document.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  // eslint-disable-next-line no-console
  console.log("DEBUG buttons:", buttons.map((b) => b.textContent));
  // eslint-disable-next-line no-console
  console.log("DEBUG body excerpt:", document.body.textContent?.slice(0, 500));
  throw new Error(`Button matching ${re} not found after ${attempts} attempts`);
}

describe("SocialConnectWizard StepConnect — iOS popup gesture preservation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let fakePopup: { closed: boolean; close: () => void; location: { href: string } };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    window.localStorage.clear();

    mockWizardSpecs.mockResolvedValue({
      callbackBase: "https://paperclip.test/auth/social-callback",
      specs: { x: xSpec },
    });
    mockGetCredentials.mockResolvedValue({
      platform: "x",
      clientId: "test-client-id",
      clientSecretLast4: "abcd",
      redirectUri: null,
    });
    // Seed wizard so it starts on the "connect" step.
    window.localStorage.setItem(
      "paperclip.social-wizard.v1.x",
      JSON.stringify({
        platform: "x",
        currentStep: "connect",
        completedSteps: ["what-you-need", "register-app", "paste-creds"],
        acknowledgedGates: xSpec.gates.map((g) => g.kind),
        redditUseChoice: null,
        credentialLast4: "abcd",
        connectedAccountId: null,
        updatedAt: Date.now(),
      }),
    );

    fakePopup = {
      closed: false,
      close: vi.fn(() => {
        fakePopup.closed = true;
      }),
      location: { href: "" },
    };
    openSpy = vi.spyOn(window, "open");
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
    openSpy.mockRestore();
  });

  async function mountWizard() {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SocialConnectWizard
              open
              onOpenChange={() => {}}
              companyId="company-1"
              platform="x"
            />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
  }

  function findConsentButton(): Promise<HTMLButtonElement> {
    return waitForButton(/Open .* consent/);
  }

  it("opens window.open synchronously on click, before the authorize fetch resolves", async () => {
    let resolveAuthorize: (v: { authUrl: string; state: string; scopes: string[] }) => void = () => {};
    mockWizardAuthorize.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthorize = resolve;
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openSpy.mockReturnValue(fakePopup as any);

    await mountWizard();

    const button = await findConsentButton();

    act(() => {
      button.click();
    });

    // window.open MUST have been called synchronously in the same tick as
    // the click, with about:blank — before the fetch returns. This is what
    // preserves the iOS Safari user-gesture context. Assert this BEFORE any
    // flush so we know it ran inside the click handler, not after.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      expect.stringContaining("width"),
    );
    // The popup hasn't been navigated yet — the authorize fetch is in flight.
    expect(fakePopup.location.href).toBe("");

    // Let react-query schedule the mutation, then verify it fired.
    await flush();
    expect(mockWizardAuthorize).toHaveBeenCalledWith("company-1", "x");

    // Now resolve the authorize URL and verify the popup gets navigated.
    await act(async () => {
      resolveAuthorize({
        authUrl: "https://x.com/i/oauth2/authorize?scope=tweet.read",
        state: "abc",
        scopes: ["tweet.read"],
      });
      await flush();
    });
    expect(fakePopup.location.href).toBe(
      "https://x.com/i/oauth2/authorize?scope=tweet.read",
    );
  });

  it("falls back to top-level navigation when the popup blocker returns null", async () => {
    mockWizardAuthorize.mockResolvedValue({
      authUrl: "https://x.com/i/oauth2/authorize?fallback=1",
      state: "abc",
      scopes: [],
    });
    openSpy.mockReturnValue(null);

    // Patch window.location.href so we can observe the fallback navigation
    // without actually navigating jsdom.
    const originalLocation = window.location;
    let navigatedTo: string | null = null;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          navigatedTo = v;
        },
        get href() {
          return navigatedTo ?? originalLocation.href;
        },
      },
    });

    try {
      await mountWizard();
      const button = await findConsentButton();
      await act(async () => {
        button.click();
        await flush();
      });

      expect(openSpy).toHaveBeenCalledWith(
        "about:blank",
        "_blank",
        expect.any(String),
      );
      expect(navigatedTo).toBe("https://x.com/i/oauth2/authorize?fallback=1");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("shows an inline error and closes the popup when authorize fails", async () => {
    mockWizardAuthorize.mockRejectedValue(new Error("Save x app credentials first"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openSpy.mockReturnValue(fakePopup as any);

    await mountWizard();
    const button = await findConsentButton();

    await act(async () => {
      button.click();
      await flush();
      await flush();
    });

    expect(fakePopup.close).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Save x app credentials first");
  });
});

/**
 * Step-by-step OAuth onboarding wizard for the Social Scheduler.
 *
 * Replaces the AccountsTab's old one-click stub mutation with a guided
 * 4-step Dialog per platform:
 *
 *   1. What you need  — gates + cost callouts (per-platform quirks)
 *   2. Register app   — deep-link to dev console + copyable config
 *   3. Paste creds    — Client ID/Secret → encrypted on server
 *   4. Connect account — pop the platform's OAuth consent screen
 *
 * State persists to localStorage so closing mid-flow resumes where Tyler
 * left off. State machine lives in `./wizard-state` (pure functions, unit
 * tested in `wizard-state.test.ts`).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Mail,
  ShieldAlert,
} from "lucide-react";
import type {
  SocialAppCredentialPublic,
  SocialAppCredentialTestResult,
  SocialPlatform,
  WizardPlatformSpec,
} from "@paperclipai/shared";
import { socialApi } from "../../../api/social";
import { queryKeys } from "../../../lib/queryKeys";
import { useToastActions } from "../../../context/ToastContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "../../../lib/utils";
import { PLATFORM_META } from "../platform-meta";
import {
  acknowledgeGate,
  advance,
  blankState,
  canAdvance,
  clearState,
  DEFAULT_STEP_ORDER,
  loadState,
  markConnected,
  markCredentialsSaved,
  regress,
  saveState,
  setRedditChoice,
  stepIndex,
  totalSteps,
  unacknowledgeGate,
  type WizardState,
  type WizardStepId,
} from "./wizard-state";

export interface SocialConnectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  platform: SocialPlatform;
}

const STEP_LABEL: Record<WizardStepId, string> = {
  "what-you-need": "What you need",
  "register-app": "Register app",
  "paste-creds": "Paste credentials",
  "connect": "Connect account",
};

export function SocialConnectWizard({
  open,
  onOpenChange,
  companyId,
  platform,
}: SocialConnectWizardProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const meta = PLATFORM_META[platform];

  const specsQuery = useQuery({
    queryKey: queryKeys.social.wizardSpecs,
    queryFn: () => socialApi.wizardSpecs(),
    staleTime: 60 * 60_000,
    enabled: open,
  });
  const spec: WizardPlatformSpec | null =
    (specsQuery.data?.specs[platform] as WizardPlatformSpec | undefined) ?? null;

  const credentialsQuery = useQuery({
    queryKey: queryKeys.social.credentialsByPlatform(platform),
    queryFn: () => socialApi.getCredentials(platform),
    enabled: open,
  });

  const [state, setState] = useState<WizardState>(() => loadState(platform) ?? blankState(platform));
  useEffect(() => {
    if (!open) return;
    const loaded = loadState(platform) ?? blankState(platform);
    setState(loaded);
  }, [open, platform]);

  // Hydrate the saved last4 + connected account from server-side data.
  useEffect(() => {
    if (!credentialsQuery.data) return;
    if (state.credentialLast4 === credentialsQuery.data.clientSecretLast4) return;
    setState((prev) => ({
      ...prev,
      credentialLast4: credentialsQuery.data?.clientSecretLast4 ?? prev.credentialLast4 ?? null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialsQuery.data?.clientSecretLast4]);

  // Persist state whenever it changes.
  useEffect(() => {
    if (!open) return;
    saveState(state);
  }, [state, open]);

  const handleAdvance = () => {
    setState((prev) => advance(prev, spec));
  };
  const handleBack = () => setState((prev) => regress(prev));

  const handleClose = () => onOpenChange(false);

  const handleClearAndClose = () => {
    clearState(platform);
    setState(blankState(platform));
    onOpenChange(false);
  };

  const advanceCheck = canAdvance(state, spec);
  const stepNum = stepIndex(state.currentStep) + 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-2xl",
          "border-white/10 bg-zinc-950/90 text-zinc-100 backdrop-blur-xl shadow-2xl",
          "flex max-h-[90vh] flex-col gap-0 p-0",
        )}
      >
        <WizardHeader
          platform={platform}
          spec={spec}
          state={state}
          stepNum={stepNum}
        />

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!spec ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading wizard…
            </div>
          ) : state.currentStep === "what-you-need" ? (
            <StepWhatYouNeed spec={spec} state={state} setState={setState} />
          ) : state.currentStep === "register-app" ? (
            <StepRegisterApp spec={spec} />
          ) : state.currentStep === "paste-creds" ? (
            <StepPasteCreds
              spec={spec}
              state={state}
              setState={setState}
              existing={credentialsQuery.data ?? null}
              onSaved={(saved) => {
                queryClient.setQueryData(queryKeys.social.credentialsByPlatform(platform), saved);
              }}
            />
          ) : (
            <StepConnect
              spec={spec}
              state={state}
              setState={setState}
              companyId={companyId}
              meta={{ label: meta.label, color: meta.color }}
              onConnected={(accountId) => {
                pushToast({
                  title: `Connected ${meta.label}`,
                  tone: "success",
                });
                queryClient.invalidateQueries({
                  queryKey: queryKeys.social.accounts(companyId),
                });
                queryClient.invalidateQueries({
                  queryKey: queryKeys.social.credentialsByPlatform(platform),
                });
                setState((prev) => markConnected(prev, accountId));
              }}
            />
          )}
        </div>

        <DialogFooter
          className={cn(
            "flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4",
            "sm:flex-row",
          )}
        >
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {!advanceCheck.ok ? <span>{advanceCheck.reason}</span> : null}
            {state.currentStep === "connect" && state.connectedAccountId ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Account connected
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {stepNum > 1 ? (
              <Button variant="ghost" onClick={handleBack} className="text-zinc-300 hover:bg-white/5">
                Back
              </Button>
            ) : null}
            {state.currentStep === "connect" && state.connectedAccountId ? (
              <Button onClick={handleClearAndClose}>Done</Button>
            ) : state.currentStep === "connect" ? (
              <Button variant="outline" onClick={handleClose} className="border-white/10 text-zinc-200">
                Close — resume later
              </Button>
            ) : (
              <Button onClick={handleAdvance} disabled={!advanceCheck.ok}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Header (step indicator) ──────────────────────────────────────────────

function WizardHeader({
  platform,
  spec,
  state,
  stepNum,
}: {
  platform: SocialPlatform;
  spec: WizardPlatformSpec | null;
  state: WizardState;
  stepNum: number;
}) {
  const meta = PLATFORM_META[platform];
  return (
    <DialogHeader className="border-b border-white/10 p-6">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg shadow-black/30"
          style={{ backgroundColor: meta.color }}
          aria-hidden
        >
          <meta.icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base text-zinc-100">
            Connect {meta.label}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Step {stepNum} of {totalSteps()}
            {spec ? ` · ${spec.setupTime}` : ""}
          </DialogDescription>
        </div>
      </div>

      {/* Desktop step indicator */}
      <ol className="mt-5 hidden gap-1 sm:flex" aria-label="Wizard progress">
        {DEFAULT_STEP_ORDER.map((id, i) => {
          const isComplete = state.completedSteps.includes(id) ||
            (state.currentStep === "connect" && state.connectedAccountId && id !== "connect");
          const isCurrent = state.currentStep === id;
          return (
            <li
              key={id}
              className={cn(
                "flex-1 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide",
                isCurrent
                  ? "border-white/20 bg-white/10 text-zinc-100"
                  : isComplete
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : "border-white/5 bg-transparent text-zinc-500",
              )}
            >
              <span className="mr-1 opacity-60">{i + 1}.</span>
              {STEP_LABEL[id]}
            </li>
          );
        })}
      </ol>

      {/* Mobile: progress bar */}
      <div className="mt-4 h-1.5 w-full rounded-full bg-white/5 sm:hidden">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${(stepNum / totalSteps()) * 100}%` }}
        />
      </div>
    </DialogHeader>
  );
}

// ── Step 1: What you need ────────────────────────────────────────────────

function StepWhatYouNeed({
  spec,
  state,
  setState,
}: {
  spec: WizardPlatformSpec;
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          What you'll need
        </div>
        <div className="mt-2 grid gap-1.5 text-sm">
          <div className="flex justify-between gap-3 text-zinc-300">
            <span className="text-zinc-500">App type:</span>
            <span className="text-right">{spec.appKind}</span>
          </div>
          <div className="flex justify-between gap-3 text-zinc-300">
            <span className="text-zinc-500">Estimated setup time:</span>
            <span className="text-right">{spec.setupTime}</span>
          </div>
          <div className="flex justify-between gap-3 text-zinc-300">
            <span className="text-zinc-500">Developer console:</span>
            <a
              href={spec.developerConsoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {spec.cost ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4">
          <div className="flex items-start gap-2">
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-200">
              Cost
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-amber-100">{spec.cost.rangeLabel}</div>
              <div className="mt-1 text-xs leading-5 text-amber-100/70">
                {spec.cost.detail}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {spec.callouts.map((c) => (
        <div
          key={c.title}
          className={cn(
            "rounded-lg border p-4 text-sm",
            c.tone === "warn"
              ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-100"
              : c.tone === "success"
              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100"
              : "border-sky-500/20 bg-sky-500/[0.06] text-sky-100",
          )}
        >
          <div className="font-medium">{c.title}</div>
          <div className="mt-1 text-xs leading-5 opacity-80">{c.body}</div>
        </div>
      ))}

      {spec.gates.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Confirm before continuing
          </div>
          {spec.gates.map((gate) => {
            // Reddit's gate is a radio, not a checkbox.
            if (gate.kind === "reddit_commercial_route") {
              return (
                <div
                  key={gate.kind}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="font-medium text-zinc-100">{gate.label}</div>
                  <div className="mt-1 text-xs text-zinc-400">{gate.detail}</div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <label
                      className={cn(
                        "flex flex-1 items-center gap-2 rounded-md border p-2.5 text-sm transition cursor-pointer",
                        state.redditUseChoice === "personal"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                          : "border-white/10 hover:border-white/20",
                      )}
                    >
                      <input
                        type="radio"
                        name="reddit-use"
                        checked={state.redditUseChoice === "personal"}
                        onChange={() => setState((prev) => setRedditChoice(prev, "personal"))}
                        className="accent-emerald-400"
                      />
                      <div>
                        <div className="font-medium">Personal use</div>
                        <div className="text-[11px] opacity-70">Free • up to 100 QPM</div>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex flex-1 items-center gap-2 rounded-md border p-2.5 text-sm transition cursor-pointer",
                        state.redditUseChoice === "commercial"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                          : "border-white/10 hover:border-white/20",
                      )}
                    >
                      <input
                        type="radio"
                        name="reddit-use"
                        checked={state.redditUseChoice === "commercial"}
                        onChange={() => setState((prev) => setRedditChoice(prev, "commercial"))}
                        className="accent-rose-400"
                      />
                      <div>
                        <div className="font-medium">Commercial use</div>
                        <div className="text-[11px] opacity-70">Reddit contract required</div>
                      </div>
                    </label>
                  </div>
                  {state.redditUseChoice === "commercial" ? (
                    <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/[0.08] p-3 text-sm text-rose-100">
                      <div className="flex items-start gap-2">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <div className="font-medium">Contact Reddit directly</div>
                          <div className="mt-1 text-xs leading-5 opacity-90">
                            Commercial use of the Reddit API requires a contract with
                            Reddit's developer platform team. Email{" "}
                            <a
                              href="mailto:dev-platform@reddit.com"
                              className="underline"
                            >
                              dev-platform@reddit.com
                            </a>{" "}
                            — lead time is weeks-to-months. The wizard can't proceed
                            until you have a commercial agreement and a separate Reddit
                            OAuth client provisioned for it.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }
            const checked = state.acknowledgedGates.includes(gate.kind);
            return (
              <label
                key={gate.kind}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition",
                  checked
                    ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) =>
                    setState((prev) =>
                      ev.target.checked
                        ? acknowledgeGate(prev, gate.kind)
                        : unacknowledgeGate(prev, gate.kind),
                    )
                  }
                  className="mt-1 size-4 accent-emerald-400"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-100">{gate.label}</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-400">{gate.detail}</div>
                  {gate.href ? (
                    <a
                      href={gate.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      Open helper docs <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── Step 2: Register the app ────────────────────────────────────────────

function StepRegisterApp({ spec }: { spec: WizardPlatformSpec }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-100">
              Open the {spec.label} developer console
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              Create a new app there with the configuration below, then come back here.
            </div>
          </div>
          <Button asChild>
            <a href={spec.developerConsoleUrl} target="_blank" rel="noopener noreferrer">
              Open dashboard <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          App configuration to enter
        </div>
        <div className="mt-2 grid gap-2">
          {spec.appConfig.map((entry) => (
            <CopyableRow key={entry.label} label={entry.label} value={entry.value} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-4 text-sm text-sky-100">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Keep this tab open</div>
            <div className="mt-1 text-xs leading-5 opacity-80">
              Step 3 needs the Client ID + Secret the dashboard hands you after the
              app is created. They're shown once — paste them straight into the
              wizard rather than emailing them to yourself.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid grid-cols-[140px_1fr_auto] items-center gap-3 rounded-md border border-white/10 bg-zinc-950/40 p-2.5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="truncate font-mono text-xs text-zinc-200">{value}</div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-200"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard may be blocked in tests */
          }
        }}
      >
        <ClipboardCopy className="h-3 w-3" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ── Step 3: Paste credentials ───────────────────────────────────────────

function StepPasteCreds({
  spec,
  state,
  setState,
  existing,
  onSaved,
}: {
  spec: WizardPlatformSpec;
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  existing: SocialAppCredentialPublic | null;
  onSaved: (saved: SocialAppCredentialPublic) => void;
}) {
  const [clientId, setClientId] = useState(existing?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [testResult, setTestResult] = useState<SocialAppCredentialTestResult | null>(null);

  useEffect(() => {
    if (existing?.clientId && !clientId) setClientId(existing.clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.clientId]);

  const testMutation = useMutation({
    mutationFn: () =>
      socialApi.testCredentials(spec.platform, { clientId, clientSecret }),
    onSuccess: (res) => setTestResult(res),
    onError: (err) =>
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      socialApi.saveCredentials(spec.platform, { clientId, clientSecret }),
    onSuccess: (saved) => {
      onSaved(saved);
      setState((prev) => markCredentialsSaved(prev, saved.clientSecretLast4));
      setClientSecret("");
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="client-id" className="text-zinc-300">
          {spec.credentialFields.clientIdLabel}
        </Label>
        <Input
          id="client-id"
          value={clientId}
          onChange={(ev) => setClientId(ev.target.value)}
          placeholder="Paste from developer console"
          className="mt-1.5 bg-zinc-950/60 border-white/10 text-zinc-100"
        />
        {spec.credentialFields.clientIdHint ? (
          <div className="mt-1 text-[11px] text-zinc-500">{spec.credentialFields.clientIdHint}</div>
        ) : null}
      </div>

      <div>
        <Label htmlFor="client-secret" className="text-zinc-300">
          {spec.credentialFields.clientSecretLabel}
        </Label>
        <Input
          id="client-secret"
          type="password"
          value={clientSecret}
          onChange={(ev) => setClientSecret(ev.target.value)}
          placeholder={
            existing?.clientSecretLast4
              ? `Saved · ending ${existing.clientSecretLast4} (paste to replace)`
              : "Paste from developer console"
          }
          className="mt-1.5 bg-zinc-950/60 border-white/10 font-mono text-zinc-100"
        />
        {spec.credentialFields.clientSecretHint ? (
          <div className="mt-1 text-[11px] text-zinc-500">{spec.credentialFields.clientSecretHint}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="border-white/10 text-zinc-200"
          onClick={() => testMutation.mutate()}
          disabled={!clientId || !clientSecret || testMutation.isPending}
        >
          {testMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Test format
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={
            !clientId || !clientSecret || saveMutation.isPending || testResult?.ok === false
          }
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save & encrypt
        </Button>
      </div>

      {testResult ? (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            testResult.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border-rose-500/30 bg-rose-500/10 text-rose-100",
          )}
        >
          {testResult.message}
        </div>
      ) : null}

      {state.credentialLast4 ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-sm text-emerald-100">
          <CheckCircle2 className="mr-1 inline h-4 w-4 align-text-bottom" />
          Saved. Secret ends in <code className="font-mono">{state.credentialLast4}</code> —
          encrypted at rest with the instance master key.
        </div>
      ) : null}
    </div>
  );
}

// ── Step 4: Connect account ─────────────────────────────────────────────

function StepConnect({
  spec,
  state,
  setState,
  companyId,
  meta,
  onConnected,
}: {
  spec: WizardPlatformSpec;
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  companyId: string;
  meta: { label: string; color: string };
  onConnected: (accountId: string) => void;
}) {
  const [popupRef, setPopupRef] = useState<Window | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const authorizeMutation = useMutation({
    mutationFn: () => socialApi.wizardAuthorize(companyId, spec.platform),
  });

  const handleOpenConsent = () => {
    setAuthError(null);
    // iOS Safari blocks window.open() if it runs after an awaited fetch — the
    // user-gesture context is lost across the async boundary. So open a blank
    // popup synchronously *inside* the click handler to keep the gesture, then
    // navigate it once the authorize URL comes back. If the popup is blocked
    // anyway (popup === null), fall back to a top-level navigation, which a
    // popup blocker cannot stop.
    const popup = window.open("about:blank", "_blank", "width=600,height=720");
    if (popup) setPopupRef(popup);

    authorizeMutation.mutate(undefined, {
      onSuccess: (res) => {
        try {
          if (popup && !popup.closed) {
            popup.location.href = res.authUrl;
          } else {
            window.location.href = res.authUrl;
          }
        } catch {
          window.location.href = res.authUrl;
        }
      },
      onError: (err) => {
        try {
          popup?.close();
        } catch {
          /* ignore */
        }
        setAuthError(err instanceof Error ? err.message : String(err));
      },
    });
  };

  // Listen for the postMessage from /auth/social-callback/:platform.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            ok?: boolean;
            platform?: string;
            accountId?: string | null;
            message?: string;
            errorCode?: string | null;
          }
        | null;
      if (!data || data.type !== "paperclip-social-callback") return;
      if (data.platform !== spec.platform) return;
      if (data.ok && data.accountId) {
        setAuthError(null);
        onConnected(data.accountId);
      } else if (data.ok === false) {
        setAuthError(data.message ?? "OAuth handshake failed");
      }
      try {
        popupRef?.close();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [spec.platform, onConnected, popupRef]);

  const connected = Boolean(state.connectedAccountId);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: meta.color }}
            aria-hidden
          >
            <ExternalLink className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-100">
              Open {meta.label}'s consent screen
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              We'll open a new tab on {spec.label}, you authorize Paperclip with the
              scopes below, and the platform redirects back to{" "}
              <code className="text-zinc-300">
                /auth/social-callback/{spec.platform}
              </code>
              . The account is then saved to your company.
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {spec.oauth.scopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded-md border border-white/10 bg-zinc-950/60 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Button
        onClick={handleOpenConsent}
        disabled={authorizeMutation.isPending || connected}
        className="w-full sm:w-auto"
      >
        {authorizeMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        {connected ? "Re-authorize" : `Open ${meta.label} consent`}
      </Button>

      {connected ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          <CheckCircle2 className="mr-1 inline h-4 w-4 align-text-bottom" />
          {meta.label} account connected. It now shows in the Accounts tab.
        </div>
      ) : null}

      {authError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          <AlertTriangle className="mr-1 inline h-4 w-4 align-text-bottom" />
          {authError}
        </div>
      ) : null}

      {spec.needsMetaAppReview && spec.scopesForAppReview ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-4 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Meta App Review needed for production</div>
              <div className="mt-1 text-xs leading-5 opacity-90">
                These scopes only work for app developers/testers until reviewed:
                {" "}
                <span className="font-mono">
                  {spec.scopesForAppReview.join(", ")}
                </span>
                . Submit each one (screencast + written justification) at{" "}
                <a
                  href="https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Meta App Review
                </a>
                {" "}— typical review takes 1–5 business days per scope.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

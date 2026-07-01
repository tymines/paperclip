/**
 * InstanceProviderKeys — Instance Settings tab where Tyler pastes model-
 * provider API keys (DeepSeek / Moonshot / OpenAI admin / Anthropic admin
 * / Gemini service account).
 *
 * Storage is file-backed at ~/.paperclip/provider-api-keys.json. Augi /
 * August can write that file directly to inject keys without touching
 * the UI; the UI's Save action just calls the same write path.
 *
 * Security: the raw key never leaves the server after a Save. Subsequent
 * GETs return only last-4 + lastUpdated. Test-connection happens entirely
 * server-side using the stored key so the secret never round-trips.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, RotateCw, Share2, Sparkles, TriangleAlert, X } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { costsApi } from "@/api/costs";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCostUsdCompact, formatTokens } from "../lib/utils";

type ProviderKey =
  | "deepseek"
  | "moonshot"
  | "openai"
  | "anthropic"
  | "gemini"
  | "elevenlabs"
  | "replicate"
  | "atlascloud"
  | "wavespeedai";

interface ProviderMeta {
  key: ProviderKey;
  name: string;
  description: string;
  placeholder: string;
  dashboardUrl: string;
  /** Whether the test endpoint can return a real balance for this provider. */
  testReturnsBalance: boolean;
  /** A note shown below the input when the field needs special handling. */
  note?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek API key — used for balance fetch and (later) per-request cost lookups.",
    placeholder: "sk-…",
    dashboardUrl: "https://platform.deepseek.com/api_keys",
    testReturnsBalance: true,
  },
  {
    key: "moonshot",
    name: "Moonshot / Kimi",
    description: "Moonshot platform key (CNY billing).",
    placeholder: "sk-…",
    dashboardUrl: "https://platform.moonshot.cn/console/api-keys",
    testReturnsBalance: true,
  },
  {
    key: "openai",
    name: "OpenAI",
    description: "Admin key (org-scoped) — needed for /v1/organization/usage.",
    placeholder: "sk-admin-…",
    dashboardUrl: "https://platform.openai.com/settings/organization/admin-keys",
    testReturnsBalance: false,
    note: "OpenAI doesn't expose credit balance via API — Test connection only verifies the key is reachable.",
  },
  {
    key: "anthropic",
    name: "Anthropic",
    description: "Org Admin key (different from a workspace key).",
    placeholder: "sk-ant-…",
    dashboardUrl: "https://console.anthropic.com/settings/admin-keys",
    testReturnsBalance: false,
    note: "Anthropic doesn't expose balance via API. Test connection will verify the key shape; spending lights up once Augi finishes the usage-report wiring.",
  },
  {
    key: "gemini",
    name: "Gemini (Google AI)",
    description: "Service account JSON (paste contents) or AI Studio API key.",
    placeholder: "{ \"type\": \"service_account\", … }",
    dashboardUrl: "https://aistudio.google.com/apikey",
    testReturnsBalance: false,
    note: "Real wiring requires a GCP project with the Cloud Billing API enabled. Stub adapter accepts any non-empty string for now.",
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    description: "Streaming TTS for Jarvis premium voice. The Webhook configuration subsection below registers the receiver for voice-removal + transcription events.",
    placeholder: "xi-…",
    dashboardUrl: "https://elevenlabs.io/app/settings/api-keys",
    testReturnsBalance: false,
    note: "ElevenLabs doesn't expose credit balance via API — Test connection only verifies the key shape. Webhook secret and URL live in the Webhook configuration subsection below.",
  },
  {
    key: "replicate",
    name: "Replicate",
    description: "Hosted LoRA training (ostris/flux-dev-lora-trainer) for Image Studio personas. Save here, or use POST /api/credentials/replicate which verifies before storing.",
    placeholder: "r8_…",
    dashboardUrl: "https://replicate.com/account/api-tokens",
    testReturnsBalance: false,
    // The "Paste a new key to replace …last4" input below IS the rotate
    // affordance — replacing the value rotates the stored token.
    // TODO(rotate): Tyler's first token was shared in plaintext chat — surface
    // a prominent "rotate now" prompt after the first successful training, and
    // consider tracking token age to nudge periodic rotation.
    note: "Replicate doesn't expose balance via API — Test only verifies the token. To rotate, paste a new token above; it replaces the stored one. Rotate the bootstrap token after the first training succeeds.",
  },
  {
    key: "atlascloud",
    name: "Atlas Cloud",
    description: "OpenAI-compatible LLM gateway (api.atlascloud.ai/v1) — one key, many open-source models. Bearer auth.",
    placeholder: "apikey-…",
    dashboardUrl: "https://www.atlascloud.ai/console/api-keys",
    testReturnsBalance: false,
    note: "Atlas Cloud has no account/username endpoint — Test verifies the token against GET /v1/models. To rotate, paste a new token above.",
  },
  {
    key: "wavespeedai",
    name: "WaveSpeed AI",
    description: "Image/video generation API (api.wavespeed.ai/api/v3). Bearer auth; the wsk_live_ prefix is a production key.",
    placeholder: "wsk_live_…",
    dashboardUrl: "https://wavespeed.ai/accesskey",
    testReturnsBalance: false,
    note: "WaveSpeed exposes balance via GET /api/v3/balance (USD); a balance adapter isn't wired into Test yet. To rotate, paste a new token above.",
  },
];

export function InstanceProviderKeys() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId, selectedCompany } = useCompany();
  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "Provider API Keys" }]);
  }, [setBreadcrumbs]);

  const queryClient = useQueryClient();
  const keysQuery = useQuery({
    queryKey: ["instance", "provider-keys"],
    queryFn: () => instanceSettingsApi.listProviderKeys(),
  });

  // 30-day spend rollup by provider for the currently selected company,
  // so operators don't need to leave Provider Keys → Costs to see whether
  // a saved key is actually being used (and how much).
  const since = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString();
  }, []);
  const { data: providerSpend } = useQuery({
    queryKey: ["instance", "provider-keys", "spend", selectedCompanyId ?? "__none__", since],
    queryFn: () => costsApi.byProvider(selectedCompanyId!, since),
    enabled: !!selectedCompanyId,
  });
  const spendByProviderKey = useMemo(() => {
    const map = new Map<string, { costCents: number; inputTokens: number; outputTokens: number }>();
    for (const row of providerSpend ?? []) {
      const key = row.provider.toLowerCase();
      const existing = map.get(key) ?? { costCents: 0, inputTokens: 0, outputTokens: 0 };
      existing.costCents += row.costCents;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      map.set(key, existing);
    }
    return map;
  }, [providerSpend]);

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Provider API Keys</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste a key once; it's stored on disk at
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">~/.paperclip/provider-api-keys.json</code>
          (mode 0600). The raw value never leaves the server after save — subsequent reads return
          only the last four characters + the timestamp. The Providers tab on Costs starts using
          each key within a refresh cycle of saving.
        </p>
        {selectedCompany ? (
          <p className="text-xs text-muted-foreground">
            Spend readouts below are scoped to <span className="font-medium text-foreground">{selectedCompany.name}</span>'s last 30 days.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select a company to see per-provider spend.
          </p>
        )}
      </header>

      <div className="space-y-4">
        {PROVIDERS.map((meta) => {
          const status = keysQuery.data?.find((entry) => entry.provider === meta.key);
          return (
            <ProviderRow
              key={meta.key}
              meta={meta}
              hasKey={status?.hasKey ?? false}
              last4={status?.last4 ?? null}
              updatedAt={status?.updatedAt ?? null}
              spend30d={spendByProviderKey.get(meta.key) ?? null}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["instance", "provider-keys"] })}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ProviderRowProps {
  meta: ProviderMeta;
  hasKey: boolean;
  last4: string | null;
  updatedAt: string | null;
  spend30d: { costCents: number; inputTokens: number; outputTokens: number } | null;
  onSaved: () => void;
}

function ProviderRow({ meta, hasKey, last4, updatedAt, spend30d, onSaved }: ProviderRowProps) {
  const [value, setValue] = useState("");
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The Replicate token was first stored 2026-06-02 and was exposed in chat logs
  // multiple times. Nudge a rotation (not a block) if it hasn't been replaced
  // since the day it was first stored.
  const isReplicate = meta.key === "replicate";
  const tokenStale =
    isReplicate &&
    hasKey &&
    (!updatedAt || new Date(updatedAt).getTime() < Date.parse("2026-06-03T00:00:00Z"));

  const focusInput = () => {
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    inputRef.current?.focus();
  };

  const saveMutation = useMutation({
    mutationFn: () => instanceSettingsApi.setProviderKey(meta.key, value),
    onSuccess: () => {
      setValue("");
      onSaved();
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => instanceSettingsApi.setProviderKey(meta.key, ""),
    onSuccess: () => {
      setValue("");
      setTestResult(null);
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: () => instanceSettingsApi.testProviderKey(meta.key),
    onSuccess: (result) => {
      if (result.ok) {
        if (typeof result.balance === "number") {
          const formatter = new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: result.currency || "USD",
            maximumFractionDigits: 2,
          });
          setTestResult({
            ok: true,
            message: `Balance: ${formatter.format(result.balance)}`,
          });
        } else {
          setTestResult({ ok: true, message: "Reachable (no balance returned)." });
        }
      } else {
        setTestResult({ ok: false, message: result.error || "Test failed." });
      }
    },
    onError: (err) => {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    },
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{meta.name}</h2>
            {hasKey ? (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                Saved · …{last4}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Not set
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{meta.description}</p>
          {updatedAt ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Last updated {new Date(updatedAt).toLocaleString()}
            </p>
          ) : null}
          {spend30d && (spend30d.costCents > 0 || spend30d.inputTokens + spend30d.outputTokens > 0) ? (
            <p
              className="mt-1 inline-flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground"
              data-pp-provider-30d-spend={meta.key}
              title={`Last 30 days · $${(spend30d.costCents / 100).toFixed(4)} · ${spend30d.inputTokens + spend30d.outputTokens} tokens`}
            >
              <span className="text-foreground/80">
                30d {formatCostUsdCompact(spend30d.costCents / 100)}
              </span>
              {spend30d.inputTokens + spend30d.outputTokens > 0 ? (
                <span>· {formatTokens(spend30d.inputTokens + spend30d.outputTokens)}t</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <a
          href={meta.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Get a key →
        </a>
      </div>

      {tokenStale ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10"
          data-testid="replicate-rotate-banner"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              This token hasn't been rotated since it was first stored on 2026-06-02.
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300/90">
              It was exposed in chat logs — rotate it now: create a fresh token at{" "}
              <a
                href={meta.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                replicate.com
              </a>{" "}
              and paste it below.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={focusInput}
            className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-200"
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Rotate now
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div>
          <Label htmlFor={`${meta.key}-input`} className="sr-only">
            {meta.name} API key
          </Label>
          <Input
            ref={inputRef}
            id={`${meta.key}-input`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={hasKey ? `Paste a new key to replace …${last4}` : meta.placeholder}
            className="font-mono text-xs"
          />
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!value.trim() || saveMutation.isPending}
          size="sm"
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={!hasKey || testMutation.isPending}
          title={!hasKey ? "Save a key first" : `Test ${meta.name} connection`}
        >
          {testMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
        </Button>
      </div>

      {meta.note ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{meta.note}</p>
      ) : null}

      {testResult ? (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
            testResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {testResult.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          {testResult.message}
        </div>
      ) : null}

      {hasKey ? (
        <div className="mt-3 flex items-center gap-1">
          {isReplicate ? (
            <Button variant="ghost" size="sm" onClick={focusInput}>
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              Rotate now
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!window.confirm(`Clear the ${meta.name} key?`)) return;
              clearMutation.mutate();
            }}
            disabled={clearMutation.isPending}
            className="text-destructive hover:text-destructive"
          >
            Clear key
          </Button>
        </div>
      ) : null}

      {meta.key === "elevenlabs" ? <ElevenLabsWebhookSection /> : null}
    </section>
  );
}

function ElevenLabsWebhookSection() {
  const queryClient = useQueryClient();
  const webhookQuery = useQuery({
    queryKey: ["instance", "elevenlabs-webhook"],
    queryFn: () => instanceSettingsApi.getElevenLabsWebhook(),
  });

  // Holds the raw secret returned by the most recent generate call so
  // the operator can copy it once before it disappears. Subsequent reads
  // only return last4 — there is no way to surface the full value again.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [urlCopyState, setUrlCopyState] = useState<"idle" | "copied" | "shared" | "unavailable">("idle");
  const [secretCopyState, setSecretCopyState] = useState<"idle" | "copied" | "shared" | "unavailable">("idle");

  const generateMutation = useMutation({
    mutationFn: () => instanceSettingsApi.generateElevenLabsWebhookSecret(),
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      setSecretCopyState("idle");
      queryClient.invalidateQueries({ queryKey: ["instance", "elevenlabs-webhook"] });
    },
  });

  const url = webhookQuery.data?.url ?? "";
  const configured = webhookQuery.data?.configured ?? false;
  const last4 = webhookQuery.data?.last4 ?? null;
  const updatedAt = webhookQuery.data?.updatedAt ?? null;

  async function copyOrShare(
    value: string,
    setter: (state: "idle" | "copied" | "shared" | "unavailable") => void,
    shareTitle: string,
  ) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setter("copied");
        window.setTimeout(() => setter("idle"), 1600);
        return;
      }
    } catch {
      // Fall through to share sheet.
    }
    if (typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function") {
      try {
        await (navigator as Navigator).share({ title: shareTitle, text: value });
        setter("shared");
        window.setTimeout(() => setter("idle"), 1600);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setter("idle");
          return;
        }
      }
    }
    setter("unavailable");
    window.setTimeout(() => setter("idle"), 2400);
  }

  return (
    <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Webhook configuration
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste both values into your ElevenLabs webhook config at{" "}
            <a
              href="https://elevenlabs.io/app/settings/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              elevenlabs.io/app/settings/webhooks
            </a>
            .
          </p>
        </div>
        {configured ? (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
            Secret saved · …{last4}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
            Not configured
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">Webhook URL</Label>
          <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              readOnly
              value={url}
              className="font-mono text-xs"
              data-testid="elevenlabs-webhook-url"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyOrShare(url, setUrlCopyState, "Paperclip ElevenLabs webhook URL")}
              disabled={!url}
            >
              {urlCopyState === "copied" ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Copied
                </>
              ) : urlCopyState === "shared" ? (
                <>
                  <Share2 className="h-3.5 w-3.5" /> Shared
                </>
              ) : urlCopyState === "unavailable" ? (
                "Copy unavailable"
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">Webhook secret</Label>
          {revealedSecret ? (
            <div className="mt-1 space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  readOnly
                  value={revealedSecret}
                  className="font-mono text-xs"
                  data-testid="elevenlabs-webhook-secret"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyOrShare(revealedSecret, setSecretCopyState, "Paperclip ElevenLabs webhook secret")
                  }
                >
                  {secretCopyState === "copied" ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : secretCopyState === "shared" ? (
                    <>
                      <Share2 className="h-3.5 w-3.5" /> Shared
                    </>
                  ) : secretCopyState === "unavailable" ? (
                    "Copy unavailable"
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Shown once. Paste into ElevenLabs now — the value will be redacted to …{revealedSecret.slice(-4)} on the next page load.
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {configured ? (
                <>Secret on file · last 4 …{last4}. Generate a new one to rotate.</>
              ) : (
                <>No secret yet — generate one to register the receiver.</>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (configured && !window.confirm("Rotate the ElevenLabs webhook secret? The old value stops working immediately.")) return;
              generateMutation.mutate();
            }}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {configured ? "Rotate secret" : "Generate webhook secret"}
              </>
            )}
          </Button>
          {updatedAt ? (
            <span className="text-[10px] text-muted-foreground">
              Last rotated {new Date(updatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {generateMutation.isError ? (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <X className="h-3 w-3" />
            {generateMutation.error instanceof Error
              ? generateMutation.error.message
              : "Failed to generate secret"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

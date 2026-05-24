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
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, X } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "../lib/utils";

type ProviderKey = "deepseek" | "moonshot" | "openai" | "anthropic" | "gemini";

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
];

export function InstanceProviderKeys() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "Provider API Keys" }]);
  }, [setBreadcrumbs]);

  const queryClient = useQueryClient();
  const keysQuery = useQuery({
    queryKey: ["instance", "provider-keys"],
    queryFn: () => instanceSettingsApi.listProviderKeys(),
  });

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
  onSaved: () => void;
}

function ProviderRow({ meta, hasKey, last4, updatedAt, onSaved }: ProviderRowProps) {
  const [value, setValue] = useState("");
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

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

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div>
          <Label htmlFor={`${meta.key}-input`} className="sr-only">
            {meta.name} API key
          </Label>
          <Input
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
        <div className="mt-3">
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
    </section>
  );
}

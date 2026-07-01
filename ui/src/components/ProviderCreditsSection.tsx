/**
 * ProviderCreditsSection — aggregates current credit balance + recent
 * spending across every model provider Paperclip routes traffic through.
 *
 * Sits at the top of the Costs > Providers tab. Renders one card per
 * provider: brand stripe, current balance (big number) or "—" when the
 * provider doesn't expose balance via API, spend this week + month, a
 * 30-day daily-spend sparkline, "Top up" link to the provider's billing
 * page, "last updated" + stub indicator.
 *
 * The hard work lives server-side in services/provider-credits/; this
 * component is purely a visualization. v1 reads from stub adapters that
 * return shaped-but-fake data so Tyler sees the UI before he ships real
 * API keys.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";

interface DailySpendPoint {
  date: string;
  amount: number;
}

interface ProviderCreditCard {
  provider: string;
  name: string;
  currency: string;
  balance: number | null;
  balanceLastFetchedAt: string | null;
  spendThisMonth: number;
  spendThisWeek: number;
  dailySeries: DailySpendPoint[];
  dashboardUrl: string;
  brandColor: string;
  hasApiKey: boolean;
  isStub: boolean;
}

interface ProviderCreditsSectionProps {
  companyId: string;
}

export function ProviderCreditsSection({ companyId }: ProviderCreditsSectionProps) {
  const query = useQuery({
    queryKey: ["provider-credits", companyId],
    queryFn: () => api.get<ProviderCreditCard[]>(`/companies/${companyId}/provider-credits`),
  });

  const cards = query.data ?? [];

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Provider credits</h2>
          <p className="text-xs text-muted-foreground">
            Current balance + 30-day spend across every model provider Paperclip routes through.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {cards.some((c) => c.isStub) ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Showing stub data — real balances light up once Tyler ships per-provider API keys via
            Instance Settings → Provider keys (admin UI not built yet; for now keys go in
            <code className="mx-1 rounded bg-amber-200/60 px-1 py-0.5 dark:bg-amber-400/15">.paperclip/.env</code>
            and the adapter file picks them up).
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <ProviderCard key={card.provider} card={card} />
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ card }: { card: ProviderCreditCard }) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: card.currency,
    maximumFractionDigits: 2,
  });
  const lastFetched = card.balanceLastFetchedAt
    ? relativeFromNow(card.balanceLastFetchedAt)
    : null;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: card.brandColor }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{card.name}</h3>
            {card.isStub ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                Stub
              </span>
            ) : null}
          </div>
          {lastFetched ? (
            <p className="text-[10px] text-muted-foreground">Updated {lastFetched}</p>
          ) : null}
        </div>
        <a
          href={card.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Top up
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="mt-4">
        {card.balance != null ? (
          <>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Balance
            </div>
            <div className="text-2xl font-semibold tabular-nums">{formatter.format(card.balance)}</div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Balance
            </div>
            <div className="text-sm text-muted-foreground">Not exposed by this provider's API</div>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">This week</div>
          <div className="tabular-nums">{formatter.format(card.spendThisWeek)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</div>
          <div className="tabular-nums">{formatter.format(card.spendThisMonth)}</div>
        </div>
      </div>

      {card.dailySeries.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">30-day spend</div>
          <Sparkline data={card.dailySeries.map((d) => d.amount)} color={card.brandColor} />
        </div>
      ) : null}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return <div className="h-10 text-xs text-muted-foreground">No spend data.</div>;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0.01);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-12 w-full">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function relativeFromNow(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * HashtagLabTab — hashtag suggestion + own-hashtag-performance tracking.
 *
 * Two stacked panes:
 *   1. Suggest — paste seed copy + niche + platform → returns 3 tiers
 *      (popular / medium / niche) with use counts and predicted reach
 *      lift. Built for the same niche-aware logic Later / Flick ship.
 *   2. Performance — table of every hashtag Tyler has used (drawn from
 *      published posts once adapters report metrics). Sort by avg
 *      engagement to find the best-performing tags.
 *
 * Data-honest (spec §7): if the suggestion corpus isn't available yet the
 * endpoint returns a keyed-off state — rendered as an explicit amber
 * notice with the homework that unlocks it, never mock tag tiers.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Hash, Sparkles } from "lucide-react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";
import { socialApi, type HashtagSuggestion, type KeyedOff } from "../../api/social";
import { KeyedOffNotice } from "./data-honesty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToastActions } from "../../context/ToastContext";
import { PLATFORM_META, TYLER_PRIORITY_PLATFORMS } from "./platform-meta";
import { cn } from "../../lib/utils";

interface HashtagLabTabProps {
  companyId: string;
  accounts: SocialAccountPublic[];
}

const TIER_LABEL: Record<HashtagSuggestion["tier"], string> = {
  popular: "Popular (1M+)",
  medium: "Medium (10k–1M)",
  niche: "Niche (<10k)",
};

const TIER_TONE: Record<HashtagSuggestion["tier"], string> = {
  popular: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  niche: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
};

export function HashtagLabTab({ companyId, accounts: _accounts }: HashtagLabTabProps) {
  const { pushToast } = useToastActions();
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [text, setText] = useState("");
  const [niche, setNiche] = useState("");
  const [results, setResults] = useState<HashtagSuggestion[]>([]);
  const [keyedOff, setKeyedOff] = useState<KeyedOff | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const suggestMutation = useMutation({
    mutationFn: () => socialApi.suggestHashtags(companyId, platform, text, niche || undefined),
    onSuccess: (res) => {
      if (res.available) {
        setResults(res.data);
        setKeyedOff(null);
      } else {
        setResults([]);
        setKeyedOff(res);
      }
    },
  });

  const grouped = useMemo(() => {
    const out: Record<HashtagSuggestion["tier"], HashtagSuggestion[]> = {
      popular: [],
      medium: [],
      niche: [],
    };
    for (const s of results) out[s.tier].push(s);
    return out;
  }, [results]);

  const toggle = (tag: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const copySelected = async () => {
    const tags = Array.from(chosen).map((t) => `#${t}`).join(" ");
    if (!tags) return;
    try {
      await navigator.clipboard.writeText(tags);
      pushToast({ title: `Copied ${chosen.size} hashtag${chosen.size === 1 ? "" : "s"}`, tone: "success" });
    } catch (err) {
      pushToast({
        title: "Couldn't copy",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Suggest pane */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Suggest hashtags</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste your draft caption and a niche descriptor. We'll return three tiers — popular for
          discovery reach, medium for sustained engagement, niche for highly-engaged audiences.
        </p>

        <div className="mt-3 grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)_160px]">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Platform</Label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {TYLER_PRIORITY_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_META[p].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ht-text" className="text-xs uppercase tracking-wide text-muted-foreground">
              Draft caption / topic
            </Label>
            <Textarea
              id="ht-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Building an AI ops team with zero hires…"
              className="mt-1 min-h-[100px] resize-y"
            />
          </div>
          <div>
            <Label htmlFor="ht-niche" className="text-xs uppercase tracking-wide text-muted-foreground">
              Niche
            </Label>
            <Input
              id="ht-niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="b2b saas"
              className="mt-1"
            />
            <Button
              className="mt-2 w-full"
              disabled={text.trim().length === 0 || suggestMutation.isPending}
              onClick={() => suggestMutation.mutate()}
            >
              {suggestMutation.isPending ? "Thinking…" : "Suggest"}
            </Button>
          </div>
        </div>

        {keyedOff ? (
          <div className="mt-4">
            <KeyedOffNotice
              icon={Hash}
              featurePitch={`Hashtag suggestions will return three tiers of real ${PLATFORM_META[platform].label} tags with use counts and predicted reach lift.`}
              state={keyedOff}
              compact
            />
          </div>
        ) : null}

        {results.length > 0 ? (
          <>
            <div className="mt-4 flex flex-col gap-3">
              {(Object.keys(grouped) as HashtagSuggestion["tier"][]).map((tier) => (
                <div key={tier}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {TIER_LABEL[tier]}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {grouped[tier].map((s) => {
                      const active = chosen.has(s.tag);
                      return (
                        <button
                          key={s.tag}
                          type="button"
                          onClick={() => toggle(s.tag)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                            active
                              ? "border-foreground bg-foreground text-background"
                              : TIER_TONE[tier],
                          )}
                          title={`${s.totalUses.toLocaleString()} uses · +${s.predictedReachLift ?? 0}% predicted reach`}
                        >
                          #{s.tag}
                          <span className="text-[10px] opacity-70">
                            +{s.predictedReachLift ?? 0}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="text-xs text-muted-foreground">
                {chosen.size} hashtag{chosen.size === 1 ? "" : "s"} selected
              </div>
              <Button size="sm" variant="outline" disabled={chosen.size === 0} onClick={copySelected}>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {/* Performance pane */}
      <div className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Your hashtag performance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Once you've published 5+ posts, this table will rank every hashtag you've used by the
          engagement it drove. Real wiring lands when the platform adapters report metrics — for
          now this stays empty.
        </p>
        <div className="mt-3 rounded-md border border-dashed border-border bg-background/40 p-6 text-center text-xs text-muted-foreground">
          No published-post data yet.
        </div>
      </div>
    </div>
  );
}

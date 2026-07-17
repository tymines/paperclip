/**
 * Data-honesty primitives for the Social studio (spec §7).
 *
 * - KeyedOffNotice: rendered when an endpoint returns `available: false`.
 *   Shows what the feature will do, the exact reason it's off, and a link
 *   to the homework item that unlocks it. Never renders mock charts.
 * - BlockedTargetBadge / statusBadgeClass: amber "Blocked — no credential"
 *   treatment for social_post_targets that hit `blocked_no_credential`.
 *   Blocked is terminal — the scheduler will not retry it.
 */
import { ExternalLink, KeyRound, type LucideIcon } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { cn } from "../../lib/utils";
import type { KeyedOff } from "../../api/social";

/** Warning tint per Paperclip Design System v1.0. */
const WARN = "#F4B940";

interface KeyedOffNoticeProps {
  icon?: LucideIcon;
  /** What this surface will do once keyed (e.g. "Analytics will chart …"). */
  featurePitch: string;
  state: KeyedOff;
  /** Compact renders a small inline card (for embedding inside panels). */
  compact?: boolean;
}

export function KeyedOffNotice({ icon = KeyRound, featurePitch, state, compact }: KeyedOffNoticeProps) {
  if (compact) {
    return (
      <div
        className="rounded-md border px-3 py-2.5 text-xs"
        style={{ borderColor: `${WARN}4D`, backgroundColor: `${WARN}14` }}
      >
        <p className="font-semibold" style={{ color: WARN }}>
          Not available yet
        </p>
        <p className="mt-1 leading-5 text-muted-foreground">{featurePitch}</p>
        <p className="mt-1 leading-5 text-foreground/90">{state.reason}</p>
        <HomeworkLink homework={state.homework} />
      </div>
    );
  }
  return (
    <div
      className="rounded-2xl border"
      style={{ borderColor: `${WARN}4D`, backgroundColor: `${WARN}0F` }}
    >
      <EmptyState icon={icon} message={featurePitch} />
      <div className="-mt-8 px-8 pb-8 text-center">
        <p className="text-sm font-medium" style={{ color: WARN }}>
          {state.reason}
        </p>
        <HomeworkLink homework={state.homework} center />
      </div>
    </div>
  );
}

function HomeworkLink({
  homework,
  center,
}: {
  homework: KeyedOff["homework"];
  center?: boolean;
}) {
  if (!homework) return null;
  return (
    <a
      href={homework.href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:opacity-80",
        center && "justify-center",
      )}
      style={{ borderColor: `${WARN}66`, color: WARN }}
    >
      {homework.title}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/**
 * Amber chip for a target/post in the terminal `blocked` state
 * (errorMessage prefixed "blocked_no_credential: "). Title carries the
 * server's detail so hover explains exactly what's missing.
 */
export function BlockedBadge({
  detail,
  className,
}: {
  detail?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
        className,
      )}
      style={{ borderColor: `${WARN}66`, backgroundColor: `${WARN}1A`, color: WARN }}
      title={
        detail ??
        "blocked_no_credential: no credentialed publish path for this platform — connect it via the wizard on the Accounts surface."
      }
    >
      Blocked — no credential
    </span>
  );
}

/** True when a post/target status is the terminal blocked state. */
export function isBlockedStatus(status: string): boolean {
  return status === "blocked";
}

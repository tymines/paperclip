import type { ElementType } from "react";
import {
  BadgeDollarSign,
  BookImage,
  Boxes,
  CircleUserRound,
  GalleryHorizontalEnd,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const CREATOR_OS_DESTINATIONS = [
  "overview",
  "personas",
  "create",
  "flows",
  "campaigns",
  "library",
  "review",
  "social",
  "training",
  "jobs",
] as const;

export type CreatorOsDestination = (typeof CREATOR_OS_DESTINATIONS)[number];

type NavigationItem = {
  key: CreatorOsDestination;
  label: string;
  icon: ElementType;
  available: boolean;
};

const navigationItems: NavigationItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, available: true },
  { key: "personas", label: "Personas", icon: CircleUserRound, available: true },
  { key: "create", label: "Create", icon: Sparkles, available: true },
  { key: "flows", label: "Flows", icon: Boxes, available: false },
  { key: "campaigns", label: "Campaigns", icon: Megaphone, available: false },
  { key: "library", label: "Library", icon: BookImage, available: true },
  { key: "review", label: "Review", icon: GalleryHorizontalEnd, available: false },
  { key: "social", label: "Social", icon: Send, available: false },
  { key: "training", label: "Training", icon: GraduationCap, available: true },
  { key: "jobs", label: "Jobs & Costs", icon: BadgeDollarSign, available: true },
];

export function CreatorOsNavigation({
  active,
  onNavigate,
}: {
  active: CreatorOsDestination;
  onNavigate: (destination: CreatorOsDestination) => void;
}) {
  return (
    <nav aria-label="Creator OS" className="min-w-0">
      <div
        className="flex gap-1 overflow-x-auto rounded-2xl border border-violet-400/15 bg-[#090b14]/95 p-1.5 lg:flex-col lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0"
        data-testid="creator-os-navigation"
      >
        {navigationItems.map(({ key, label, icon: Icon, available }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={selected ? "page" : undefined}
              aria-label={`${label}${available ? "" : " — foundation only"}`}
              data-testid={`creator-nav-${key}`}
              className={cn(
                "group flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-left text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 lg:w-full",
                selected
                  ? "bg-gradient-to-r from-violet-600/35 to-fuchsia-500/10 text-white ring-1 ring-violet-400/30"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
              )}
            >
              <Icon className={cn("h-4 w-4", selected ? "text-violet-300" : "text-slate-500 group-hover:text-slate-300")} />
              <span className="whitespace-nowrap">{label}</span>
              {!available && (
                <span className="ml-auto hidden rounded-full border border-slate-700 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-slate-500 xl:inline-flex">
                  Later
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

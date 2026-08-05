import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSidebar } from "../context/SidebarContext";

export interface PageTabItem {
  value: string;
  label: ReactNode;
}

interface PageTabBarProps {
  items: PageTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  align?: "center" | "start";
}

export function PageTabBar({ items, value, onValueChange, align = "center" }: PageTabBarProps) {
  const { isMobile } = useSidebar();

  if (isMobile && value !== undefined && onValueChange) {
    return (
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-label="Page section"
        className="h-11 w-full max-w-full rounded-md border border-border bg-background px-3 py-1 text-base focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {typeof item.label === "string" ? item.label : item.value}
          </option>
        ))}
      </select>
    );
  }

  if (isMobile) {
    return (
      <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain" data-pp-page-tabs-scroll>
        <TabsList variant="line" className="min-w-max justify-start">
          {items.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="min-h-11 shrink-0">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    );
  }

  return (
    <TabsList variant="line" className={align === "start" ? "justify-start" : undefined}>
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value}>
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

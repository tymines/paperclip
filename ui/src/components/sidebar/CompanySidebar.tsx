/**
 * Company Sidebar Navigation
 *
 * Left sidebar with navigation links for company-scoped features.
 * Add new nav items here following the existing pattern.
 *
 * Usage:
 *   <CompanySidebar companySlug="my-company" activeRoute="book-writing" />
 */

import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

// ── Navigation items ───────────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
  icon: string;
  description?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    path: "dashboard",
    icon: "📊",
    description: "Overview and metrics",
  },
  {
    label: "Gym",
    path: "gym",
    icon: "🏋️",
    description: "Agent training and evolution",
  },
  {
    label: "World View",
    path: "world-view",
    icon: "🌍",
    description: "Global situational awareness and intelligence",
  },
  {
    label: "Skills",
    path: "skills",
    icon: "🧠",
    description: "Per-agent skill usage breakdown",
  },
  {
    label: "Book Studio",
    path: "book-writing",
    icon: "✍️",
    description: "AI-powered book studio",
  },
  {
    label: "Settings",
    path: "settings",
    icon: "⚙️",
    description: "Company and pipeline settings",
  },
];

// ── Component ──────────────────────────────────────────────────────────────

interface CompanySidebarProps {
  companySlug?: string;
}

export function CompanySidebar({ companySlug }: CompanySidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Extract the active route from the URL path
  const activeRoute = location.pathname.split("/").filter(Boolean)[1] ?? "";

  const handleNavigate = (path: string) => {
    navigate(`/${companySlug ?? "default"}/${path}`);
  };

  return (
    <nav className="flex h-full w-56 flex-col border-r border-gray-800 bg-gray-950">
      {/* Company header */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          {companySlug?.charAt(0).toUpperCase() ?? "P"}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-100 truncate max-w-[140px]">
            {companySlug ?? "Paperclip"}
          </span>
          <span className="text-xs text-gray-500">Company</span>
        </div>
      </div>

      {/* Navigation links */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Features
        </div>
        <div className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeRoute === item.path;
            return (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full text-left",
                  isActive
                    ? "bg-blue-600/20 text-blue-300 border border-blue-600/30"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 border border-transparent",
                )}
              >
                <span className="text-base flex-shrink-0">{item.icon}</span>
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{item.label}</span>
                  {item.description && (
                    <span className="text-[10px] text-gray-500 truncate">
                      {item.description}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
          Paperclip v0.1
        </div>
      </div>
    </nav>
  );
}

export default CompanySidebar;

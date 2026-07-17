/** World View  small shared UI atoms (TYL-131). Extracted from v1 WorldView. */
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { C } from "./theme";

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
          style={{ background: color }}
        />
      )}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function Tag({ children, color = C.faint }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="px-1 text-[9px] uppercase tracking-wider"
      style={{ color, border: `1px solid ${color}44`, lineHeight: "14px" }}
    >
      {children}
    </span>
  );
}

const panelStyle: CSSProperties = { background: C.panel, border: `1px solid ${C.line}` };

export function Panel({
  icon: Icon,
  title,
  sub,
  right,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section style={panelStyle} className={`flex min-h-0 flex-col ${className || ""}`}>
      <header
        className="flex items-center gap-2 px-2.5 py-1.5"
        style={{ borderBottom: `1px solid ${C.line}`, background: C.panel2 }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: C.green }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.text }}>
          {title}
        </h3>
        {sub && (
          <span className="truncate text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>
            {sub}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="px-3 py-4 text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>
       {label}
    </p>
  );
}

export function Offline({ what, hint }: { what: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
      <p className="text-[11px] uppercase tracking-wider" style={{ color: C.amber }}>
        {what}
      </p>
      {hint && (
        <p className="text-[10px]" style={{ color: C.faint }}>
          {hint}
        </p>
      )}
    </div>
  );
}

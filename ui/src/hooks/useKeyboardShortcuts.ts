import { useEffect, useRef } from "react";
import {
  focusPageSearchShortcutTarget,
  hasBlockingShortcutDialog,
  isKeyboardShortcutTextInputTarget,
} from "../lib/keyboardShortcuts";

interface ShortcutHandlers {
  enabled?: boolean;
  onNewIssue?: () => void;
  onSearch?: () => void;
  onToggleSidebar?: () => void;
  onTogglePanel?: () => void;
  onShowShortcuts?: () => void;
  onGoto?: (key: GotoTarget) => void;
}

export type GotoTarget = "home" | "inbox" | "agents" | "routines" | "settings";

const GOTO_KEY_MAP: Record<string, GotoTarget> = {
  h: "home",
  i: "inbox",
  a: "agents",
  r: "routines",
  s: "settings",
};

const GOTO_CHORD_WINDOW_MS = 1200;

export function useKeyboardShortcuts({
  enabled = true,
  onNewIssue,
  onSearch,
  onToggleSidebar,
  onTogglePanel,
  onShowShortcuts,
  onGoto,
}: ShortcutHandlers) {
  // Track an in-flight "g" press for Linear-style chord navigation.
  const gotoArmedUntilRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) {
        return;
      }

      // Don't fire shortcuts when typing in inputs
      if (isKeyboardShortcutTextInputTarget(e.target)) {
        return;
      }

      // g-chord: if armed and the second key matches a goto target, navigate.
      // We check this BEFORE other single-key handlers so `g i` doesn't get
      // eaten by `i` handlers (none today, but future-proofs the chord).
      // If armed but the second key doesn't match a goto target, disarm
      // silently and let the key flow through to other handlers (e.g. the
      // issue-detail `g c` chord still works because that handler tracks its
      // own armed state separately).
      const now = Date.now();
      if (gotoArmedUntilRef.current > now && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = GOTO_KEY_MAP[e.key.toLowerCase()];
        gotoArmedUntilRef.current = 0;
        if (target) {
          e.preventDefault();
          onGoto?.(target);
          return;
        }
        // Not a global goto target — fall through, but don't let `c` /
        // `[` / `]` fire as standalone shortcuts after a `g`. Returning
        // here cleanly disarms without firing any other single-key
        // handlers in this hook.
        return;
      }

      // / → Page search when available, otherwise quick search
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (hasBlockingShortcutDialog()) {
          return;
        }

        e.preventDefault();
        if (!focusPageSearchShortcutTarget()) {
          onSearch?.();
        }
        return;
      }

      // ? → Show keyboard shortcuts cheatsheet
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onShowShortcuts?.();
        return;
      }

      // g → arm goto chord
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (hasBlockingShortcutDialog()) {
          return;
        }
        e.preventDefault();
        gotoArmedUntilRef.current = now + GOTO_CHORD_WINDOW_MS;
        return;
      }

      // C → New Issue
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onNewIssue?.();
      }

      // [ → Toggle Sidebar
      if (e.key === "[" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onToggleSidebar?.();
      }

      // ] → Toggle Panel
      if (e.key === "]" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onTogglePanel?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onNewIssue, onSearch, onToggleSidebar, onTogglePanel, onShowShortcuts, onGoto]);
}

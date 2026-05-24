/**
 * Knowledge Graph v2 — mobile gesture hooks.
 *
 * Spec: knowledge-graph-polish-spec.md §8.
 *
 * Five gestures, wired on top of OrbitControls (don't replace):
 *   1. Pinch-zoom    — iOS gesturechange / Android touchmove with 2 fingers
 *   2. Single tap    — touchend within 12px / 250ms → select node
 *   3. Double tap    — two touchend events within 300ms / 24px → fly-to node
 *   4. Swipe-pan     — delegated to OrbitControls.pan
 *   5. Pull-down     — top-60px touch with |dx|<40 & dy>80 → clear + fit-all
 *
 * Passive listeners by default; non-passive only where preventDefault is
 * called (gesturechange to suppress Safari's page-zoom).
 */
import { useEffect, useRef } from "react";

interface UseKnowledgeGraphGesturesOpts {
  /** Target the gestures bind to — typically the ForceGraph container div. */
  canvasRef: React.RefObject<HTMLElement | null>;
  /** Called when a single tap resolves at a coordinate. */
  onSingleTap?(x: number, y: number): void;
  /** Called when a double-tap resolves at a coordinate. */
  onDoubleTap?(x: number, y: number): void;
  /** Pinch zoom delta — > 1 zooms in, < 1 zooms out. */
  onPinchZoom?(scaleDelta: number): void;
  /** Pull-down from the top → reset view. */
  onPullDownReset?(): void;
  /** Disable when the user is interacting with another surface. */
  enabled?: boolean;
}

const TAP_RADIUS = 12;
const TAP_DURATION_MS = 250;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_RADIUS = 24;
const PULL_DOWN_TOP = 60;
const PULL_DOWN_MIN_DY = 80;
const PULL_DOWN_MAX_DX = 40;

export function useKnowledgeGraphGestures({
  canvasRef,
  onSingleTap,
  onDoubleTap,
  onPinchZoom,
  onPullDownReset,
  enabled = true,
}: UseKnowledgeGraphGesturesOpts) {
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapStartRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = canvasRef.current;
    if (!el) return;

    // ── Pinch-zoom — iOS Safari gesturechange ───────────────────────────
    // Safari fires gesturestart/change/end at the document level when two
    // fingers pinch; preventDefault stops the browser's own page-zoom.
    const onGestureChange = (e: Event) => {
      const ge = e as Event & { scale?: number };
      if (typeof ge.scale !== "number") return;
      e.preventDefault();
      onPinchZoom?.(ge.scale);
    };
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });

    // ── Android two-finger pinch (touchmove with 2 pointers) ────────────
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        pinchStartDistRef.current = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      } else if (e.touches.length === 1) {
        const t = e.touches[0]!;
        tapStartRef.current = { t: Date.now(), x: t.clientX, y: t.clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDistRef.current == null) return;
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const scale = dist / pinchStartDistRef.current;
      onPinchZoom?.(scale);
    };

    const onTouchEnd = (e: TouchEvent) => {
      pinchStartDistRef.current = null;
      const start = tapStartRef.current;
      tapStartRef.current = null;
      if (!start) return;
      // touchend fires with no remaining touches and at least one
      // changedTouches entry.
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Date.now() - start.t;

      // Pull-down-from-top → reset
      if (
        start.y < PULL_DOWN_TOP &&
        dy > PULL_DOWN_MIN_DY &&
        Math.abs(dx) < PULL_DOWN_MAX_DX
      ) {
        onPullDownReset?.();
        return;
      }

      // Tap candidate?
      if (Math.hypot(dx, dy) > TAP_RADIUS || dt > TAP_DURATION_MS) return;

      const now = Date.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.t <= DOUBLE_TAP_MS &&
        Math.hypot(t.clientX - last.x, t.clientY - last.y) < DOUBLE_TAP_RADIUS
      ) {
        // Double-tap: fly camera onto the tapped point.
        onDoubleTap?.(t.clientX, t.clientY);
        lastTapRef.current = null;
        return;
      }

      lastTapRef.current = { t: now, x: t.clientX, y: t.clientY };
      onSingleTap?.(t.clientX, t.clientY);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [canvasRef, enabled, onSingleTap, onDoubleTap, onPinchZoom, onPullDownReset]);
}

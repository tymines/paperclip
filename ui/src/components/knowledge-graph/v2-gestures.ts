/**
 * Knowledge Graph v2 — mobile gesture hooks.
 *
 * Spec: knowledge-graph-polish-spec.md §8.
 *
 * Three single-finger gestures, layered on top of the renderer's native
 * controls (TrackballControls / OrbitControls — both handle two-finger
 * pinch + pan internally and we must NOT fight them):
 *   1. Single tap    — touchend within 12px / 250ms → select node
 *   2. Double tap    — two touchend events within 300ms / 24px → fly-to node
 *   3. Pull-down     — top-60px touch with |dx|<40 & dy>80 → clear + fit-all
 *
 * Two-finger pinch-zoom and two-finger pan are delegated to the renderer's
 * built-in controls. Earlier revisions intercepted iOS `gesturechange` with
 * preventDefault and ran a custom `cameraPosition` tween per pinch frame;
 * that tug-of-war against TrackballControls killed pinch in practice (Tyler
 * had to use the +/- buttons). We now never preventDefault, never touch
 * multitouch events, and let the renderer's controls own the pinch.
 *
 * All listeners are passive — we never block the browser from delivering
 * the same events to the canvas, which is what feeds the renderer's
 * controls.
 */
import { useEffect, useRef } from "react";

interface UseKnowledgeGraphGesturesOpts {
  /** Target the gestures bind to — typically the ForceGraph container div. */
  canvasRef: React.RefObject<HTMLElement | null>;
  /** Called when a single tap resolves at a coordinate. */
  onSingleTap?(x: number, y: number): void;
  /** Called when a double-tap resolves at a coordinate. */
  onDoubleTap?(x: number, y: number): void;
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
  onPullDownReset,
  enabled = true,
}: UseKnowledgeGraphGesturesOpts) {
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapStartRef = useRef<{ t: number; x: number; y: number } | null>(null);
  // Once a 2nd finger lands during a touch sequence, abandon any tap candidate
  // so that lifting one finger after a pinch doesn't fire a stale single-tap.
  const multitouchActiveRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const el = canvasRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        multitouchActiveRef.current = true;
        tapStartRef.current = null;
        return;
      }
      const t = e.touches[0]!;
      tapStartRef.current = { t: Date.now(), x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      // If any finger is still on the surface, the gesture isn't finished;
      // and if we ever saw 2+ fingers in this sequence we're in pinch land
      // and must not synthesize a tap.
      if (e.touches.length > 0) return;
      const wasMultitouch = multitouchActiveRef.current;
      multitouchActiveRef.current = false;
      const start = tapStartRef.current;
      tapStartRef.current = null;
      if (wasMultitouch || !start) return;

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

    // Passive everywhere — we never preventDefault, so two-finger pinch and
    // pan reach the renderer's canvas + its TrackballControls/OrbitControls.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [canvasRef, enabled, onSingleTap, onDoubleTap, onPullDownReset]);
}

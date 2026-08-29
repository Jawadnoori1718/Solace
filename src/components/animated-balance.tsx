"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { formatPence } from "@/lib/format";

/**
 * Figures that count to their new value rather than jumping to it.
 *
 * Motion is what people remember. A balance dropping from £295.19 to £291.07
 * between two renders is a fact nobody notices; the same change animated over
 * three quarters of a second is the moment a councillor watches their money
 * being spent.
 *
 * The animation runs on `requestAnimationFrame` against a wall clock rather
 * than a fixed number of steps, so it takes the same time on a slow laptop as a
 * fast one and cannot drift.
 */

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Read through `useSyncExternalStore` rather than an effect, so the answer is
 * available during the first render and the components below never have to set
 * state just to correct themselves afterwards.
 */
function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    // On the server, assume motion is wanted. The first client render corrects
    // it before anything has had a chance to animate.
    () => false,
  );
}

/**
 * Ease a number towards a target.
 *
 * Returns the target unchanged when animation is disabled, so the caller never
 * needs a branch and no state is written to undo an animation that should not
 * have started.
 */
function useCountUp(
  target: number,
  durationMs: number,
  enabled: boolean,
): number {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    const delta = target - from;

    if (delta === 0) return;

    const started = performance.now();

    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / durationMs);

      // Ease out cubic: decisive at first, settling gently. Money leaving a pot
      // should feel like it has gone.
      const eased = 1 - (1 - progress) ** 3;

      setDisplayed(from + delta * eased);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs, enabled]);

  return enabled ? displayed : target;
}

/** A money figure that counts to its new value. */
export function AnimatedPence({
  value,
  className,
  durationMs = 750,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const animate = !usePrefersReducedMotion();
  const displayed = useCountUp(value, durationMs, animate);

  return (
    <span className={className} aria-live="polite" aria-atomic="true">
      {formatPence(Math.round(displayed))}
    </span>
  );
}

/** A plain number that counts to its new value. */
export function AnimatedNumber({
  value,
  suffix,
  decimals = 0,
  className,
  durationMs = 750,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  className?: string;
  durationMs?: number;
}) {
  const animate = !usePrefersReducedMotion();
  const displayed = useCountUp(value, durationMs, animate);

  return (
    <span className={className}>
      {displayed.toLocaleString("en-GB", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix ?? null}
    </span>
  );
}

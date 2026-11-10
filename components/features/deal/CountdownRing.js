"use client";

import { useEffect, useRef, useState } from "react";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function calculateRemainingSeconds(totalSeconds, startedAt) {
  if (!startedAt) return totalSeconds;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return totalSeconds;
  const elapsed = Math.floor((Date.now() - started) / 1000);
  const remaining = totalSeconds - elapsed;
  return Math.max(0, Math.min(totalSeconds, remaining));
}

/**
 * 60-second return window countdown timer.
 * Clearly labeled as simulating a real return period.
 * Calculates remaining seconds from `startedAt` so refreshing the browser mid-countdown
 * does not reset the timer back to 60s.
 */
export function CountdownRing({ totalSeconds = 60, startedAt, onComplete }) {
  const [left, setLeft] = useState(() =>
    calculateRemainingSeconds(totalSeconds, startedAt)
  );
  const callback = useRef(onComplete);

  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);

  // Display-only timer. Re-derives from the wall clock each tick (no drift, refresh-safe).
  // The parent remounts this component (key=startedAt) if the start time changes.
  // onComplete only asks the SERVER to re-check; it never authorizes a release.
  useEffect(() => {
    if (left <= 0) {
      const done = setTimeout(() => callback.current?.(), 600);
      return () => clearTimeout(done);
    }
    const tick = setTimeout(
      () => setLeft(calculateRemainingSeconds(totalSeconds, startedAt)),
      1000,
    );
    return () => clearTimeout(tick);
  }, [left, totalSeconds, startedAt]);

  const offset = CIRCUMFERENCE * (1 - left / totalSeconds);

  return (
    <div
      className="relative mx-auto h-36 w-36"
      role="timer"
      aria-label={`${left} seconds left in the ${totalSeconds}-second simulated return window`}
    >
      <svg viewBox="0 0 120 120" className="-rotate-90" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          className="stroke-muted"
        />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke="#7c3aed"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-tabular text-3xl font-semibold">
          {left}
        </span>
        <span className="text-xs text-muted-foreground">seconds</span>
      </div>
    </div>
  );
}

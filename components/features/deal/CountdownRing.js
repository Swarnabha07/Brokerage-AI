"use client";

import { useEffect, useRef, useState } from "react";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Simulated return window. Calls `onComplete` once when it reaches zero. */
export function CountdownRing({ totalSeconds, onComplete }) {
  const [left, setLeft] = useState(totalSeconds);
  const callback = useRef(onComplete);

  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (left <= 0) {
      const done = setTimeout(() => callback.current?.(), 600);
      return () => clearTimeout(done);
    }
    const tick = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(tick);
  }, [left]);

  const offset = CIRCUMFERENCE * (1 - left / totalSeconds);

  return (
    <div
      className="relative mx-auto h-36 w-36"
      role="timer"
      aria-label={`${left} seconds left in the simulated return window`}
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

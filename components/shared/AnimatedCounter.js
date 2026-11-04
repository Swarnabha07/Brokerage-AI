"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";
import { formatCurrency } from "@/lib/format";

/** Counts up to `value` once visible. Screen readers get the final value immediately. */
export function AnimatedCounter({ value, currency = true, className }) {
  const ref = useRef(null);
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { damping: 24, stiffness: 90 });
  const isInView = useInView(ref, { once: true, margin: "-20px" });
  const format = (n) =>
    currency ? formatCurrency(n) : Math.round(n).toLocaleString("en-US");

  useEffect(() => {
    if (isInView) motionValue.set(value);
  }, [isInView, value, motionValue]);

  useEffect(() => {
    return springValue.on("change", (latest) => {
      if (ref.current) ref.current.textContent = format(latest);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [springValue, currency]);

  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden="true">
        {format(0)}
      </span>
    </span>
  );
}

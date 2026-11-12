"use client";

import { MotionConfig } from "framer-motion";

/** Respect the visitor's reduced-motion preference. */
export function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}

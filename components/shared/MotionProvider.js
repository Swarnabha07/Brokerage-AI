"use client";

import { MotionConfig } from "framer-motion";

/**
 * Preserve Framer Motion throughout the application
 * while respecting the visitor's reduced-motion preference.
 */
export function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}

"use client";

import { MotionConfig } from "framer-motion";

/** Makes every Framer Motion animation respect the visitor's reduced-motion setting. */
export function MotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}


"use client";

import { useEffect, useState } from "react";

export function MotionProvider({ children }) {
  const [MotionConfigComponent, setMotionConfigComponent] =
    useState(null);

  useEffect(() => {
    let active = true;

    import("framer-motion")
      .then((motion) => {
        if (active) {
          setMotionConfigComponent(() => motion.MotionConfig);
        }
      })
      .catch((error) => {
        console.error("Failed to load Framer Motion configuration:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  // Render children normally during server rendering and initial hydration.
  if (!MotionConfigComponent) {
    return <>{children}</>;
  }

  const Config = MotionConfigComponent;

  return (
    <Config reducedMotion="user">
      {children}
    </Config>
  );
}

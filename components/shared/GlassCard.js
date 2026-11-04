"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function GlassCard({ children, className, delay = 0, hover = true }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={hover ? { y: -4, transition: { duration: 0.2 } } : undefined}
      className={cn(
        "glass rounded-2xl shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset]",
        hover && "hover:shadow-[0_20px_60px_-24px_rgba(124,58,237,0.35)]",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

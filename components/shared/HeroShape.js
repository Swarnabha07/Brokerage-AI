"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export function HeroShape() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), {
    stiffness: 80,
    damping: 20,
  });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), {
    stiffness: 80,
    damping: 20,
  });

  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  return (
    <div
      aria-hidden="true"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      className="relative flex h-[420px] w-full items-center justify-center [perspective:1200px]"
    >
      <motion.div
        style={{ rotateX: rx, rotateY: ry }}
        className="relative h-72 w-72 [transform-style:preserve-3d]"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-[2.5rem] bg-brand-gradient opacity-90 shadow-[0_40px_120px_-20px_rgba(124,58,237,0.55)]"
          style={{
            transform: "translateZ(40px) rotateX(55deg) rotateZ(45deg)",
          }}
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-6 rounded-[2rem] border border-white/20 bg-white/5 backdrop-blur-sm"
          style={{
            transform: "translateZ(80px) rotateX(55deg) rotateZ(45deg)",
          }}
        />
        <motion.div
          className="absolute inset-16 rounded-3xl bg-background/80 shadow-[0_0_60px_rgba(0,112,186,0.4)_inset]"
          style={{
            transform: "translateZ(120px) rotateX(55deg) rotateZ(45deg)",
          }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh blur-3xl" />
    </div>
  );
}

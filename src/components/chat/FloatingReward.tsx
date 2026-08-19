// Small floating reward badge ("+10 XP", "Streak +1 🔥") that animates up and
// fades out over a widget when a kid gets something right. Rendered near the
// top edge of a study widget via absolute positioning. Auto-removes itself.

import { motion } from "framer-motion";

interface FloatingRewardProps {
  label: string;
  /** Tailwind text color class, e.g. "text-amber-300". */
  color?: string;
  onDone?: () => void;
}

export default function FloatingReward({ label, color = "text-amber-300", onDone }: FloatingRewardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.6 }}
      animate={{ opacity: 1, y: -22, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      onAnimationComplete={() => {
        if (onDone) setTimeout(onDone, 700);
      }}
      className={`pointer-events-none absolute -top-2 right-2 z-10 text-[13px] font-extrabold drop-shadow ${color}`}
      style={{ textShadow: "0 0 10px currentColor" }}
    >
      {label}
    </motion.div>
  );
}

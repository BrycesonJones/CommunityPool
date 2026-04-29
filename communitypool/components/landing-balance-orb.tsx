"use client";

import { useEffect } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";

type Props = {
  totalUsd: number;
};

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

const RING_GRADIENT_ID = "orb-ring-grad";
const RING_GLOW_SHADOW = "0 0 44px 6px rgba(51, 136, 214, 0.32)";

function StaticOrb({ totalUsd }: Props) {
  return (
    <div className="relative h-80 w-80 sm:h-96 sm:w-96" aria-hidden>
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: RING_GLOW_SHADOW }}
      />
      <div className="absolute inset-[2px] rounded-full bg-zinc-950" />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={RING_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3388d6" />
            <stop offset="50%" stopColor="#0066cc" />
            <stop offset="100%" stopColor="#003366" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="49.4"
          fill="none"
          stroke={`url(#${RING_GRADIENT_ID})`}
          strokeWidth="0.9"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Total Saved Balance
        </p>
        <p className="mt-3 text-3xl font-bold tabular-nums text-white sm:text-4xl">
          {formatUsd(totalUsd)}
        </p>
        <div className="my-4 h-px w-32 bg-zinc-800" />
        <p className="text-sm text-zinc-400">0.1 BTC</p>
        <p className="text-sm text-zinc-400">0.05 PAXG</p>
        <p className="text-sm text-zinc-400">0.03 ETH</p>
      </div>
    </div>
  );
}

export function LandingBalanceOrb({ totalUsd }: Props) {
  const prefersReducedMotion = useReducedMotion();
  const count = useMotionValue(0);
  const formattedCount = useTransform(count, (v) => formatUsd(v));

  useEffect(() => {
    if (prefersReducedMotion) {
      count.set(totalUsd);
      return;
    }
    const controls = animate(count, totalUsd, {
      duration: 1.7,
      delay: 0.45,
      ease: [0.22, 0.61, 0.36, 1],
    });
    return () => controls.stop();
  }, [count, prefersReducedMotion, totalUsd]);

  if (prefersReducedMotion) {
    return <StaticOrb totalUsd={totalUsd} />;
  }

  return (
    <motion.div
      className="relative h-80 w-80 sm:h-96 sm:w-96"
      aria-hidden
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 6, ease: "easeInOut", repeat: Infinity }}
    >
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: RING_GLOW_SHADOW }}
        animate={{ opacity: [0.75, 1, 0.75], scale: [1, 1.02, 1] }}
        transition={{ duration: 5, ease: "easeInOut", repeat: Infinity }}
      />
      <div className="absolute inset-[2px] rounded-full bg-zinc-950" />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={RING_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3388d6" />
            <stop offset="50%" stopColor="#0066cc" />
            <stop offset="100%" stopColor="#003366" />
          </linearGradient>
        </defs>
        <motion.circle
          cx="50"
          cy="50"
          r="49.4"
          fill="none"
          stroke={`url(#${RING_GRADIENT_ID})`}
          strokeWidth="0.9"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </svg>

      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ duration: 14, ease: "linear", repeat: Infinity }}
      >
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-300/60 blur-[1px]" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: -360 }}
        transition={{ duration: 18, ease: "linear", repeat: Infinity, delay: -3 }}
      >
        <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200/55 blur-[1px]" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ duration: 22, ease: "linear", repeat: Infinity, delay: -8 }}
      >
        <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-400/55 blur-[1px]" />
      </motion.div>

      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.p
          variants={itemVariants}
          className="text-xs font-medium uppercase tracking-wider text-zinc-500"
        >
          Total Saved Balance
        </motion.p>
        <motion.p
          variants={itemVariants}
          className="mt-3 text-3xl font-bold tabular-nums text-white sm:text-4xl"
        >
          {formattedCount}
        </motion.p>
        <motion.div
          variants={itemVariants}
          className="my-4 h-px w-32 bg-zinc-800"
        />
        <motion.p variants={itemVariants} className="text-sm text-zinc-400">
          0.1 BTC
        </motion.p>
        <motion.p variants={itemVariants} className="text-sm text-zinc-400">
          0.05 PAXG
        </motion.p>
        <motion.p variants={itemVariants} className="text-sm text-zinc-400">
          0.03 ETH
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

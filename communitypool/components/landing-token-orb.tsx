"use client";

import {
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";

type Props = {
  logoSrc: string;
  logoAlt: string;
  name: string;
  ticker: string;
  cardDelay?: number;
};

const containerVariants: Variants = {
  hidden: {},
  visible: (delay: number = 0) => ({
    transition: { staggerChildren: 0.12, delayChildren: 0.2 + delay },
  }),
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

const RING_GLOW_SHADOW = "0 0 36px 4px rgba(51, 136, 214, 0.32)";

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "");
}

function StaticTokenOrb({ logoSrc, logoAlt, name, ticker }: Props) {
  const gradientId = `token-orb-grad-static-${sanitize(ticker)}`;
  return (
    <div className="relative h-56 w-56 sm:h-64 sm:w-64">
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: RING_GLOW_SHADOW }}
        aria-hidden
      />
      <div className="absolute inset-[2px] rounded-full bg-zinc-950" aria-hidden />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
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
          stroke={`url(#${gradientId})`}
          strokeWidth="0.9"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt={logoAlt}
          className="mb-4 h-14 w-14 rounded-full object-cover"
        />
        <h3 className="text-xl font-semibold text-white mb-1">{name}</h3>
        <p className="text-sm text-zinc-500">{ticker}</p>
      </div>
    </div>
  );
}

export function LandingTokenOrb({
  logoSrc,
  logoAlt,
  name,
  ticker,
  cardDelay = 0,
}: Props) {
  const prefersReducedMotion = useReducedMotion();
  const gradientId = `token-orb-grad-${sanitize(ticker)}`;

  if (prefersReducedMotion) {
    return (
      <StaticTokenOrb
        logoSrc={logoSrc}
        logoAlt={logoAlt}
        name={name}
        ticker={ticker}
      />
    );
  }

  return (
    <motion.div
      className="relative h-56 w-56 sm:h-64 sm:w-64"
      animate={{ y: [0, -3, 0] }}
      transition={{
        duration: 6,
        ease: "easeInOut",
        repeat: Infinity,
        delay: cardDelay,
      }}
    >
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: RING_GLOW_SHADOW }}
        animate={{ opacity: [0.75, 1, 0.75], scale: [1, 1.02, 1] }}
        transition={{
          duration: 5,
          ease: "easeInOut",
          repeat: Infinity,
          delay: cardDelay,
        }}
        aria-hidden
      />
      <div className="absolute inset-[2px] rounded-full bg-zinc-950" aria-hidden />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
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
          stroke={`url(#${gradientId})`}
          strokeWidth="0.9"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{
            duration: 1.6,
            delay: cardDelay,
            ease: [0.22, 0.61, 0.36, 1],
          }}
        />
      </svg>

      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{
          duration: 14,
          ease: "linear",
          repeat: Infinity,
          delay: -cardDelay,
        }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-300/60 blur-[1px]" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: -360 }}
        transition={{
          duration: 18,
          ease: "linear",
          repeat: Infinity,
          delay: -3 - cardDelay,
        }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200/55 blur-[1px]" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{
          duration: 22,
          ease: "linear",
          repeat: Infinity,
          delay: -8 - cardDelay,
        }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-400/55 blur-[1px]" />
      </motion.div>

      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
        variants={containerVariants}
        custom={cardDelay}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
      >
        <motion.div variants={itemVariants}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={logoAlt}
            className="mb-4 h-14 w-14 rounded-full object-cover"
          />
        </motion.div>
        <motion.h3
          variants={itemVariants}
          className="text-xl font-semibold text-white mb-1"
        >
          {name}
        </motion.h3>
        <motion.p variants={itemVariants} className="text-sm text-zinc-500">
          {ticker}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

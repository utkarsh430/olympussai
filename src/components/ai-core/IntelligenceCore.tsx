'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { AiState } from '@/lib/constants';

const STATE_COLOR: Record<AiState, string> = {
  Listening: '#22d9f5',
  Analysing: '#3ff0ff',
  'Recommendation Ready': '#2ef2c4',
  'Awaiting Authorization': '#ffb020',
  Monitoring: '#2bff88',
};

/**
 * Abstract circular intelligence core.
 * Original design — no third-party character, logo or likeness is used.
 */
export function IntelligenceCore({ state, size = 108 }: { state: AiState; size?: number }) {
  const reduced = useReducedMotion();
  const colour = STATE_COLOR[state];

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`AI copilot status: ${state}`}
    >
      {/* Outer orbital ring */}
      <motion.div
        className="absolute inset-0 rounded-full border border-dashed"
        style={{ borderColor: `${colour}55` }}
        animate={reduced ? {} : { rotate: 360 }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
      />

      {/* Counter-rotating segmented ring */}
      <motion.svg
        className="absolute inset-[9px]"
        viewBox="0 0 100 100"
        animate={reduced ? {} : { rotate: -360 }}
        transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={colour}
          strokeWidth="1.4"
          strokeOpacity="0.7"
          strokeDasharray="34 12 8 12"
          strokeLinecap="round"
        />
      </motion.svg>

      {/* Inner tick ring */}
      <div className="absolute inset-[20px] rounded-full border" style={{ borderColor: `${colour}33` }} />

      {/* Breathing core */}
      <motion.div
        className="absolute inset-[27px] rounded-full"
        style={{
          background: `radial-gradient(circle at 40% 35%, ${colour}dd, ${colour}22 55%, transparent 72%)`,
          boxShadow: `0 0 34px -4px ${colour}bb`,
        }}
        animate={reduced ? {} : { scale: [1, 1.07, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Core nucleus */}
      <div
        className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ backgroundColor: colour, boxShadow: `0 0 18px 3px ${colour}` }}
      />

      {/* Orbiting satellites */}
      {!reduced &&
        [0, 120, 240].map((offset, index) => (
          <motion.div
            key={offset}
            className="absolute inset-0"
            animate={{ rotate: 360 }}
            transition={{
              duration: 9 + index * 3,
              repeat: Infinity,
              ease: 'linear',
              delay: index * 0.7,
            }}
            style={{ rotate: offset }}
          >
            <span
              className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
              style={{ backgroundColor: colour, boxShadow: `0 0 8px 1px ${colour}` }}
            />
          </motion.div>
        ))}
    </div>
  );
}

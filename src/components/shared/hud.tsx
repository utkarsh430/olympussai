'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LIVE_LABELS } from '@/lib/constants';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/** Panel with holographic frame, corner ticks and an optional scanning line. */
export function HudPanel({
  children,
  className,
  strong,
  scan,
  label,
  right,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  scan?: boolean;
  label?: string;
  right?: ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <section
      className={cn(
        strong ? 'hud-panel-strong' : 'hud-panel',
        'hud-corners overflow-hidden',
        className,
      )}
    >
      {scan && !reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-scan-y bg-gradient-to-b from-holo-glow/[0.09] to-transparent"
        />
      )}
      {label && (
        <header className="flex items-center justify-between border-b border-holo-glow/12 px-3 py-2">
          <h2 className="hud-label">{label}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Which provenance badge a feed's source deserves.
 *
 * Shared by every surface that labels the live GPS feed (TopCommandBar,
 * FleetPanel, IntelligenceStrip) so a single source value can never read as
 * "LIVE" on one of them and something else on another. 'unavailable' is
 * critical rather than merely non-live: nothing is being displayed at all.
 */
export function sourceBadge(source: string | null): {
  variant: 'live' | 'fixture' | 'critical';
  label: string;
} {
  if (source === 'unavailable') return { variant: 'critical', label: LIVE_LABELS.unavailable };
  if (source === 'fixture') return { variant: 'fixture', label: LIVE_LABELS.fixture };
  return { variant: 'live', label: LIVE_LABELS.gps };
}

/** LIVE / MODEL / FIXTURE provenance badge. */
export function Badge({
  variant = 'sim',
  children,
  className,
  pulse,
}: {
  variant?: 'live' | 'sim' | 'fixture' | 'critical';
  children: ReactNode;
  className?: string;
  pulse?: boolean;
}) {
  const variantClass =
    variant === 'live'
      ? 'badge-live'
      : variant === 'fixture'
        ? 'badge-fixture'
        : variant === 'critical'
          ? 'badge-critical'
          : 'badge-sim';

  const dotColor =
    variant === 'live'
      ? 'bg-alert-green'
      : variant === 'fixture'
        ? 'bg-holo-glow'
        : variant === 'critical'
          ? 'bg-alert-crimson'
          : 'bg-alert-amber';

  return (
    <span className={cn(variantClass, className)}>
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', dotColor, pulse && 'animate-flicker')}
      />
      {children}
    </span>
  );
}

/** Animated count-up number for KPI readouts. */
export function CountUp({
  value,
  decimals = 0,
  className,
  suffix = '',
  prefix = '',
}: {
  value: number;
  decimals?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const frameRef = useRef<number | undefined>(undefined);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;

    // Skip the animation entirely for reduced motion, the first paint, or a
    // change too small to be perceptible. Polling nudges these counters every
    // 15s, and a full rAF run per nudge re-rendered the whole command bar ~54
    // times for a movement of one or two vehicles.
    if (reduced || Math.abs(value - from) < 2) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const duration = 900;
    let last = -1;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3; // easeOutCubic
      const next = from + (value - from) * eased;

      // Only re-render when the displayed text would actually change.
      const rounded = Number(next.toFixed(decimals));
      if (rounded !== last) {
        last = rounded;
        setDisplay(next);
      }

      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else {
        fromRef.current = value;
        setDisplay(value);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [value, reduced, decimals]);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Typewriter rendering for AI observations. */
export function Typewriter({
  text,
  className,
  speed = 16,
  onDone,
}: {
  text: string;
  className?: string;
  speed?: number;
  onDone?: () => void;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? text : '');

  useEffect(() => {
    if (reduced) {
      setShown(text);
      onDone?.();
      return;
    }

    setShown('');
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setShown(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(timer);
        onDone?.();
      }
    }, speed);

    return () => clearInterval(timer);
    // onDone intentionally excluded — callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, reduced]);

  return (
    <p className={className} aria-live="polite">
      {shown}
      {!reduced && shown.length < text.length && (
        <span aria-hidden className="ml-0.5 inline-block h-3 w-1.5 animate-flicker bg-holo-glow" />
      )}
    </p>
  );
}

/** Circular progress ring used for confidence scores. */
export function ConfidenceRing({
  percent,
  size = 76,
  label = 'Confidence',
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${percent} percent, projected`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(63,240,255,0.14)"
          strokeWidth="3"
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#3ff0ff"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          style={{ filter: 'drop-shadow(0 0 6px rgba(63,240,255,0.8))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-semibold text-holo-glow text-glow">{percent}%</span>
        <span className="font-mono text-[8px] uppercase tracking-widest text-holo-glow/50">
          {label}
        </span>
      </div>
    </div>
  );
}

/** Animated audio-style waveform (decorative — no audio is captured or played). */
export function Waveform({
  bars = 28,
  active = true,
  className,
  color = '#3ff0ff',
}: {
  bars?: number;
  active?: boolean;
  className?: string;
  color?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div className={cn('flex h-8 items-center gap-[3px]', className)} aria-hidden>
      {Array.from({ length: bars }).map((_, index) => {
        // Deterministic pseudo-random heights so SSR and client agree.
        const base = 24 + Math.abs(Math.sin(index * 1.7)) * 62;
        return (
          <motion.span
            key={index}
            className="w-[3px] rounded-full"
            style={{
              backgroundColor: color,
              opacity: active ? 0.85 : 0.25,
              // Fixed box + transform-only animation. Animating `height` here
              // forced a layout pass every frame for every bar, on a component
              // that is mounted for the entire session.
              height: '100%',
              transformOrigin: 'bottom',
              willChange: 'transform',
            }}
            initial={{ scaleY: base * 0.003 }}
            animate={
              reduced || !active
                ? { scaleY: base * 0.004 }
                : { scaleY: [base * 0.0028, base * 0.01, base * 0.0042] }
            }
            transition={
              reduced || !active
                ? { duration: 0 }
                : {
                    duration: 0.9 + (index % 5) * 0.16,
                    repeat: Infinity,
                    repeatType: 'mirror',
                    ease: 'easeInOut',
                  }
            }
          />
        );
      })}
    </div>
  );
}

/** Ambient background: grid, volumetric gradient, noise and drifting particles. */
export function AmbientBackdrop() {
  const reduced = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-volumetric" />
      <div className="absolute inset-0 bg-hud-grid bg-hud-grid opacity-60" />
      <div className="absolute inset-0 scanline-overlay opacity-50" />
      <div className="noise-overlay absolute inset-0 opacity-[0.035] mix-blend-overlay" />

      {/* Ambient particles. Kept few, transform/opacity only, and GPU-promoted:
          this layer sits behind the entire app for the whole session. */}
      {!reduced &&
        Array.from({ length: 8 }).map((_, index) => (
          <motion.span
            key={index}
            className="absolute h-1 w-1 rounded-full bg-holo-glow/40"
            style={{
              left: `${(index * 37) % 100}%`,
              top: `${(index * 61) % 100}%`,
              willChange: 'transform, opacity',
            }}
            animate={{ y: [0, -26, 0], opacity: [0.15, 0.55, 0.15] }}
            transition={{
              duration: 9 + (index % 6),
              repeat: Infinity,
              ease: 'easeInOut',
              delay: index * 0.6,
            }}
          />
        ))}

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-void to-transparent" />
    </div>
  );
}

/** Small key/value readout used throughout the HUD. */
export function Readout({
  label,
  value,
  accent = 'default',
  className,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  accent?: 'default' | 'amber' | 'crimson' | 'green';
  className?: string;
  mono?: boolean;
}) {
  const accentClass =
    accent === 'amber'
      ? 'text-alert-amber'
      : accent === 'crimson'
        ? 'text-alert-crimson'
        : accent === 'green'
          ? 'text-alert-green'
          : 'text-holo-glow';

  return (
    <div className={cn('min-w-0', className)}>
      <div className="hud-label truncate">{label}</div>
      <div className={cn('truncate text-sm', mono && 'font-mono tabular-nums', accentClass)}>
        {value}
      </div>
    </div>
  );
}

/** Persistent simulation disclosure strip for every simulated surface. */
export function SimulationBanner({
  label,
  className,
  variant = 'sim',
}: {
  label: string;
  className?: string;
  variant?: 'sim' | 'critical';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-3 py-1.5',
        variant === 'critical'
          ? 'border-alert-crimson/25 bg-alert-crimson/[0.07]'
          : 'border-alert-amber/25 bg-alert-amber/[0.07]',
        className,
      )}
    >
      <Badge variant={variant === 'critical' ? 'critical' : 'sim'} pulse>
        {label}
      </Badge>
      <span className="font-mono text-[10px] uppercase tracking-wider text-alert-amber/60">
        Not operational data
      </span>
    </div>
  );
}

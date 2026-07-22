/**
 * Quality-tier decision (Section 34).
 *
 * Never decided from viewport width alone — combines device-pixel ratio, WebGL
 * capability, mobile heuristics, hardware concurrency (weak hint) and the
 * reduced-motion preference. Drives particle counts, DPR cap, orbit complexity
 * and effect richness.
 */
export type QualityTier = 'high' | 'medium' | 'low' | 'reduced';

export interface QualityConfig {
  tier: QualityTier;
  dpr: [number, number];
  bgParticles: number;
  signalParticles: number;
  orbitCount: number;
  rays: number;
  /** Whether the decorative animation loop should run at all. */
  animate: boolean;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function hasWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function detectQuality(): QualityConfig {
  if (typeof window === 'undefined') {
    return TIERS.reduced;
  }
  if (prefersReducedMotion() || !hasWebGL()) {
    return TIERS.reduced;
  }

  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = isMobile();
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 720;

  if (mobile || (dpr > 2.5 && cores <= 4) || smallViewport) {
    return TIERS.low;
  }
  if (cores <= 4 || dpr > 2) {
    return TIERS.medium;
  }
  return TIERS.high;
}

const TIERS: Record<QualityTier, QualityConfig> = {
  high: {
    tier: 'high',
    dpr: [1, 1.5],
    bgParticles: 1100,
    signalParticles: 900,
    orbitCount: 5,
    rays: 64,
    animate: true,
  },
  medium: {
    tier: 'medium',
    dpr: [1, 1.4],
    bgParticles: 650,
    signalParticles: 520,
    orbitCount: 5,
    rays: 48,
    animate: true,
  },
  low: {
    tier: 'low',
    dpr: [1, 1.25],
    bgParticles: 280,
    signalParticles: 220,
    orbitCount: 5,
    rays: 32,
    animate: true,
  },
  reduced: {
    tier: 'reduced',
    dpr: [1, 1.25],
    bgParticles: 90,
    signalParticles: 0,
    orbitCount: 5,
    rays: 24,
    animate: false,
  },
};

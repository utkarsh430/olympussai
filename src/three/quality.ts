/**
 * Quality-tier decision (Section 34).
 *
 * Never decided from viewport width alone — combines device-pixel ratio, WebGL
 * capability, mobile heuristics, hardware concurrency (weak hint) and the
 * reduced-motion preference. Drives particle counts, DPR cap, orbit complexity
 * and effect richness.
 */
export type QualityTier = 'high' | 'medium' | 'low' | 'reduced';

/** Per-tier controls for the golden globe (continents, grid, rim, orbits, arcs). */
export interface GlobeQuality {
  /** Continent dot grid spacing in degrees at the equator — smaller = denser. */
  stepDeg: number;
  /** Continent point sprite size (world units, size-attenuated). */
  dotSize: number;
  /** Full-sphere ocean/data-lattice grid spacing (deg) — smaller = denser net. */
  oceanStepDeg: number;
  /** Ocean lattice point sprite size (world units) — kept below the land dots. */
  oceanDotSize: number;
  /** Latitude circles drawn in the graticule (poles excluded). */
  parallels: number;
  /** Longitude meridians drawn in the graticule. */
  meridians: number;
  /** Segments per graticule line (smoothness). */
  graticuleSegments: number;
  /** Whether the thin atmospheric rim shell is drawn. */
  atmosphere: boolean;
  /** Number of inclined orbital paths around the globe. */
  orbitPaths: number;
  /** Segments per orbital ring (smoothness). */
  orbitSegments: number;
  /** Number of small satellite-like orbiters travelling the paths. */
  satellites: number;
  /** Number of tiny static marker/light points attached to orbits. */
  markers: number;
  /** Number of geographic great-circle arcs (route network). */
  arcs: number;
  /** Segments per arc (smoothness). */
  arcSegments: number;
}

export interface QualityConfig {
  tier: QualityTier;
  dpr: [number, number];
  bgParticles: number;
  signalParticles: number;
  orbitCount: number;
  globe: GlobeQuality;
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
    // ~12,000 land dots + ~7,200 ocean-lattice dots, orbital ecosystem + arcs.
    globe: {
      stepDeg: 1.0, dotSize: 0.02, oceanStepDeg: 2.4, oceanDotSize: 0.014,
      parallels: 15, meridians: 22, graticuleSegments: 96, atmosphere: true,
      orbitPaths: 4, orbitSegments: 128, satellites: 6, markers: 8, arcs: 9, arcSegments: 64,
    },
    animate: true,
  },
  medium: {
    tier: 'medium',
    dpr: [1, 1.4],
    bgParticles: 650,
    signalParticles: 520,
    orbitCount: 5,
    // ~6,100 land dots + ~4,600 ocean-lattice dots; fewer rings/satellites/arcs.
    globe: {
      stepDeg: 1.4, dotSize: 0.021, oceanStepDeg: 3.0, oceanDotSize: 0.015,
      parallels: 12, meridians: 18, graticuleSegments: 72, atmosphere: true,
      orbitPaths: 3, orbitSegments: 96, satellites: 4, markers: 5, arcs: 5, arcSegments: 48,
    },
    animate: true,
  },
  low: {
    tier: 'low',
    dpr: [1, 1.25],
    bgParticles: 280,
    signalParticles: 220,
    orbitCount: 5,
    // ~3,000 land dots + ~2,300 ocean-lattice dots — net kept visible but simple.
    globe: {
      stepDeg: 2.0, dotSize: 0.024, oceanStepDeg: 4.2, oceanDotSize: 0.018,
      parallels: 9, meridians: 12, graticuleSegments: 48, atmosphere: true,
      orbitPaths: 2, orbitSegments: 64, satellites: 2, markers: 3, arcs: 2, arcSegments: 32,
    },
    animate: true,
  },
  reduced: {
    tier: 'reduced',
    dpr: [1, 1.25],
    bgParticles: 90,
    signalParticles: 0,
    orbitCount: 5,
    // Unused: `animate:false` returns null and the static CSS backdrop remains.
    globe: {
      stepDeg: 3.2, dotSize: 0.024, oceanStepDeg: 5.0, oceanDotSize: 0.018,
      parallels: 9, meridians: 12, graticuleSegments: 48, atmosphere: false,
      orbitPaths: 0, orbitSegments: 32, satellites: 0, markers: 0, arcs: 0, arcSegments: 16,
    },
    animate: false,
  },
};

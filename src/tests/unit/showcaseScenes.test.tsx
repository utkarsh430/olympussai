// @vitest-environment jsdom
//
// The /trial scenes, rendered from a real (if minimal) trial-data shape run
// through the real resolver. Each scene is asserted on the words an audience
// reads, and the whole set is asserted to carry no provenance labelling and
// none of the cockpit vocabulary the quiet theme replaced: this page presents
// results, and "PROJECTED" on a numeral is a different claim from the one the
// page makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ControllerPipelineScene } from '@/components/showcase/ControllerPipelineScene';
import { HeroScene } from '@/components/showcase/HeroScene';
import { PassengerBalanceScene } from '@/components/showcase/PassengerBalanceScene';
import { ReportScene } from '@/components/showcase/ReportScene';
import { ScaleProjectionScene } from '@/components/showcase/ScaleProjectionScene';
import { ScenarioGalleryScene } from '@/components/showcase/ScenarioGalleryScene';
import { VerdictScene } from '@/components/showcase/VerdictScene';
import { showcaseFigures } from '@/lib/showcase/figures';
import { resolveShowcase } from '@/lib/showcase/resolve';
import { trialDataSchema } from '@/lib/showcase/trialData';

// Recharts measures its container and jsdom reports 0, so the chart draws
// nothing here; the gallery's own words are what these tests read.
vi.mock('@/components/showcase/Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

// ─── A minimal trial-data file ───────────────────────────────────────────

function contrast(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    ewtImprovementPercent: 54,
    passengerSecondsSavedPercent: 3.8,
    passengerSecondsSaved: 1_000,
    incidentsAvoided: 3,
    waitSecondsSaved: 2_000,
    onboardDelayImposed: 500,
    inVehicleSecondsSaved: 100,
    bunchingRateImprovementPercent: 40,
    cvImprovementPercent: 11.1,
    addedJourneySecondsPerVehicle: 474,
    additionalDeniedBoardings: 0,
    ...overrides,
  };
}

function arm(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    ewtSeconds: 120,
    meanHeadwaySeconds: 360,
    headwayCv: 0.4,
    bunchingRate: 0.1,
    incidentsDetected: 6,
    incidentsResolved: 2,
    onTimeRate: 0.7,
    meanHoldSecondsPerVehicle: 30,
    totalHoldSeconds: 600,
    totalPassengerSeconds: 100_000,
    waitPassengerSeconds: 20_000,
    boardings: 500,
    deniedBoardings: 0,
    deniedShare: 0,
    firstTimeDeniedBoardings: 0,
    meanJourneySeconds: 26_118,
    p95JourneySeconds: 27_000,
    meanScheduleDeviationSeconds: 40,
    p95ScheduleDeviationSeconds: 200,
    maxHoldSecondsOnAnyVehicle: 120,
    alightingOnlyActions: 0,
    alightingOnlyPassengersPassed: 0,
    ...overrides,
  };
}

function sweep(peak: number) {
  return [0, 600, 1_200, 1_800].map((atSeconds, index) => ({
    atSeconds,
    openIncidents: index === 2 ? peak : Math.floor(peak / 2),
    bunchedPairs: 1,
    liveVehicles: 20,
  }));
}

function trajectory(vehicleId: string) {
  return {
    vehicleId,
    points: [
      { t: 0, d: 0, hold: 0 },
      { t: 60, d: 500, hold: 0 },
      { t: 120, d: 1_000, hold: 20 },
    ],
  };
}

function scenario(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    mechanism: `${title} mechanism`,
    whatItTests: `${title} test`,
    vehicleCount: 20,
    horizonSeconds: 1_800,
    saturated: false,
    contrast: contrast(),
    controlled: arm({ incidentsDetected: 3 }),
    uncontrolled: arm(),
    sweeps: { controlled: sweep(2), uncontrolled: sweep(5) },
    trajectories: null,
    ...overrides,
  };
}

const replayScenario = (title: string) =>
  scenario('steady_variability', title, {
    trajectories: {
      controlled: [trajectory('c-1'), trajectory('c-2')],
      uncontrolled: [trajectory('u-1'), trajectory('u-2')],
    },
  });
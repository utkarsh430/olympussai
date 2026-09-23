// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { showcaseFigures, type ShowcaseFigures } from '@/lib/showcase/figures';
import { LUCKNOW_CORRIDOR } from '@/lib/showcase/corridor';
import { resolveShowcase, scenarioFamily, scenarioOutcome } from '@/lib/showcase/resolve';
import {
  trialDataSchema,
  type TrialArmSummary,
  type TrialContrast,
  type TrialData,
  type TrialScenario,
} from '@/lib/showcase/trialData';

function contrast(over: Partial<TrialContrast> = {}): TrialContrast {
  return {
    ewtImprovementPercent: 40,
    passengerSecondsSavedPercent: 2.5,
    passengerSecondsSaved: 9000,
    incidentsAvoided: 12,
    waitSecondsSaved: 12000,
    onboardDelayImposed: 4000,
    inVehicleSecondsSaved: -3000,
    bunchingRateImprovementPercent: 30,
    cvImprovementPercent: 12,
    addedJourneySecondsPerVehicle: 474,
    additionalDeniedBoardings: -6,
    ...over,
  };
}

function arm(over: Partial<TrialArmSummary> = {}): TrialArmSummary {
  return {
    ewtSeconds: 90,
    meanHeadwaySeconds: 360,
    headwayCv: 0.4,
    bunchingRate: 0.1,
    incidentsDetected: 100,
    incidentsResolved: 10,
    onTimeRate: 0.6,
    meanHoldSecondsPerVehicle: 120,
    totalHoldSeconds: 6000,
    totalPassengerSeconds: 360000,
    waitPassengerSeconds: 90000,
    boardings: 4000,
    deniedBoardings: 10,
    deniedShare: 0.0025,
    firstTimeDeniedBoardings: 10,
    meanJourneySeconds: 26118,
    p95JourneySeconds: 27000,
    meanScheduleDeviationSeconds: 40,
    p95ScheduleDeviationSeconds: 200,
    maxHoldSecondsOnAnyVehicle: 120,
    alightingOnlyActions: 0,
    alightingOnlyPassengersPassed: 0,
    ...over,
  };
}

function scenario(id: TrialScenario['id'], over: Partial<TrialScenario> = {}): TrialScenario {
  return {
    id,
    title: id,
    mechanism: `${id} mechanism`,
    whatItTests: `${id} tests`,
    vehicleCount: 50,
    horizonSeconds: 24000,
    saturated: false,
    contrast: contrast(),
    controlled: arm({ incidentsDetected: 60 }),
    uncontrolled: arm(),
    sweeps: {
      controlled: [
        { atSeconds: 0, openIncidents: 0, bunchedPairs: 0, liveVehicles: 5 },
        { atSeconds: 12000, openIncidents: 2, bunchedPairs: 1, liveVehicles: 9 },
      ],
      uncontrolled: [
        { atSeconds: 0, openIncidents: 0, bunchedPairs: 0, liveVehicles: 5 },
        { atSeconds: 12000, openIncidents: 5, bunchedPairs: 3, liveVehicles: 9 },
      ],
    },
    trajectories: null,
    ...over,
  };
}
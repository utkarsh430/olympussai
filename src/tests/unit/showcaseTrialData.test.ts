// @vitest-environment node
//
// The showcase extractor, driven over a report small enough to read.
//
// The fixture mirrors simulatorConsole.test.tsx's builder and is PARSED with
// the wire schema rather than cast, so it cannot drift out of the contract
// the real script reads. Every assertion is about a rule the page depends on:
// the committed file must parse, the curves must still end where the run
// ended, the replay trajectories must be kept exactly where the picker looks
// for them and nowhere else, the other phase must carry no curves nobody
// reads, and the headline percent must be the one number the console already
// publishes.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTRACT_OPTIONS,
  decimate,
  extractTrialData,
  type ExtractOptions,
} from '../../../scripts/lib/showcaseTrialData';
import { headlineNetPassengerTime } from '@/lib/ops/fleetTrialView';
import { trialDataSchema } from '@/lib/showcase/trialData';
import {
  fleetTrialReportSchema,
  type BunchingScenarioId,
  type FleetTrialReport,
} from '@/models/fleetTrial';

// ─── Fixture ──────────────────────────────────────────────────────────────

type Spacing = FleetTrialReport['phases'][number]['controlled']['spacing'];

const spacing = (over: Partial<Spacing> = {}): Spacing => ({
  headwaySampleCount: 100,
  meanHeadwaySeconds: 600,
  ewtSeconds: 60,
  headwayCv: 0.4,
  bunchingRate: 0.1,
  deniedBoardings: 40,
  firstTimeDeniedBoardings: 10,
  totalBoardings: 990,
  deniedShare: 10 / 1000,
  saturated: false,
  ...over,
});

const punctuality = () => ({
  vehiclesCompleted: 30,
  meanJourneySeconds: 3600,
  p95JourneySeconds: 3900,
  maxJourneySeconds: 4000,
  totalHoldSeconds: 600,
  meanHoldSecondsPerVehicle: 20,
  maxHoldSecondsOnAnyVehicle: 90,
  refusedHoldSeconds: 0,
  meanScheduleDeviationSeconds: 30,
  p95ScheduleDeviationSeconds: 200,
  onTimeRate: 0.9,
  shareBeyondLatenessBound: 0.05,
  alightingOnlyActions: 0,
  alightingOnlyPassengersPassed: 0,
});

const passengers = (totalPassengerSeconds: number) => ({
  boardings: 1000,
  deniedBoardings: 40,
  waitPassengerSeconds: totalPassengerSeconds * 0.3,
  onboardDelayPassengerSeconds: 500,
  dwellPassengerSeconds: totalPassengerSeconds * 0.2,
  ridePassengerSeconds: totalPassengerSeconds * 0.5,
  inVehiclePassengerSeconds: totalPassengerSeconds * 0.7,
  totalPassengerSeconds,
});

const incidents = () => ({
  detected: 20,
  byOpeningSeverity: { bunched: 10 },
  byPeakSeverity: { bunched: 10 },
  escalatedFromPrediction: 2,
  resolved: 15,
  closedPairGone: 3,
  unresolvedAtEnd: 2,
  medianResolutionSeconds: 300,
  meanResolutionSeconds: 320,
  worstRatio: 0.2,
  withIntervention: 8,
  totalHoldSecondsServed: 600,
});

const arm = (totalPassengerSeconds: number, spacingOver: Partial<Spacing> = {}) => ({
  spacing: spacing(spacingOver),
  punctuality: punctuality(),
  passengers: passengers(totalPassengerSeconds),
  incidents: incidents(),
});

const contrast = (saved: number, total: number) => ({
  ewtImprovementSeconds: 20,
  ewtImprovementPercent: 25,
  cvImprovementPercent: 20,
  bunchingRateImprovementPercent: 30,
  incidentsAvoided: 5,
  addedJourneySecondsPerVehicle: 30,
  additionalDeniedBoardings: 0,
  passengerSecondsSaved: saved,
  passengerSecondsSavedPercent: (saved / total) * 100,
  passengerSecondsPerBoardingSavedPercent: (saved / total) * 100,
  waitSecondsSaved: saved,
  onboardDelayImposed: 500,
  inVehicleSecondsSaved: 0,
});

const sweepSamples = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    atSeconds: i * 60,
    liveVehicles: 10 + (i % 5),
    pairCount: 9,
    minRatio: 0.3,
    meanRatio: 0.8,
    bunchedPairs: i % 3,
    warningPairs: 1,
    openIncidents: i % 2,
  }));

const trajectory = (vehicleId: string) => ({
  vehicleId,
  points: [
    { t: 0, d: 0, hold: 0 },
    { t: 600, d: 2000, hold: 30 },
    { t: 1200, d: 4000, hold: 0 },
  ],
});

interface ScenarioShape {
  id: BunchingScenarioId;
  title: string;
  saturated: 'none' | 'controlled' | 'uncontrolled';
  sweepCount: number;
  trajectoryCount: number;
}
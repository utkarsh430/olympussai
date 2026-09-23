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
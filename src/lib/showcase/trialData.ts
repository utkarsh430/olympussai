/**
 * The shapes the showcase draws from a real fleet-trial run.
 *
 * `scripts/showcase/build-trial-data.ts` extracts this from one or more
 * `sim:fleet` reports and writes `generated/trialData.json`; the page parses
 * that file with the schema below at module load, so a stale or hand-edited
 * file fails at build time rather than on stage.
 *
 * Deliberately a SUBSET of `src/models/fleetTrial.ts`: only what a scene
 * renders. Trajectories are kept for the replay scenarios of every corridor,
 * sweeps are decimated and carried for the headline phase only (the other
 * phase's scenarios keep empty sweep arrays), which is what keeps the
 * committed file small enough to import into the server page.
 *
 * No `'use client'`: the server page imports this, and so do the extractor
 * and the tests.
 */
import { z } from 'zod';
import {
  bunchingScenarioIdSchema,
  corridorPresetIdSchema,
  phaseIdSchema,
} from '@/models/fleetTrial';

export const trialContrastSchema = z.object({
  ewtImprovementPercent: z.number().nullable(),
  passengerSecondsSavedPercent: z.number().nullable(),
  passengerSecondsSaved: z.number(),
  incidentsAvoided: z.number(),
  waitSecondsSaved: z.number(),
  onboardDelayImposed: z.number(),
  inVehicleSecondsSaved: z.number(),
  bunchingRateImprovementPercent: z.number().nullable(),
  cvImprovementPercent: z.number().nullable(),
  addedJourneySecondsPerVehicle: z.number().nullable(),
  additionalDeniedBoardings: z.number(),
});
export type TrialContrast = z.infer<typeof trialContrastSchema>;

export const trialArmSummarySchema = z.object({
  ewtSeconds: z.number().nullable(),
  meanHeadwaySeconds: z.number().nullable(),
  headwayCv: z.number().nullable(),
  bunchingRate: z.number(),
  incidentsDetected: z.number(),
  incidentsResolved: z.number(),
  onTimeRate: z.number().nullable(),
  meanHoldSecondsPerVehicle: z.number(),
  totalHoldSeconds: z.number(),
  totalPassengerSeconds: z.number(),
  waitPassengerSeconds: z.number(),
  boardings: z.number(),
  deniedBoardings: z.number(),
  /** Headcount share the `saturated` flag is drawn on; null when nobody was offered a seat. */
  deniedShare: z.number().nullable(),
  firstTimeDeniedBoardings: z.number(),
  meanJourneySeconds: z.number().nullable(),
  p95JourneySeconds: z.number().nullable(),
  meanScheduleDeviationSeconds: z.number().nullable(),
  p95ScheduleDeviationSeconds: z.number().nullable(),
  maxHoldSecondsOnAnyVehicle: z.number(),
  alightingOnlyActions: z.number(),
  alightingOnlyPassengersPassed: z.number(),
});
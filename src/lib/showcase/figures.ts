/**
 * THE ONE FILE TO EDIT WHEN A NUMBER ON /trial SHOULD CHANGE.
 *
 * Every headline figure the showcase states is authored here. Anything not
 * authored (a null, or a scenario with no override) is read from the real
 * trial data in `generated/trialData.json` by `resolve.ts`. The scenes never
 * carry a literal of their own, so a change here reaches every surface that
 * quotes it - the hero, the verdict, the corridor tiles, the balance and the
 * scale projection - in one edit.
 *
 * No `'use client'`: the server page reads this.
 */
import type { BunchingScenarioId, CorridorPresetId } from '@/models/fleetTrial';

export type ControllabilityBand = 'too_regular' | 'controllable' | 'too_disturbed';

export interface CorridorFigure {
  presetId: CorridorPresetId;
  name: string;
  shape: string;
  lengthKm: number;
  stops: number;
  headwayMinutes: number;
  /** Net total passenger time saved, percent of what passengers spend. */
  netPassengerTimeSavedPercent: number;
  /** Excess waiting removed, percent. */
  excessWaitCutPercent: number;
  seedsAgreeing: number;
  seedsTotal: number;
  band: ControllabilityBand;
}

export interface LawFigure {
  id: string;
  name: string;
  oneLiner: string;
}

export interface PipelineStageFigure {
  id: 'detect' | 'decide' | 'deliver' | 'measure';
  title: string;
  body: string;
  statLabel: string;
  statValue: number;
  statSuffix?: string;
}

export interface ShowcaseFigures {
  network: {
    buses: number;
    corridors: number;
    passengersPerDay: number;
  };
  trial: {
    buses: number;
    scenarios: number;
    corridors: number;
    simulatedServiceHours: number;
    decisions: number;
    holdsIssued: number;
    meanHoldMinutesPerBus: number;
  };
  headline: {
    verdict: string;
    because: string;
    excessWaitCutPercent: number;
    netPassengerTimeSavedPercent: number;
    bunchingIncidentsCutPercent: number;
    incidentsResolvedBeforePercent: number;
    incidentsResolvedAfterPercent: number;
    onTimeBeforePercent: number;
    onTimeAfterPercent: number;
    waitingRemovedHours: number;
    timeAboardAddedHours: number;
    netHoursSaved: number;
  };
  corridors: readonly CorridorFigure[];
  /** One line per scenario: what goes wrong. Shown on the gallery card. */
  scenarioNotes: Record<BunchingScenarioId, string>;
  /** Per-scenario overrides; an absent key reads the trial's own figure. */
  scenarioOverrides: Partial<
    Record<
      BunchingScenarioId,
      { netPassengerTimeSavedPercent?: number; excessWaitCutPercent?: number }
    >
  >;
  scale: {
    fromBuses: number;
    toBuses: number;
    passengerHoursSavedPerDay: number;
    incidentsPreventedPerDay: number;
    holdMinutesPerBusPerDay: number;
    corridorsCovered: number;
    passengersServedPerDay: number;
    controlRoomsNeeded: number;
  };
  laws: readonly LawFigure[];
  detector: {
    sweepSeconds: number;
    tiers: readonly string[];
    description: string;
  };
  pipeline: readonly PipelineStageFigure[];
  report: {
    title: string;
    /** How the trial was run, in the words the report prints under "Method". */
    method: readonly string[];
  };
}

export const showcaseFigures: ShowcaseFigures = {
  network: {
    buses: 10_000,
    corridors: 759,
    passengersPerDay: 3_200_000,
  },
  trial: {
    buses: 1_000,
    scenarios: 19,
    corridors: 3,
    simulatedServiceHours: 36,
    decisions: 182_400,
    holdsIssued: 24_600,
    meanHoldMinutesPerBus: 3.0,
  },
  headline: {
    verdict: 'The controller helped.',
    because:
      'Buses stayed evenly spaced, passengers waited less, and every second of the journey was counted - kerb, dwell, hold and ride.',
    excessWaitCutPercent: 54,
    netPassengerTimeSavedPercent: 3.8,
    bunchingIncidentsCutPercent: 50,
    incidentsResolvedBeforePercent: 8,
    incidentsResolvedAfterPercent: 40,
    onTimeBeforePercent: 63,
    onTimeAfterPercent: 81,
    waitingRemovedHours: 3_010,
    timeAboardAddedHours: 830,
    netHoursSaved: 2_180,
  },
  corridors: [
    {
      presetId: 'urban',
      name: 'City trunk',
      shape: '24 km · 25 stops · 6-minute headway',
      lengthKm: 24,
      stops: 25,
      headwayMinutes: 6,
      netPassengerTimeSavedPercent: 3.8,
      excessWaitCutPercent: 54,
      seedsAgreeing: 6,
      seedsTotal: 6,
      band: 'controllable',
    },
    {
      presetId: 'suburban',
      name: 'Suburban radial',
      shape: '60 km · 15 stops · 12-minute headway',
      lengthKm: 60,
      stops: 15,
      headwayMinutes: 12,
      netPassengerTimeSavedPercent: 1.2,
      excessWaitCutPercent: 39,
      seedsAgreeing: 6,
      seedsTotal: 6,
      band: 'controllable',
    },
    {
      presetId: 'intercity',
      name: 'Inter-city trunk',
      shape: '300 km · 10 stations · 30-minute headway',
      lengthKm: 300,
      stops: 10,
      headwayMinutes: 30,
      netPassengerTimeSavedPercent: 0.6,
      excessWaitCutPercent: 19,
      seedsAgreeing: 5,
      seedsTotal: 6,
      band: 'too_disturbed',
    },
  ],
  scenarioNotes: {
    steady_variability: 'Nothing goes wrong. Running times simply vary, as they do every day.',
    terminal_jitter: 'Departures leave the origin unevenly.',
    station_surge: 'A crowd builds at one mid-route station.',
    slow_bus: 'One vehicle runs below fleet pace for the middle of its trip.',
    traffic_shock: 'A stretch of road runs slow for a window, for every bus in it.',
    missed_trip: 'Scheduled departures do not run at all.',
    cascade: 'A slow bus into a crowded station on an unreliable day.',
    peak_load: 'Demand close to seat capacity.',
    gps_dropout: 'Buses stop reporting their position.',
    driver_non_compliance: 'Fleet-wide, only 45% of instructions are followed.',
    phantom_position: 'The GPS feed is fresh, consistent, and wrong - drifting a headway per trip.',
    frozen_feed: 'A modem republishes its last fix with a current timestamp.',
    blind_slowdown: 'A congestion window plus a map-match error on the buses inside it.',
    hotspot_demand: 'Five stops carry the whole route; the rest are quiet.',
    partial_compliance: 'Four tiers of driver, some serving a quarter of each instruction.',
    oversaturated: 'Past the denied-boarding line, where seats bound waiting time.',
    shock_and_recovery: 'One severe closure, then a long clean stretch to recover in.',
    oscillating_shock: 'A stretch alternating slow and fast once every headway.',
    building_peak: 'Demand climbs through the whole run, so no timetable fits any bus.',
  },
  scenarioOverrides: {},
  scale: {
    fromBuses: 1_000,
    toBuses: 10_000,
    passengerHoursSavedPerDay: 18_000,
    incidentsPreventedPerDay: 31_000,
    holdMinutesPerBusPerDay: 3,
    corridorsCovered: 759,
    passengersServedPerDay: 3_200_000,
    controlRoomsNeeded: 1,
  },
  laws: [
    {
      id: 'terminal_dispatch',
      name: 'Terminal dispatch',
      oneLiner: 'Holds a bus at the origin until its planned gap to the bus ahead has opened.',
    },
    {
      id: 'two_way',
      name: 'Two-way holding',
      oneLiner: 'Balances the gap ahead against the gap behind at every holding point.',
    },
    {
      id: 'self_equalizing',
      name: 'Self-equalising',
      oneLiner: 'Regulates on the gap ahead alone when the bus behind cannot be seen.',
    },
    {
      id: 'boarding_limit',
      name: 'Alighting-only',
      oneLiner: 'Lets a crowded leader drop off and run when its follower is close behind.',
    },
  ],
  detector: {
    sweepSeconds: 60,
    tiers: ['Reactive', 'Predictive'],
    description:
      'Every sixty seconds the detector measures the gap between every pair of buses and projects it forward, so a bunch is flagged before it forms.',
  },
  pipeline: [
    {
      id: 'detect',
      title: 'Detect',
      body: 'A two-tier detector sweeps every corridor every minute: one tier reads the gap that exists, the other projects the gap that is forming.',
      statLabel: 'Sweep cadence',
      statValue: 60,
      statSuffix: ' s',
    },
    {
      id: 'decide',
      title: 'Decide',
      body: 'Four control laws each propose an action; a hard safety filter and a cost ranking choose one, or none.',
      statLabel: 'Decisions taken',
      statValue: 182_400,
    },
    {
      id: 'deliver',
      title: 'Deliver',
      body: 'The chosen instruction reaches the driver as a timed hold or an alighting-only stop, with acknowledgement and expiry.',
      statLabel: 'Holds issued',
      statValue: 24_600,
    },
    {
      id: 'measure',
      title: 'Measure',
      body: 'Every passenger second is counted once - waiting, dwelling, holding and riding - and both arms of the trial are compared on it.',
      statLabel: 'Passenger-hours saved',
      statValue: 2_180,
    },
  ],
  report: {
    title: 'Fleet trial report',
    method: [
      'Every scenario was run twice on the same seed: once with nobody intervening, once under the deployed control laws. The two runs share the corridor, the demand, the disturbances and the fleet, so the difference between them is the controller and nothing else.',
      'Total passenger time counts every second a passenger spends from arriving at a stop to alighting - waiting at the kerb, dwelling at the door, held by the controller, and riding - once each. It is the headline; excess waiting time, which counts only the people at stops, is reported beside it.',
      'Bunching is detected by the deployed two-tier detector at its live sixty-second cadence: a reactive tier that reads the gap that exists and a predictive tier that projects the gap that is forming. Incidents are counted on both arms over one shared window.',
      'Corridor results pool every scenario the corridor could read. A scenario that ran past the denied-boarding line, where waiting time is bounded by seats rather than spacing, is reported on its own row and kept out of the corridor total.',
    ],
  },
};

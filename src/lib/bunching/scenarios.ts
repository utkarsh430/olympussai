/**
 * The six bunching scenarios, declared as data.
 *
 * A scenario describes only the *cause*: the corridor's starting state, the
 * exogenous minutes each bus loses or gains per iteration, which buses UPSRTC
 * can influence, and the narrative around it. It never states the headways that
 * follow — those are produced by `simulation.ts` running the same dynamics on
 * both sides of the comparison, so the uncontrolled and controlled runs are
 * guaranteed to start from an identical disturbance.
 */

import type { BusDeltas, BusId, ScenarioDefinition, ScenarioId } from './types';

function delta(partial: Partial<Record<BusId, number>>): BusDeltas {
  return { A: partial.A ?? 0, B: partial.B ?? 0, C: partial.C ?? 0, D: partial.D ?? 0 };
}

const NO_DISTURBANCE = delta({});

const ALL_CONTROLLABLE = { A: true, B: true, C: true, D: true } as const;
/** The lead bus is stuck in an external condition UPSRTC cannot influence. */
const LEAD_UNCONTROLLABLE = { A: false, B: true, C: true, D: true } as const;

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'traffic-shock',
    number: '01',
    name: 'Traffic Shock',
    cause: 'Lead bus delayed, causing downstream headway compression.',
    title: 'Traffic Shock → Headway Compression',
    description:
      'The lead bus encounters congestion. The disturbance propagates through passenger accumulation and unequal dwell times.',
    iterations: 6,
    initialHeadways: [6, 10, 10],
    // Bus A has already lost four minutes when the comparison starts, and keeps
    // losing time while it clears the congested section.
    disturbance: [delta({ A: 0.8 }), delta({ A: 0.4 }), NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE],
    controllable: LEAD_UNCONTROLLABLE,
    incident: {
      kind: 'congestion',
      mapLabel: 'Congestion affecting Bus A',
      anchorBus: 'A',
      anchorStopIndex: null,
      activeUntilIteration: 1,
    },
    occupancyBase: null,
    terminalSchedule: null,
    figures: [
      { label: 'Initial delay to Bus A', observed: '4.0 min' },
      { label: 'Residual congestion delay', observed: '1.2 min over 2 cycles' },
      { label: 'Control available on Bus A', observed: 'None — external condition' },
    ],
    narrative: {
      whatHappened:
        'Bus A is held up by traffic congestion and falls behind. Because A is late, more passengers accumulate at the stops ahead of it, so its dwell times grow and it loses further time. Bus B arrives at those same stops shortly afterwards, finds far fewer waiting passengers, dwells briefly and closes on A.',
      whyAmplifies:
        'Dwell time depends on the gap in front of a bus, so a small headway keeps shrinking and a large headway keeps growing. The disturbance feeds itself: A gets later, B gets faster, and the gap that opens behind B is absorbed by nobody.',
      whatAiDoes:
        'The controller evaluates both the forward and the backward headway before holding anything. It applies a small hold to B and, because that hold would compress B–C, coordinates a smaller adjustment on C and D at the same time — then reduces the intervention as the corridor recovers.',
    },
  },

  {
    id: 'passenger-surge',
    number: '02',
    name: 'Passenger Surge',
    cause: 'A major stop generates far higher demand than planned.',
    title: 'Passenger Surge → Dwell-Time Feedback',
    description:
      'A major stop suddenly generates significantly higher-than-normal passenger demand, extending the lead bus dwell time and starting a dwell-time feedback loop.',
    iterations: 6,
    initialHeadways: [7, 10, 10],
    disturbance: [
      delta({ A: 1.2 }),
      delta({ A: 0.8 }),
      delta({ A: 0.4 }),
      NO_DISTURBANCE,
      NO_DISTURBANCE,
      NO_DISTURBANCE,
    ],
    controllable: LEAD_UNCONTROLLABLE,
    incident: {
      kind: 'surge',
      mapLabel: 'Passenger surge — extended dwell',
      anchorBus: null,
      anchorStopIndex: 3,
      activeUntilIteration: 2,
    },
    occupancyBase: { A: 70, B: 45, C: 46, D: 45 },
    terminalSchedule: null,
    figures: [
      { label: 'Passengers at surge stop', expected: '15', observed: '65' },
      { label: 'Dwell time', expected: '45 sec', observed: '190 sec' },
      { label: 'Bus A occupancy', expected: '70%', observed: 'rising' },
    ],
    narrative: {
      whatHappened:
        'An unplanned crowd builds at a major stop. Bus A absorbs it, dwelling roughly four times longer than scheduled, and leaves late and heavily loaded. Bus B reaches the same stop to find it nearly empty, dwells briefly and closes the gap.',
      whyAmplifies:
        'Passenger arrivals are shared out by headway. Every minute A loses hands the next stop more waiting passengers, lengthening A’s dwell again, while B — running close behind — collects almost nobody and keeps gaining. Occupancy diverges alongside the headways.',
      whatAiDoes:
        'The controller keeps B from immediately catching A using a micro-hold and controlled progression, so following buses absorb the additional boarding demand instead of arriving as a pair. Passenger-load redistribution at a designated stop is offered as an optional operational strategy, not a command.',
    },
  },

  {
    id: 'fast-follower',
    number: '03',
    name: 'Fast Follower',
    cause: 'Following bus runs faster than its leader and closes the gap.',
    title: 'Fast Follower → Predictive Bunching',
    description:
      'Bus B is progressing faster than Bus A because of a lighter passenger load, shorter dwell times and temporarily better road conditions. The bunch is predicted before any physical cluster forms.',
    iterations: 6,
    initialHeadways: [7, 10, 10],
    disturbance: [
      delta({ B: -0.5 }),
      delta({ B: -0.5 }),
      delta({ B: -0.5 }),
      NO_DISTURBANCE,
      NO_DISTURBANCE,
      NO_DISTURBANCE,
    ],
    controllable: ALL_CONTROLLABLE,
    incident: {
      kind: 'fast-follower',
      mapLabel: 'Bus B closing on Bus A',
      anchorBus: 'B',
      anchorStopIndex: null,
      activeUntilIteration: 2,
    },
    occupancyBase: { A: 62, B: 38, C: 47, D: 45 },
    terminalSchedule: null,
    figures: [
      { label: 'Bus B running advantage', observed: '0.5 min per cycle' },
      { label: 'Physical cluster', observed: 'Not yet formed' },
      { label: 'Detection basis', observed: 'Closing rate, not proximity' },
    ],
    narrative: {
      whatHappened:
        'Nothing has gone visibly wrong: no incident, no breakdown, no crowd. Bus B is simply running light and making better progress than Bus A, so the A–B headway erodes steadily while every bus stays on the road and in service.',
      whyAmplifies:
        'As A–B narrows, B collects fewer passengers and gains even more time, while the gap behind B widens and slows C. By the time the two buses are visibly together the corridor has already lost its regularity — reacting to proximity is reacting too late.',
      whatAiDoes:
        'The closing rate is measured and projected forward, so the bunch is identified several iterations before it forms. A pacing advisory and a small micro-hold are issued early, the trailing C–D headway is re-checked each cycle, and intervention is withdrawn as soon as the closing trend disappears.',
    },
  },

  {
    id: 'late-departure',
    number: '04',
    name: 'Late Terminal Departure',
    cause: 'Lead bus departs the terminal late while the rest keep to timetable.',
    title: 'Late Departure → Schedule-Induced Bunching',
    description:
      'Bus A leaves the terminal seven minutes late. Individual timetable adherence by the following buses converts that single delay into a three-minute headway.',
    iterations: 6,
    initialHeadways: [3, 10, 10],
    disturbance: [NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE],
    controllable: LEAD_UNCONTROLLABLE,
    incident: {
      kind: 'terminal',
      mapLabel: 'Terminal departure control point',
      anchorBus: null,
      anchorStopIndex: 0,
      activeUntilIteration: 0,
    },
    occupancyBase: null,
    terminalSchedule: { A: '10:00', B: '10:10', C: '10:20', D: '10:30' },
    figures: [
      { label: 'Bus A departure', expected: '10:00', observed: '10:07' },
      { label: 'Bus B departure under timetable priority', expected: '10:10', observed: '10:10' },
      { label: 'Resulting A–B headway', expected: '10.0 min', observed: '3.0 min' },
    ],
    narrative: {
      whatHappened:
        'Bus A is released seven minutes behind its scheduled 10:00 departure. Under strict timetable adherence Bus B still leaves at 10:10, so the corridor begins the day with a three-minute headway instead of ten — a bunch created at the terminal, before either bus has carried a passenger.',
      whyAmplifies:
        'Individual schedule adherence can reduce corridor regularity. Every following bus is punctual against its own timetable, yet the spacing between services is wrong, and the usual dwell-time feedback then compresses A–B further while the gap behind B grows.',
      whatAiDoes:
        'The controller temporarily switches from schedule priority to headway recovery mode and recomputes the terminal release times as a set, so the corridor leaves the terminal correctly spaced rather than individually punctual.',
    },
  },

  {
    id: 'temporary-stoppage',
    number: '05',
    name: 'Temporary Bus Stoppage',
    cause: 'Lead bus becomes unexpectedly stationary for several minutes.',
    title: 'Unexpected Stoppage → Corridor Disturbance',
    description:
      'Bus A becomes stationary for several minutes for reasons outside the schedule. Even after A resumes, the bunch it created does not disappear on its own.',
    iterations: 6,
    initialHeadways: [6, 10, 10],
    // Three minutes lost standing still, then one more while A gets going again.
    // The disturbance is over by iteration 2 — everything after that is the
    // corridor failing to recover on its own.
    disturbance: [
      delta({ A: 3 }),
      delta({ A: 1 }),
      NO_DISTURBANCE,
      NO_DISTURBANCE,
      NO_DISTURBANCE,
      NO_DISTURBANCE,
    ],
    controllable: LEAD_UNCONTROLLABLE,
    incident: {
      kind: 'stationary',
      mapLabel: 'Abnormal stationary event — Bus A',
      anchorBus: 'A',
      anchorStopIndex: null,
      activeUntilIteration: 1,
    },
    occupancyBase: null,
    terminalSchedule: null,
    figures: [
      { label: 'Stationary duration', observed: '6 min across 2 cycles' },
      { label: 'Classification', observed: 'Temporary disruption' },
      { label: 'Escalation threshold', observed: '2 consecutive cycles' },
    ],
    narrative: {
      whatHappened:
        'Bus A stops moving mid-corridor and stays stationary for two control cycles. Bus B continues normally and closes rapidly, while the gap behind B widens. A then resumes service and the original cause disappears.',
      whyAmplifies:
        'Removing the cause does not restore the service. Once the buses are close together the dwell-time feedback keeps them together — A collects the passengers, B finds empty stops — so the residual bunch persists long after the stationary event has cleared.',
      whatAiDoes:
        'The anomaly is detected and classified as temporary, B is regulated while protecting the B–C headway, and the interventions are gradually withdrawn once A resumes. Had A stayed stationary beyond the escalation threshold, incident recovery mode would recommend treating B as the effective lead bus and consider spare-bus insertion — as a recommendation only.',
    },
  },

  {
    id: 'multi-bus-bunch',
    number: '06',
    name: 'Multi-Bus Bunch',
    cause: 'Three buses have already clustered, leaving one very large gap.',
    title: 'Severe Cluster → Network-Level Recovery',
    description:
      'Buses A, B and C are running as a single cluster with a twenty-four-minute gap before Bus D. Recovery requires redistributing that gap across the whole chain.',
    iterations: 6,
    initialHeadways: [2, 2, 24],
    disturbance: [NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE, NO_DISTURBANCE],
    controllable: ALL_CONTROLLABLE,
    incident: {
      kind: 'cluster',
      mapLabel: 'A–B–C cluster · service gap ahead of D',
      anchorBus: 'C',
      anchorStopIndex: null,
      activeUntilIteration: 5,
    },
    occupancyBase: { A: 88, B: 34, C: 22, D: 96 },
    terminalSchedule: null,
    figures: [
      { label: 'Cluster size', observed: '3 services within 4 min' },
      { label: 'Service gap', observed: '24.0 min' },
      { label: 'Effective frequency in cluster', observed: 'Approximately one service' },
    ],
    narrative: {
      whatHappened:
        'Three of the four services are running within a few minutes of each other, so they behave as a single bus with three times the capacity, and a twenty-four-minute service desert sits behind them. Bus D arrives into that gap already full.',
      whyAmplifies:
        'Adding buses to a cluster does not improve effective frequency — passengers experience the interval between clusters, not between buses. The bus at the front of a cluster collects everybody and keeps losing time, and the buses behind it keep finding empty stops.',
      whatAiDoes:
        'The controller redistributes the single large gap across the whole chain instead of repairing one headway at a time: staged holds on the clustered services, a pacing advisory for the trailing bus, and a recomputation of the entire corridor after every step, spread across several iterations because each cycle is capped.',
    },
  },
];

export const DEFAULT_SCENARIO_ID: ScenarioId = 'traffic-shock';

export function getScenario(id: ScenarioId): ScenarioDefinition {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown bunching scenario: ${id}`);
  return scenario;
}

/** Exogenous disturbance for an iteration; zero once the scenario's list ends. */
export function disturbanceAt(scenario: ScenarioDefinition, iteration: number): BusDeltas {
  return scenario.disturbance[iteration] ?? NO_DISTURBANCE;
}

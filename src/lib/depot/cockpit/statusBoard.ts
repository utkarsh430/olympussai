import type { DepotBusView } from '@/lib/depot/api';
import { formatCount } from '@/lib/depot/format';
import type { BusLocation, Yard } from '@/lib/depot/infer/types';
import { YARD_RULE_SENTENCE } from '@/lib/depot/infer/yardRuleText';
import { BUS_LOCATION_LABEL, BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusOpState, DepotSummary, Figure, StateMix } from '@/lib/depot/types';
import type { StatusBoard, YardStatus } from './cockpitTypes';

/** The status board: five operational states, and where the standing buses are. */

const STATE_KEYS: readonly (readonly [BusOpState, keyof StateMix])[] = [
  ['in_service', 'inService'],
  ['on_road', 'onRoad'],
  ['standing', 'standing'],
  ['dark', 'dark'],
  ['off_road', 'offRoad'],
];
const LOCATIONS: readonly BusLocation[] = ['in_yard', 'at_other_yard', 'away', 'unknown'];

// The rule is worded once, beside the inference's constants.
const NO_YARD_SENTENCE =
  'No yard is established for this depot, so standing buses cannot be placed in it. ' +
  YARD_RULE_SENTENCE;

export function describeYard(yard: Figure<Yard | null>): YardStatus {
  if (yard.value === null) return { established: false, sentence: NO_YARD_SENTENCE };
  const sample = { n: yard.value.inCluster, of: yard.value.parked };
  const sentence = `Yard learned from ${formatCount(sample.n)} of ${formatCount(sample.of)} parked buses.`;
  return { established: true, sample, sentence };
}

export function buildBoard(
  depot: DepotSummary,
  buses: readonly DepotBusView[],
  yard: YardStatus,
): StatusBoard {
  const states = STATE_KEYS.map(([state, key]) => ({
    state,
    label: BUS_STATE_LABEL[state],
    count: depot.states[key],
    share: depot.fleet > 0 ? depot.states[key] / depot.fleet : null,
  }));
  const standing = buses.filter((bus) => bus.state === 'standing');
  const locations = yard.established
    ? LOCATIONS.map((location) => ({
        location,
        label: BUS_LOCATION_LABEL[location],
        count: standing.filter((bus) => bus.location === location).length,
      }))
    : null;
  return { fleet: depot.fleet, states, standing: standing.length, locations, yard };
}

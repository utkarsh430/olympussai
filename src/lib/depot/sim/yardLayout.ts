import { SeededRandom } from '../../simulation/seededRandom';
import type { Lane } from '../duties/types';
import type { DepotSummary } from '../types';
import { STATIC_SEED_DATE } from './config';
import { seedFor } from './seed';

const MIN_LANE_DEPTH = 6;
const MAX_LANE_DEPTH = 10;

/**
 * A modelled yard: lanes of 6 to 10 buses, ids L01, L02, ..., whose depths sum
 * to exactly `parkingCapacity` (the last lane is shortened to make it exact).
 * The depot survey that would give the real layout is not in the feed. Depths
 * are seeded by depot id only, so a yard keeps its shape from day to day and a
 * larger capacity only extends the lane list. Zero capacity gives no lanes.
 */
export function modelYardLayout(depot: DepotSummary, parkingCapacity: number): Lane[] {
  if (!Number.isInteger(parkingCapacity) || parkingCapacity < 0) {
    throw new RangeError(`parkingCapacity must be a non-negative integer, got ${parkingCapacity}`);
  }
  const rng = new SeededRandom(seedFor(depot.id, STATIC_SEED_DATE, 'yard-layout'));
  const lanes: Lane[] = [];
  let remaining = parkingCapacity;
  while (remaining > 0) {
    const depth = Math.min(rng.int(MIN_LANE_DEPTH, MAX_LANE_DEPTH), remaining);
    lanes.push({ id: `L${String(lanes.length + 1).padStart(2, '0')}`, depth });
    remaining -= depth;
  }
  return lanes;
}

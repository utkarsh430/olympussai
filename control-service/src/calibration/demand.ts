// Passenger arrival rate per stop - lambda - and why it is the number this
// system is currently most wrong about.
//
// ─── WHAT LAMBDA DECIDES ─────────────────────────────────────────────────
//
// `mpc/objective.ts` ranks every candidate hold on
//
//   J = w_h x lambda x h^2 / 2   +   w_v x L x d   +   w_c x d
//
// The first term is passengers WAITING at the stop, the second is passengers
// RIDING the bus being held. Lambda sets the exchange rate between them.
// Get it too low and the onboard term dominates, producing a controller that
// always prefers to hold the emptiest bus regardless of the gap it is
// fixing; too high and it will hold a crush-loaded bus to spare one person at
// a stop. Neither failure announces itself - both produce a controller that
// runs, proposes plausible holds, and optimises the wrong thing.
//
// Today `arrivalRatePaxPerSecond` proxies lambda as 1/H*: exactly one
// passenger accumulates per planned headway, at every stop on the network,
// at every hour. That is a placeholder, not an estimate. It is harmless only
// because occupancy is unpopulated fleet-wide, so the onboard term is
// currently zero and lambda cancels out of the ranking. THE MOMENT
// OCCUPANCY IS ENABLED ON A CORRIDOR, LAMBDA MUST BE REAL, or the two terms
// are being traded at a made-up rate.
//
// ─── WHY THIS MODULE CANNOT FIT ANYTHING YET ─────────────────────────────
//
//   lambda_s = boardings_at_s / observed_headway_at_s
//
// The denominator arrives with `stop_visits`, filling now from the GPS feed.
// The numerator needs boardings per stop, which nothing in this system
// observes: `vehicle_states.occupancy_count` is null fleet-wide and no
// ingestion path writes it. Ticketing data supplies it - a ticket's boarding
// stop IS a boarding - and until then this module fits nothing and says so.
//
// It exists now, rather than later, so the shape the fit will take is fixed
// while the surrounding code is being written: consumers already ask for a
// `DemandModel | null` and already handle the null, so connecting the data
// is a matter of populating one table rather than threading a new concept
// through the controller.
import type { StopVisitRecord } from '../headway/stopHeadway.js';

/**
 * Boardings observed at one stop during one vehicle's visit.
 *
 * The shape ticketing data will be reduced to: count the tickets sold with
 * this boarding stop on this trip. Nothing produces these yet.
 */
export interface BoardingObservation {
  stopId: string;
  routeDirectionId: string;
  vehicleId: string;
  /** Must match the corresponding `stop_visits.departed_at`, so the boarding pairs with the headway that fed it. */
  departedAt: string;
  boardings: number;
}

export interface DemandModel {
  stopId: string;
  routeDirectionId: string;
  /** Time-of-day band, or null when pooled across the day. */
  hourBand: number | null;
  /** lambda: passengers arriving per SECOND at this stop. The unit `mpc/objective.ts` expects. */
  arrivalRatePaxPerSecond: number;
  /** Mean boardings per bus, kept because it is the number an operator recognises. */
  meanBoardingsPerVisit: number;
  sampleCount: number;
}

/**
 * Fits lambda per stop from boardings paired with the headway that preceded
 * them.
 *
 * Rate, not average: dividing mean boardings by mean headway would conflate
 * a quiet stop that buses reach often with a busy one they reach rarely.
 * Each visit contributes its own boardings-per-second, and the estimate is
 * the total boardings over the total elapsed headway - which is the
 * maximum-likelihood rate for a Poisson arrival process and weights each
 * visit by how long it actually accumulated for.
 *
 * Returns an EMPTY array when no boardings are supplied, which is the state
 * today. Callers must treat that as "lambda unknown" and fall back to the
 * documented proxy, never to zero: a zero arrival rate tells the objective
 * that nobody is waiting anywhere, which would suppress every hold.
 */
export function fitDemandModel(
  visits: readonly StopVisitRecord[],
  boardings: readonly BoardingObservation[],
  bandByHour: (hour: number) => number | null = () => null,
  minSamples = 10,
): DemandModel[] {
  if (boardings.length === 0) return [];

  const boardingsByVisit = new Map<string, number>();
  for (const observation of boardings) {
    const key = `${observation.vehicleId} ${observation.stopId} ${observation.departedAt}`;
    boardingsByVisit.set(key, observation.boardings);
  }

  const byStop = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    const key = `${visit.routeDirectionId} ${visit.stopId}`;
    const bucket = byStop.get(key) ?? [];
    bucket.push(visit);
    byStop.set(key, bucket);
  }

  const buckets = new Map<
    string,
    { stopId: string; routeDirectionId: string; band: number | null; boardings: number; headwaySeconds: number; visits: number }
  >();

  for (const stopVisits of byStop.values()) {
    const sorted = [...stopVisits].sort(
      (a, b) => new Date(a.departedAt).getTime() - new Date(b.departedAt).getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      const headwaySeconds =
        (new Date(current.departedAt).getTime() - new Date(previous.departedAt).getTime()) / 1000;
      if (!Number.isFinite(headwaySeconds) || headwaySeconds <= 0) continue;

      const boarded = boardingsByVisit.get(
        `${current.vehicleId} ${current.stopId} ${current.departedAt}`,
      );
      // A visit with no matching ticket record is UNOBSERVED, not empty.
      // Counting it as zero boardings would drag lambda toward zero in
      // exact proportion to how patchy the ticketing feed is.
      if (boarded === undefined) continue;

      const band = bandByHour(new Date(current.departedAt).getUTCHours());
      const key = `${current.routeDirectionId} ${current.stopId} ${band ?? 'all'}`;
      const bucket =
        buckets.get(key) ??
        {
          stopId: current.stopId,
          routeDirectionId: current.routeDirectionId,
          band,
          boardings: 0,
          headwaySeconds: 0,
          visits: 0,
        };
      bucket.boardings += boarded;
      bucket.headwaySeconds += headwaySeconds;
      bucket.visits += 1;
      buckets.set(key, bucket);
    }
  }

  const models: DemandModel[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.visits < minSamples || bucket.headwaySeconds <= 0) continue;
    models.push({
      stopId: bucket.stopId,
      routeDirectionId: bucket.routeDirectionId,
      hourBand: bucket.band,
      arrivalRatePaxPerSecond: bucket.boardings / bucket.headwaySeconds,
      meanBoardingsPerVisit: bucket.boardings / bucket.visits,
      sampleCount: bucket.visits,
    });
  }

  return models.sort((a, b) => a.stopId.localeCompare(b.stopId));
}

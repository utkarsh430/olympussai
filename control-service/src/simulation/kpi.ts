// Passenger/operational KPI computation (blueprint 11.1 "Passenger
// accounting" row: wait time, onboard delay proxy via headway CV, denied
// boarding, stranded passengers, load balance). Kept as pure functions
// over plain data so both the engine (`engine.ts`) and an independent
// reference calculation (`replay.ts`, for the historical-reproduction
// test) can call the same math without sharing mutable state.
//
// EWT, CV and mean headway are NOT computed here: they come from
// `lib/dispersion.ts`, the same function `headway/metrics.ts` reduces the
// live network's headways with. See that module's header for why a second
// copy of the formula was a bug and not a duplication.
import { computeDispersion } from '../lib/dispersion.js';
import { rollUpHoldSeconds } from './commandLifecycle.js';
import type { KpiSummary, StopVisitRecord } from './types.js';

/**
 * Headway samples: for each control-point stop, the gap between consecutive
 * vehicles' ARRIVALS at that stop, sorted by arrival time.
 *
 * Sorted, not taken in dispatch order. This used to say the simulator's
 * no-overtake assumption guaranteed the two were the same; it does not. The
 * arrival clamp in `engine.ts` enforces a minimum SEPARATION between arrivals,
 * not an ORDER, so a bus whose leader is standing through a long dwell or a
 * hold passes it and keeps the lead. The code below was already sorting and
 * was therefore right; the comment was the one a reader would have trusted.
 */
export function computeHeadwaySamples(
  visits: StopVisitRecord[],
  controlPointStopIds: Set<string>,
): number[] {
  const byStop = new Map<string, StopVisitRecord[]>();
  for (const v of visits) {
    if (!controlPointStopIds.has(v.stopId)) continue;
    const bucket = byStop.get(v.stopId) ?? [];
    bucket.push(v);
    byStop.set(v.stopId, bucket);
  }
  const samples: number[] = [];
  for (const bucket of byStop.values()) {
    const sorted = [...bucket].sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      samples.push(cur.arrivalSeconds - prev.arrivalSeconds);
    }
  }
  return samples;
}

export function summarizeKpis(
  visits: StopVisitRecord[],
  controlPointStopIds: Set<string>,
  targetHeadwaySeconds: number,
  bunchedThresholdRatio: number,
): KpiSummary {
  const headwaySamples = computeHeadwaySamples(visits, controlPointStopIds);
  const dispersion = computeDispersion(headwaySamples, targetHeadwaySeconds);
  const { meanHeadwaySeconds, cv: headwayCv, ewtSeconds } = dispersion;

  const bunchThreshold = bunchedThresholdRatio * targetHeadwaySeconds;
  const bunchingIncidents = headwaySamples.filter((h) => h < bunchThreshold).length;
  // The SHARE, not the count. A raw count rises with the number of samples,
  // so it cannot be compared between two runs with different vehicle counts,
  // corridor lengths or simulated windows - which is exactly what a parameter
  // sweep does. `algo_new.md` section 8.2 names the rate for this reason.
  const bunchingRate = headwaySamples.length > 0 ? bunchingIncidents / headwaySamples.length : 0;

  // LEGACY, kept only so existing readers (the rehearsal UI's comparison
  // panel, `replay.ts`'s tolerance keys) do not change meaning underneath
  // them in the same commit that fixes the metric. It is a first-moment
  // proxy summed over samples, so its UNITS differ from `ewtSeconds` - it is
  // passenger-seconds-ish across a whole run, not seconds per passenger.
  // Report `ewtSeconds`. See lib/dispersion.ts.
  const scheduledAvgWait = targetHeadwaySeconds / 2;
  const excessWaitSeconds = headwaySamples.reduce(
    (acc, h) => acc + Math.max(0, h / 2 - scheduledAvgWait),
    0,
  );

  const deniedBoardings = visits.reduce((acc, v) => acc + v.deniedBoardings, 0);
  const firstTimeDeniedBoardings = visits.reduce((acc, v) => acc + v.firstTimeDeniedBoardings, 0);
  // People an alighting-only instruction left standing. A refusal by
  // construction, and a different FACT from a full bus - see
  // `StopVisitRecord.boardingLimitedPassengers` - which is why it is added to
  // the stranded count below and never to the capacity-saturation share.
  const boardingLimitedPassengers = visits.reduce((acc, v) => acc + v.boardingLimitedPassengers, 0);
  const totalBoardings = visits.reduce((acc, v) => acc + v.boardings, 0);

  const onTimeSamples = headwaySamples.filter(
    (h) => Math.abs(h - targetHeadwaySeconds) <= bunchThreshold,
  ).length;
  const onTimeDispatchRate = headwaySamples.length > 0 ? onTimeSamples / headwaySamples.length : 1;

  // Every second a passenger spent, counted once - see
  // `KpiSummary.totalPassengerSeconds`. Riding needs a vehicle's visits in
  // stop order, so the timelines are assembled here rather than re-scanned.
  let passengerSeconds = 0;
  const byVehicle = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    passengerSeconds +=
      visit.boardingWaitPassengerSeconds + visit.dwellPassengerSeconds + visit.onboardDelayPassengerSeconds;
    const bucket = byVehicle.get(visit.vehicleId) ?? [];
    bucket.push(visit);
    byVehicle.set(visit.vehicleId, bucket);
  }
  for (const timeline of byVehicle.values()) {
    timeline.sort((a, b) => a.stopIndex - b.stopIndex);
    for (let index = 0; index < timeline.length - 1; index++) {
      const from = timeline[index]!;
      const to = timeline[index + 1]!;
      passengerSeconds += Math.max(0, to.arrivalSeconds - from.departureSeconds) * from.onboardAfter;
    }
  }

  // ─── TWO COMPLIANCE NUMBERS, BECAUSE ONE OF THEM FLATTERS ──────────────
  //
  // `complianceRate` counts INSTRUCTIONS a driver took. `holdSecondsServedRate`
  // counts the SECONDS they actually stood for. `partial_compliance` pulls
  // them apart by construction - its four driver tiers accept 65% of
  // instructions and serve 42% of the hold seconds - and reporting only the
  // first describes a corridor as half again as obedient as it is.
  //
  // `complianceRate` keeps its exact former meaning so a reader comparing to
  // an old run can tell what changed: the second figure is new, the first is
  // not redefined.
  //
  // The POOL is instructions that reached a driver. `deliveredHoldSeconds` is
  // undefined on a run with no command path modelled, and falls back to the
  // intent there - which is what makes this identical to the old
  // `intendedHoldSeconds > 0` pool on every such run. With a command path in
  // the loop the two differ, and using the intent would report the control
  // room's own refusals as driver disobedience.
  const rollup = rollUpHoldSeconds(visits);
  const compliancePool = visits.filter((v) => (v.deliveredHoldSeconds ?? v.intendedHoldSeconds) > 0);
  const complianceRate =
    compliancePool.length > 0
      ? compliancePool.filter((v) => v.compliant).length / compliancePool.length
      : null;
  const holdSecondsServedRate =
    rollup.deliveredHoldSeconds > 0 ? rollup.servedHoldSeconds / rollup.deliveredHoldSeconds : null;

  return {
    headwaySampleCount: dispersion.sampleCount,
    meanHeadwaySeconds,
    headwayCv,
    ewtSeconds,
    totalPassengerSeconds: visits.length > 0 ? Math.round(passengerSeconds) : null,
    bunchingIncidents,
    bunchingRate,
    excessWaitSeconds,
    deniedBoardings,
    // ─── DISTINCT PEOPLE, NOT REFUSAL EVENTS ─────────────────────────────
    //
    // This used to be `deniedBoardings`, on the reasoning that "no later trip
    // is modeled to pick them up within the simulated window". That stopped
    // being true when the queue began PERSISTING past a bus that could not
    // take everybody: a refused passenger now stays at the stop, is offered
    // the next bus, and usually boards it. `deniedBoardings` counts each of
    // those refusals, so it became a rate rather than a headcount - three
    // buses passing one stranded passenger reported three stranded
    // passengers - and the comment describing it went on saying the opposite.
    //
    // Includes the people an alighting-only instruction left behind. They are
    // stranded in exactly the sense this field means, and they were in no
    // denial figure anywhere: `deniedBoardings` is fixed before the
    // instruction zeroes the boardings, so such a visit reported zero denied
    // and zero stranded while a dozen people watched a bus leave.
    strandedPassengers: firstTimeDeniedBoardings + boardingLimitedPassengers,
    onTimeDispatchRate,
    complianceRate,
    holdSecondsServedRate,
    intendedHoldSeconds: rollup.intendedHoldSeconds,
    deliveredHoldSeconds: rollup.deliveredHoldSeconds,
    servedHoldSeconds: rollup.servedHoldSeconds,
    totalBoardings,
  };
}

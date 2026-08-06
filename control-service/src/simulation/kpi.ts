// Passenger/operational KPI computation (blueprint 11.1 "Passenger
// accounting" row: wait time, onboard delay proxy via headway CV, denied
// boarding, stranded passengers, load balance). Kept as pure functions
// over plain data so both the engine (`engine.ts`) and an independent
// reference calculation (`replay.ts`, for the historical-reproduction
// test) can call the same math without sharing mutable state.
import type { KpiSummary, StopVisitRecord } from './types.js';

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], m: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Headway samples: for each control-point stop, the gap between
 * consecutive vehicles' arrivals at that stop, in dispatch order (the
 * simulator's no-overtake assumption guarantees dispatch order == arrival
 * order at every stop, so consecutive-in-list is consecutive-in-time).
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
  const meanHeadwaySeconds = mean(headwaySamples);
  const headwayCv =
    meanHeadwaySeconds && meanHeadwaySeconds > 0
      ? stddev(headwaySamples, meanHeadwaySeconds) / meanHeadwaySeconds
      : null;
  const bunchThreshold = bunchedThresholdRatio * targetHeadwaySeconds;
  const bunchingIncidents = headwaySamples.filter((h) => h < bunchThreshold).length;

  // Excess wait: uniform-arrivals approximation, avg wait = headway / 2.
  // Excess = actual avg wait - scheduled avg wait, summed over samples
  // (a standard EWT proxy given only headway data, blueprint 11.1
  // "Passenger accounting").
  const scheduledAvgWait = targetHeadwaySeconds / 2;
  const excessWaitSeconds = headwaySamples.reduce(
    (acc, h) => acc + Math.max(0, h / 2 - scheduledAvgWait),
    0,
  );

  const deniedBoardings = visits.reduce((acc, v) => acc + v.deniedBoardings, 0);
  const totalBoardings = visits.reduce((acc, v) => acc + v.boardings, 0);

  const onTimeSamples = headwaySamples.filter(
    (h) => Math.abs(h - targetHeadwaySeconds) <= bunchThreshold,
  ).length;
  const onTimeDispatchRate = headwaySamples.length > 0 ? onTimeSamples / headwaySamples.length : 1;

  const compliancePool = visits.filter((v) => v.intendedHoldSeconds > 0);
  const complianceRate =
    compliancePool.length > 0
      ? compliancePool.filter((v) => v.compliant).length / compliancePool.length
      : null;

  return {
    meanHeadwaySeconds,
    headwayCv,
    bunchingIncidents,
    excessWaitSeconds,
    deniedBoardings,
    // Stranded passengers: this engine models per-visit denied boarding
    // as the stranded count at simulation end (no later trip is modeled
    // to pick them up within the simulated window).
    strandedPassengers: deniedBoardings,
    onTimeDispatchRate,
    complianceRate,
    totalBoardings,
  };
}

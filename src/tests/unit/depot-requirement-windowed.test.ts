// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { dutyPlanFor } from '@/lib/depot/live/operatingDayView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { modelBalances } from '@/lib/depot/sim/requirement';

/*
 * Ruling S63: the requirement reads each depot's on-road share over the rolling
 * score window, and the peer median of those, not the single snapshot's. Pages
 * loaded a minute apart then rest on (nearly) the same modelled day.
 */

const DATE = '2026-10-07';
const HOME = { lat: 26.85, lng: 80.95 };
const SNAPSHOTS = 16;
/** Snapshots compared once the window holds several samples. */
const SETTLED_FROM = 6;

function row(feedNow: string, depotId: string, reg: string, out: boolean, i: number): DepotBusRow {
  const p = fromMetres({ x: out ? 8_000 + i * 50 : 0, y: Number(depotId) * 30_000 }, HOME.lat, HOME.lng);
  return {
    registrationNumber: reg,
    latitude: p.lat,
    longitude: p.lng,
    speedKmph: out ? 30 : 0,
    ignitionOn: out,
    gpsTimestamp: feedNow,
    receivedAt: feedNow,
    depotId,
    depotName: `Depot ${depotId}`,
    vehicleStatus: out ? 'live' : 'stationary',
    tripStatus: out ? 'Running' : 'Stationary',
    routeId: null,
    routeName: `ORD_${depotId}_${i % 3}`,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: 'C',
    emergency: false,
  };
}

function depot(feedNow: string, id: string, fleet: number, out: number): DepotBusRow[] {
  return Array.from({ length: fleet }, (_, i) => row(feedNow, id, `D${id}B${i}`, i < out, i));
}

/** Minute `k` of a feed in which depot 1's buses out swing between 60 and 30 of 72. */
function snapshot(k: number): FleetSnapshotView {
  const feedNow = `${DATE}T10:${String(k).padStart(2, '0')}:00Z`;
  const rows = [
    ...depot(feedNow, '1', 72, k % 2 === 0 ? 60 : 30),
    ...depot(feedNow, '2', 40, 30),
    ...depot(feedNow, '3', 40, 25),
  ];
  return { rows, feedNow, fetchedAt: feedNow, source: 'live', stale: false, recordCount: rows.length };
}

/** The single-snapshot rule, as it stood before S63. */
function snapshotPeak(view: FleetSnapshotView): number {
  const analysis = analyseSnapshot(view);
  const balances = modelBalances(analysis.depots, analysis.yards, DATE, DEFAULT_REQUIREMENT_PARAMS);
  return balances.find((b) => b.depotId === '1')?.peakRequirement ?? NaN;
}

function series(): { readonly windowed: number[]; readonly instant: number[] } {
  const windowed: number[] = [];
  const instant: number[] = [];
  for (let k = 0; k < SNAPSHOTS; k += 1) {
    const view = snapshot(k);
    windowed.push(dutyPlanFor(analyseSnapshot(view), '1', DATE)?.peakRequirement ?? NaN);
    instant.push(snapshotPeak(view));
  }
  return { windowed, instant };
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

beforeEach(() => resetAnalysisForTests());

describe('the requirement over the rolling score window (S63)', () => {
  it('moves far less over consecutive snapshots than the single-snapshot rule', () => {
    const { windowed, instant } = series();
    const settled = (values: readonly number[]): readonly number[] => values.slice(SETTLED_FROM);
    expect(spread(settled(instant))).toBeGreaterThanOrEqual(8);
    expect(spread(settled(windowed))).toBeLessThanOrEqual(2);
    expect(spread(settled(windowed)) * 4).toBeLessThanOrEqual(spread(settled(instant)));
  });

  it('with one sample in the window equals the single-snapshot rule exactly', () => {
    for (const k of [0, 1]) {
      resetAnalysisForTests();
      const view = snapshot(k);
      const balances = buildDistributionResponse(view).balances;
      const old = modelBalances(
        analyseSnapshot(view).depots,
        analyseSnapshot(view).yards,
        DATE,
        DEFAULT_REQUIREMENT_PARAMS,
      );
      expect(balances).toEqual(old);
      expect(dutyPlanFor(analyseSnapshot(view), '1', DATE)?.peakRequirement).toBe(
        old.find((b) => b.depotId === '1')?.peakRequirement,
      );
    }
  });

  it('gives the fleet distribution and the operating day the same requirement', () => {
    for (let k = 0; k < SNAPSHOTS; k += 1) {
      const view = snapshot(k);
      const analysis = analyseSnapshot(view);
      for (const balance of buildDistributionResponse(view).balances) {
        expect(dutyPlanFor(analysis, balance.depotId, DATE)?.peakRequirement).toBe(
          balance.peakRequirement,
        );
      }
    }
  });

  it('is the same series when the same snapshots are replayed', () => {
    const first = series();
    resetAnalysisForTests();
    expect(series()).toEqual(first);
  });
});

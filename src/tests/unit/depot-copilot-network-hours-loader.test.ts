// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { copilotNetworkHours } from '@/lib/depot/live/copilotNetworkHours';
import { buildNetworkHourlyResponse } from '@/lib/depot/live/networkHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import { createServiceHoldStore } from '@/lib/depot/live/serviceHold';
import { SERVICE_BANDS } from '@/lib/depot/service/networkHours';
import type { CopilotNetworkHours } from '@/lib/depot/service/types';

/*
 * The copilot reads the network's day from the same held day the Service page's API
 * answers: the bands in order with every short and over route, each route's own proposals
 * once, the reallocation's moves summed. Checked on the recorded sample.
 */

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const FEED_NOW = '2026-10-06T15:38:00.000Z';

const view: FleetSnapshotView = {
  rows, feedNow: FEED_NOW, fetchedAt: '2026-10-06T10:08:05.000Z', source: 'live', stale: false,
  recordCount: rows.length,
};

function services(): ServiceRepositories {
  return {
    hourly: createMemoryHourlyObservationRepository(createServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
}

const NETWORK_KINDS = ['reserve_by_hour', 'maintenance_window', 'shift_departures', 'corridor_over_served', 'corridor_under_served'];

let hours: CopilotNetworkHours;

beforeEach(async () => {
  resetAnalysisForTests();
  hours = await copilotNetworkHours(view, services());
});

describe("the copilot's network hours", () => {
  it('carry the five bands in order, each route sorted by its gap, with the totals summed from them', () => {
    expect(hours.bands.map((b) => b.key)).toEqual(SERVICE_BANDS.map((b) => b.key));
    for (const band of hours.bands) {
      const shorts = band.shortRoutes.map((r) => r.gap);
      expect(shorts.every((g) => g > 0)).toBe(true);
      expect([...shorts].sort((a, b) => b - a)).toEqual(shorts);
      const overs = band.overRoutes.map((r) => r.gap);
      expect(overs.every((g) => g < 0)).toBe(true);
      expect([...overs].sort((a, b) => a - b)).toEqual(overs);
      const sum = (gs: readonly number[]): number => Math.round(gs.reduce((s, g) => s + Math.abs(g), 0) * 10) / 10;
      expect(band.busesShort).toBe(sum(shorts));
      expect(band.busesOver).toBe(sum(overs));
    }
    const evening = hours.bands.find((b) => b.key === 'evening_peak');
    expect(evening?.band).toEqual({ fromHour: 16, toHour: 19 });
    expect(evening?.shortRoutes.length).toBeGreaterThan(0);
  });

  it('name each route proposal once, none of the network kinds, by modelled passengers', () => {
    const ids = hours.proposals.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(hours.proposals.some((p) => NETWORK_KINDS.includes(p.kind))).toBe(false);
    expect(hours.proposals.every((p) => typeof p.routeName === 'string' && p.routeName.length > 0)).toBe(true);
    const passengers = hours.proposals.map((p) => p.impact?.passengersPerDay.high ?? 0);
    expect([...passengers].sort((a, b) => b - a)).toEqual(passengers);
  });

  it("read the same day the page answers: its date, hour, observation and the bands' moves", async () => {
    const result = await buildNetworkHourlyResponse(view, { band: null, depotId: null, page: 0 }, services());
    if (result.status !== 200) throw new Error('expected 200');
    expect(hours.operatingDate).toBe(result.body.operatingDate);
    expect(hours.currentHour).toBe(result.body.currentHour);
    expect(hours.observed).toEqual(result.body.observed);
    expect(hours.moves.withinDepots).toBeGreaterThanOrEqual(result.body.reallocation.busesWithin);
    expect(hours.moves.betweenDepots).toBeGreaterThanOrEqual(result.body.reallocation.busesBetween);
    expect(hours.decisions).toBeNull();
  });
});

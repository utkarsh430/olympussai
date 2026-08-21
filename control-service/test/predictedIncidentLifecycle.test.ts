/**
 * The two detection tiers sharing one incident row.
 *
 * The reactive rule reports a gap that has already collapsed; the predictive
 * one reports a gap closing fast enough to collapse soon. They open, escalate
 * and close ONE incident per pair, because they are describing the same event
 * at different stages of it - an operator watching `predicted` become
 * `warning` become `bunched` is watching a single story, and three unrelated
 * rows about the same two buses would be the same facts made unreadable.
 *
 * The subtle case, and the reason this file exists separately: closing. The
 * reactive rule's `recovered` asks "has a collapsed gap reopened above the
 * warning threshold?" For a predicted incident that question is meaningless -
 * its gap never collapsed, so `recovered` is TRUE from the moment it opens.
 * Wiring the close on it would shut every predicted incident on the very
 * sweep that created it, and the failure would be invisible: prediction would
 * appear to work, write rows, log them, and leave nothing behind to act on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/headway/repository.js', () => ({
  loadRouteDirectionMeta: vi.fn(),
  loadActiveRoutePolicy: vi.fn(),
  loadVehicleStatesForRouteDirection: vi.fn(),
  insertHeadwaySample: vi.fn(),
  findOpenIncidentForPair: vi.fn(),
  loadRecentHeadwayRatios: vi.fn(),
  loadRecentHeadwaySamples: vi.fn(),
  openIncident: vi.fn(),
  escalateIncident: vi.fn(),
  closeIncident: vi.fn(),
  listOpenIncidentPairsForRouteDirection: vi.fn(),
}));

import { computeRouteDirectionHeadway } from '../src/headway/service.js';
import * as repo from '../src/headway/repository.js';
import { _resetEnvCacheForTests } from '../src/config/env.js';

const mocked = vi.mocked(repo);
const NOW = Date.UTC(2026, 7, 20, 9, 0, 0);

/**
 * Two buses 10 km apart at 36 km/h (10 m/s): h_fwd = 1000 s on a 1800 s
 * corridor. Ratio 0.56 - above the 0.5 warning threshold, so the reactive
 * rule is silent about this pair on every sample it is ever given.
 */
function vehicles() {
  return [
    { vehicleId: 'A', distanceAlongRouteMeters: 30_000, speedKmph: 36, confidence: 0.9, isLowConfidence: false },
    { vehicleId: 'B', distanceAlongRouteMeters: 20_000, speedKmph: 36, confidence: 0.9, isLowConfidence: false },
  ];
}

/**
 * A history in which the gap has been closing steadily at 0.5 s/s: 1270 s
 * nine minutes ago, 1000 s now.
 *
 * It reaches the 450 s bunched threshold in (1000 - 450) / 0.5 = 1100 s -
 * inside the 1800 s horizon this corridor's headway derives, and near enough
 * within it to clear the opening bar. A crossing at the far edge of the
 * horizon deliberately does NOT open one; see test/bunchingForecast.test.ts.
 */
function closingSamples() {
  const out: { hFwdSeconds: number; computedAt: string }[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      hFwdSeconds: 1000 + i * 30,
      computedAt: new Date(NOW - i * 60_000).toISOString(),
    });
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadRouteDirectionMeta.mockResolvedValue({
    routeDirectionId: 'rd-1',
    routeId: 'r-1',
    directionCode: 'UP',
    isLoop: false,
    totalDistanceMeters: 100_000,
  });
  mocked.loadActiveRoutePolicy.mockResolvedValue({
    targetHeadwaySeconds: 1800,
    requiredSamples: 3,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
  } as never);
  mocked.insertHeadwaySample.mockResolvedValue({
    id: 'sample-1',
    forecastHFwdSeconds: 450,
    computedAt: new Date(NOW).toISOString(),
  } as never);
  mocked.loadVehicleStatesForRouteDirection.mockResolvedValue(vehicles() as never);
  mocked.findOpenIncidentForPair.mockResolvedValue(null);
  mocked.loadRecentHeadwaySamples.mockResolvedValue(closingSamples());
  // Ratios well above the warning threshold: the reactive rule sees nothing.
  mocked.loadRecentHeadwayRatios.mockResolvedValue([0.56, 0.57, 0.58] as never);
  mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([]);
  mocked.openIncident.mockResolvedValue({ id: 'inc-1', startedAt: new Date(NOW).toISOString() });
});

describe('the predictive tier opening an incident', () => {
  it('opens a `predicted` incident on a pair the reactive rule is silent about', async () => {
    const result = await computeRouteDirectionHeadway('rd-1');

    expect(mocked.openIncident).toHaveBeenCalledTimes(1);
    expect(mocked.openIncident.mock.calls[0]![0]).toMatchObject({ severity: 'predicted' });
    expect(result.incidents[0]).toMatchObject({ action: 'opened', severity: 'predicted' });
    expect(result.incidents[0]!.secondsToBunching).toBeGreaterThan(0);
  });

  // The forecast travels with the incident so the alert surface can say WHY,
  // and so a later review can ask whether the prediction was any good.
  it('records the forecast that justified it as evidence', async () => {
    await computeRouteDirectionHeadway('rd-1');
    const evidence = mocked.openIncident.mock.calls[0]![0].evidence as {
      forecast: { secondsToBunching: number; closingRateSecondsPerSecond: number; reason: string } | null;
    };
    expect(evidence.forecast).not.toBeNull();
    expect(evidence.forecast!.closingRateSecondsPerSecond).toBeLessThan(0);
    expect(evidence.forecast!.reason).toContain('forecast to breach');
  });

  // The column has existed since the core data model and every row ever
  // written carried NULL, because the insert never named it.
  it('persists the projected headway on the sample it was computed from', async () => {
    await computeRouteDirectionHeadway('rd-1');
    const inserted = mocked.insertHeadwaySample.mock.calls[0]![0];
    // 1000s now, closing 0.5 s/s over an 1800s horizon -> 100s projected.
    expect(inserted.forecastHFwdSeconds).toBeCloseTo(100, 0);
  });

  it('opens nothing at all when the gap is steady rather than closing', async () => {
    mocked.loadRecentHeadwaySamples.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        hFwdSeconds: 1000,
        computedAt: new Date(NOW - i * 60_000).toISOString(),
      })),
    );
    const result = await computeRouteDirectionHeadway('rd-1');
    expect(mocked.openIncident).not.toHaveBeenCalled();
    expect(result.incidents).toEqual([]);
  });

  // The tier is opt-OUT. Turning it off must leave the reactive rule exactly
  // as it was, which is why this asserts on `openIncident` rather than on the
  // predictive path alone.
  it('opens nothing when prediction is switched off', async () => {
    vi.stubEnv('BUNCHING_PREDICTION_ENABLED', 'false');
    _resetEnvCacheForTests();
    try {
      await computeRouteDirectionHeadway('rd-1');
      expect(mocked.openIncident).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      _resetEnvCacheForTests();
    }
  });
});

describe('a predicted incident already open', () => {
  beforeEach(() => {
    mocked.findOpenIncidentForPair.mockResolvedValue({ id: 'inc-1', severity: 'predicted' } as never);
  });

  // THE ONE THIS FILE EXISTS FOR. `rule.recovered` is true for this pair -
  // its ratios are all above the warning threshold - and it must not close
  // the incident, because that question was never about this kind of
  // incident.
  it('is NOT closed by the reactive recovery rule, whose question does not apply to it', async () => {
    const result = await computeRouteDirectionHeadway('rd-1');
    expect(mocked.closeIncident).not.toHaveBeenCalled();
    expect(result.incidents).toEqual([]); // action 'none' is not reported
  });

  it('closes once the pair genuinely stops closing', async () => {
    // The gap has been OPENING for the last ten minutes: risk is zero.
    mocked.loadRecentHeadwaySamples.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        hFwdSeconds: 1000 - i * 30,
        computedAt: new Date(NOW - i * 60_000).toISOString(),
      })),
    );
    const result = await computeRouteDirectionHeadway('rd-1');
    expect(mocked.closeIncident).toHaveBeenCalledWith('inc-1', expect.anything());
    expect(result.incidents[0]).toMatchObject({ action: 'closed' });
  });

  // A corridor whose GPS went quiet has not been observed to improve. Closing
  // here would report a recovery that nothing measured.
  it('is left exactly as it is when the forecaster has no opinion', async () => {
    mocked.loadRecentHeadwaySamples.mockResolvedValue([] as never);
    await computeRouteDirectionHeadway('rd-1');
    expect(mocked.closeIncident).not.toHaveBeenCalled();
    expect(mocked.escalateIncident).not.toHaveBeenCalled();
  });

  // The prediction came true. One incident, escalated in place - not a second
  // row about the same two buses.
  it('escalates in place when the collapse it predicted actually arrives', async () => {
    mocked.loadRecentHeadwayRatios.mockResolvedValue([0.2, 0.2, 0.2] as never);
    const result = await computeRouteDirectionHeadway('rd-1');
    expect(mocked.openIncident).not.toHaveBeenCalled();
    expect(mocked.escalateIncident).toHaveBeenCalledWith('inc-1', 'bunched', expect.anything());
    expect(result.incidents[0]).toMatchObject({ action: 'escalated', severity: 'bunched' });
  });
});

describe('a reactive incident already open', () => {
  // Severity only ever moves UP. A `bunched` incident whose forecast has since
  // relaxed must not be rewritten as `predicted`: that reports the situation
  // improving on the strength of an extrapolation, while the measured
  // collapse that opened it is still there.
  it('is never de-escalated to `predicted` by a calmer forecast', async () => {
    mocked.findOpenIncidentForPair.mockResolvedValue({ id: 'inc-1', severity: 'bunched' } as never);
    await computeRouteDirectionHeadway('rd-1');
    expect(mocked.escalateIncident).not.toHaveBeenCalled();
  });

  // And its own recovery rule still works exactly as before.
  it('still closes on the reactive recovery rule', async () => {
    mocked.findOpenIncidentForPair.mockResolvedValue({ id: 'inc-1', severity: 'bunched' } as never);
    mocked.loadRecentHeadwayRatios.mockResolvedValue([0.9, 0.95, 1.0] as never);
    mocked.loadRecentHeadwaySamples.mockResolvedValue([] as never);
    const result = await computeRouteDirectionHeadway('rd-1');
    expect(mocked.closeIncident).toHaveBeenCalledWith('inc-1', expect.anything());
    expect(result.incidents[0]).toMatchObject({ action: 'closed' });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { runScenario } from '@/lib/depot/optimise/scenario';
import { BASELINE_FORM, toScenario } from '@/lib/depot/rebalance/scenarioForm';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';

const rows = normalizeDepotRows(liveFixture).rows;

beforeEach(() => resetAnalysisForTests());

describe('baseline equivalence on the server-built balances', () => {
  it('re-plans the balances the server sent into exactly the server plan', () => {
    const response = buildDistributionResponse({
      rows,
      feedNow: deriveFeedNow(rows),
      fetchedAt: '2026-10-06T08:00:05.000Z',
      source: 'live',
      stale: false,
      recordCount: rows.length,
    });
    expect(response.balances.length).toBeGreaterThan(0);
    const outcome = runScenario(response.balances, toScenario(BASELINE_FORM));
    expect(outcome.clamped).toEqual([]);
    expect(outcome.balances).toEqual(response.balances);
    expect(outcome.plan).toEqual(response.plan);
  });
});

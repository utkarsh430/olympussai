// The read side of db/recommendations.ts, against a fake pool.
//
// The module used to have a write side and a dedupe fingerprint and nothing
// else - which was the defect: the decision cycle wrote a row every 90 s and
// the only thing that ever read one back was its own duplicate check. These
// are tests for the reader that gives those rows a consumer.
//
// Three properties, all of which a naive reader gets wrong:
//
//   - A row's AGE is measured on the database clock, not by subtracting
//     timestamps in the consumer. Age is the whole basis on which this feed
//     says how far to trust a row.
//   - Freshness is graded against mpc/safety.ts's own window, imported, so
//     the reader and the safety filter cannot drift apart about what "still
//     inside the window it was graded for" means.
//   - "No standing proposals" and "the controller stopped writing" are
//     different answers and the second must remain answerable when the first
//     is true.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  listStandingRecommendations,
  findNewestRecommendationCreatedAt,
  RECOMMENDATION_FRESH_WITHIN_SECONDS,
} from '../src/db/recommendations.js';
import { DEFAULT_STATE_STALE_SECONDS } from '../src/mpc/safety.js';

function fakePool(rows: unknown[]): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  route_direction_id: 'rd-1',
  route_id: 'route-1',
  route_public_name: '12A',
  direction_code: 'UP',
  direction_name: 'City centre',
  incident_id: null,
  status: 'proposed',
  selected_action_type: 'two_way_hold',
  vehicle_id: 'UP25FT4823',
  hold_seconds: '45',
  candidate_action_count: '2',
  objective_cost: '-1200',
  expected_recovery_seconds: '300',
  controller_version: 'mpc-1',
  pace_advisories: [],
  created_at: '2026-09-06T08:00:00.000Z',
  age_seconds: '40',
  total_within_window: '1',
  ...overrides,
});

describe('RECOMMENDATION_FRESH_WITHIN_SECONDS', () => {
  // Re-exported, never re-stated. A second copy of 90 here is how the feed's
  // claim about a row drifts away from the filter that actually graded it.
  it('is mpc/safety.ts\'s own state-freshness bound', () => {
    expect(RECOMMENDATION_FRESH_WITHIN_SECONDS).toBe(DEFAULT_STATE_STALE_SECONDS);
  });
});

describe('listStandingRecommendations', () => {
  it('maps a row into the summary a console reads', async () => {
    const { pool } = fakePool([dbRow()]);

    const { recommendations, totalWithinWindow } = await listStandingRecommendations(
      { windowSeconds: 900, limit: 50, freshWithinSeconds: 90 },
      pool,
    );

    expect(totalWithinWindow).toBe(1);
    expect(recommendations[0]).toMatchObject({
      id: 'rec-1',
      routeDirectionId: 'rd-1',
      routePublicName: '12A',
      selectedActionType: 'two_way_hold',
      selectedVehicleId: 'UP25FT4823',
      selectedHoldSeconds: 45,
      candidateActionCount: 2,
      objectiveCost: -1200,
      ageSeconds: 40,
      freshness: 'fresh',
    });
  });

  it('asks for one row per corridor, not a history', async () => {
    const { pool, query } = fakePool([]);
    await listStandingRecommendations(
      { windowSeconds: 900, limit: 50, freshWithinSeconds: 90 },
      pool,
    );

    const sql = String(query.mock.calls[0]![0]);
    // The shape matters twice over: it is the question a dispatcher asks
    // ("what does the controller currently say about each corridor"), and it
    // is the shape the existing (route_direction_id, created_at desc) index
    // answers directly, so this read needs no index of its own.
    expect(sql).toContain('distinct on (r.route_direction_id)');
    expect(query.mock.calls[0]![1]).toEqual([900, 50]);
  });

  it('takes the age from the database clock, not from the caller\'s', async () => {
    const { pool, query } = fakePool([]);
    await listStandingRecommendations(
      { windowSeconds: 900, limit: 50, freshWithinSeconds: 90 },
      pool,
    );

    // A browser's clock can be minutes out, and age is the whole basis on
    // which this feed says how much to trust a row. It must not be a quantity
    // two processes can disagree about.
    expect(String(query.mock.calls[0]![0])).toContain('extract(epoch from (now() - r.created_at))');
  });

  it('marks a row past the freshness bar as lapsed, and still returns it', async () => {
    const { pool } = fakePool([dbRow({ age_seconds: '400' })]);

    const { recommendations } = await listStandingRecommendations(
      { windowSeconds: 900, limit: 50, freshWithinSeconds: 90 },
      pool,
    );

    // Returned, not dropped: a proposal from six minutes ago is still the
    // most recent thing the controller said about that corridor, and a
    // console that silently omitted it would leave the corridor looking
    // untouched. It is labelled, not hidden.
    expect(recommendations[0]!.freshness).toBe('lapsed');
  });

  it('reports zero within the window when nothing stands', async () => {
    const { pool } = fakePool([]);
    const { recommendations, totalWithinWindow } = await listStandingRecommendations(
      { windowSeconds: 900, limit: 50, freshWithinSeconds: 90 },
      pool,
    );
    expect(recommendations).toEqual([]);
    expect(totalWithinWindow).toBe(0);
  });

  it('reports the pre-limit total so a truncated page can say so', async () => {
    const { pool } = fakePool([dbRow({ total_within_window: '37' })]);
    const { totalWithinWindow } = await listStandingRecommendations(
      { windowSeconds: 900, limit: 1, freshWithinSeconds: 90 },
      pool,
    );
    expect(totalWithinWindow).toBe(37);
  });
});

describe('findNewestRecommendationCreatedAt', () => {
  it('ignores the window entirely', async () => {
    const { pool, query } = fakePool([{ created_at: '2026-09-06T02:00:00.000Z' }]);
    const latest = await findNewestRecommendationCreatedAt(pool);

    expect(latest).toBe('2026-09-06T02:00:00.000Z');
    // No interval, no route-direction: the question is "has the automatic
    // controller written ANYTHING", which is what an empty feed needs
    // answered before a reader concludes the network is fine.
    expect(String(query.mock.calls[0]![0])).not.toContain('interval');
    expect(query.mock.calls[0]![1]).toBeUndefined();
  });

  it('is null when the cycle has never written a row', async () => {
    const { pool } = fakePool([{ created_at: null }]);
    expect(await findNewestRecommendationCreatedAt(pool)).toBeNull();
  });
});

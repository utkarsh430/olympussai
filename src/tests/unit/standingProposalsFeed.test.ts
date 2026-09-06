// @vitest-environment node
//
// The standing-proposal feed: GET /api/ops/control-room/recommendations/feed
// and the client under it (src/lib/controlService/standingProposals.ts).
//
// ─── WHAT THIS SURFACE IS FOR ────────────────────────────────────────────
//
// control-service's `scheduler/decisionCycle.ts` has solved every eligible
// corridor every 90 seconds since it landed and written a `recommendations`
// row each time. Nothing read that table - the only importer of the write
// module in the whole service was the cycle's own duplicate check, no route
// served it and no console fetched it. Every proposal a dispatcher ever saw
// came from the SYNCHRONOUS solve on the sibling POST route, taken when they
// opened a corridor themselves, which is the exact "somebody has to be looking
// at the right corridor at the right moment" problem the automatic cycle
// exists to remove. Its output was written and discarded.
//
// ─── THE ASSERTIONS THAT MATTER MOST ─────────────────────────────────────
//
//   1. OFF IS A TRUE NO-OP. The route answers 404 without constructing a
//      request, and nothing is read.
//   2. An empty list is not an all-clear, and here it is worse than on the
//      alert inbox: it empties both when the controller proposed nothing and
//      when the controller is not running. `latestCreatedAt` is what tells
//      those apart and it must survive the route.
//   3. Nothing approvable crosses the wire.
//
// Route handlers are exercised directly with their guard and the control
// service transport mocked, like controlRoomAlerts.test.ts. The transport is
// mocked rather than the client module, because the Zod contract in
// standingProposals.ts is one of the things under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ControlServiceConfigError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { rolesForOpsApiPath } from '@/lib/auth/rbac/roles';

const requireOpsRole = vi.fn();
const fetchControlService = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/controlService/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/controlService/client')>();
  return { ...actual, fetchControlService: (...args: unknown[]) => fetchControlService(...args) };
});

const { GET } = await import('@/app/api/ops/control-room/recommendations/feed/route');
const { readStandingProposals, _resetStandingProposalCacheForTests, isStandingProposalFeedEnabled } =
  await import('@/lib/controlService/standingProposals');

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    routeDirectionId: 'rd-1',
    routeId: 'r-1',
    routePublicName: 'Lucknow – Kanpur',
    directionCode: 'UP',
    directionName: 'Towards Kanpur',
    incidentId: null,
    status: 'proposed',
    selectedActionType: 'two_way_hold',
    selectedVehicleId: 'UP25FT4823',
    selectedHoldSeconds: 45,
    candidateActionCount: 2,
    objectiveCost: -1200,
    expectedRecoverySeconds: 300,
    controllerVersion: 'mpc-1',
    paceAdvisories: [],
    createdAt: '2026-09-06T09:00:00.000Z',
    ageSeconds: 40,
    freshness: 'fresh',
    ...overrides,
  };
}

function feed(overrides: Record<string, unknown> = {}) {
  return {
    recommendations: [recommendation()],
    windowSeconds: 900,
    freshWithinSeconds: 90,
    totalWithinWindow: 1,
    latestCreatedAt: '2026-09-06T09:00:00.000Z',
    generatedAt: '2026-09-06T09:00:40.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetStandingProposalCacheForTests();
  requireOpsRole.mockResolvedValue({ ok: true, session: { email: 'cr@example.com' } });
  process.env.RECOMMENDATION_FEED_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.RECOMMENDATION_FEED_ENABLED;
});

describe('RECOMMENDATION_FEED_ENABLED, unset (the shipped default)', () => {
  beforeEach(() => {
    delete process.env.RECOMMENDATION_FEED_ENABLED;
  });

  it('is off', () => {
    expect(isStandingProposalFeedEnabled()).toBe(false);
  });

  // Off must not leave a discoverable endpoint that answers differently from
  // one that does not exist. A 503 "disabled" would be a new observable.
  it('answers 404 and never reaches the control service', async () => {
    const response = await GET();
    expect(response.status).toBe(404);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('refuses the client read before constructing a request', async () => {
    await expect(readStandingProposals()).rejects.toThrow(/not enabled/);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('is off for any value that is not exactly "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      process.env.RECOMMENDATION_FEED_ENABLED = value;
      expect(isStandingProposalFeedEnabled()).toBe(false);
    }
  });
});

describe('GET /api/ops/control-room/recommendations/feed', () => {
  it('returns each corridor\'s standing proposal, with the corridor named', async () => {
    fetchControlService.mockResolvedValue(feed());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recommendations).toHaveLength(1);
    // A reader who has chosen no corridor cannot act on a bare uuid - the same
    // reason the alert feed carries the route name.
    expect(body.recommendations[0].routePublicName).toBe('Lucknow – Kanpur');
    expect(body.recommendations[0].freshness).toBe('fresh');
  });

  // The single most important field on this response. A list of proposals
  // empties both when the controller looked and proposed nothing and when the
  // controller is not running, and those render identically without this.
  it('carries latestCreatedAt through even when the list is empty', async () => {
    fetchControlService.mockResolvedValue(
      feed({
        recommendations: [],
        totalWithinWindow: 0,
        latestCreatedAt: '2026-09-06T03:00:00.000Z',
      }),
    );

    const body = await (await GET()).json();
    expect(body.recommendations).toEqual([]);
    expect(body.latestCreatedAt).toBe('2026-09-06T03:00:00.000Z');
  });

  it('carries a null latestCreatedAt as null, not as absent', async () => {
    fetchControlService.mockResolvedValue(
      feed({ recommendations: [], totalWithinWindow: 0, latestCreatedAt: null }),
    );

    const body = await (await GET()).json();
    expect(body).toHaveProperty('latestCreatedAt', null);
  });

  it('publishes the freshness bar beside the flag it decides', async () => {
    fetchControlService.mockResolvedValue(feed());
    const body = await (await GET()).json();
    // A flag and the number it is drawn on are one expression or they drift.
    expect(body.freshWithinSeconds).toBe(90);
    expect(body.windowSeconds).toBe(900);
  });

  it('reports the pre-limit total so a truncated page can say so', async () => {
    fetchControlService.mockResolvedValue(feed({ totalWithinWindow: 37 }));
    const body = await (await GET()).json();
    expect(body.totalWithinWindow).toBe(37);
  });

  it('never caches, so an operator cannot be served a stale list by a proxy', async () => {
    fetchControlService.mockResolvedValue(feed());
    expect((await GET()).headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses anyone who is not control room', async () => {
    requireOpsRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  // Middleware is the ceiling, the handler is the decision; this asserts the
  // two agree. The segment-derived default already resolves to control_room,
  // so no OPS_API_ROLE_OVERRIDES entry exists or should - which is exactly why
  // the route is nested under the existing recommendations segment.
  it('is reachable at the edge by exactly the role the handler admits', () => {
    expect(rolesForOpsApiPath('/api/ops/control-room/recommendations/feed', 'GET')).toEqual([
      'control_room',
    ]);
  });

  it('says the list is unknown, not empty, when the service has never answered', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toMatch(/unknown - not nothing/);
  });

  it('reports a missing configuration as configuration', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceConfigError('nope'));
    expect((await GET()).status).toBe(503);
  });

  // A contract mismatch is a bug in the deployment pair, not an outage.
  // Absorbing it would let the two halves drift while the panel showed a
  // plausible, permanently frozen list.
  it('reports a shape mismatch as a shape mismatch, not as a stale feed', async () => {
    fetchControlService.mockResolvedValue({ recommendations: 'not an array' });
    const response = await GET();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('BAD_UPSTREAM');
  });
});

describe('readStandingProposals', () => {
  it('serves the last good feed flagged stale rather than emptying itself', async () => {
    fetchControlService.mockResolvedValueOnce(feed());
    const first = await readStandingProposals();
    expect(first.stale).toBe(false);

    // Expire the TTL without wiping lastGood - _resetStandingProposalCacheForTests
    // would drop both, which exercises a normal cache miss rather than the
    // fallback (the same trap controlRoomAlerts.test.ts documents).
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 60_000);
      fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));
      const second = await readStandingProposals();
      expect(second.stale).toBe(true);
      expect(second.feed.recommendations).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows a shape mismatch rather than falling back to the last good feed', async () => {
    fetchControlService.mockResolvedValueOnce(feed());
    await readStandingProposals();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 60_000);
      fetchControlService.mockResolvedValue({ nonsense: true });
      await expect(readStandingProposals()).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  // The row summarises what the stored proposal SAID. It must not carry the
  // CandidateAction objects themselves: those wear a safety verdict graded
  // against a clock that has moved, and a console handed one would render it
  // with the same approve affordance a live candidate gets.
  it('drops anything shaped like an approvable candidate', async () => {
    fetchControlService.mockResolvedValue(
      feed({
        recommendations: [
          {
            ...recommendation(),
            candidateActions: [{ actionType: 'two_way_hold', vehicleId: 'UP25FT4823' }],
            safeCandidates: [{ actionType: 'two_way_hold', vehicleId: 'UP25FT4823' }],
          },
        ],
      }),
    );

    const { feed: parsed } = await readStandingProposals();
    const serialised = JSON.stringify(parsed);
    expect(serialised).not.toContain('candidateActions');
    expect(serialised).not.toContain('safeCandidates');
  });
});

// @vitest-environment node
//
// The network-wide alert feed: GET /api/ops/control-room/alerts and the
// client under it (src/lib/controlService/alerts.ts).
//
// ─── WHAT THIS SURFACE IS FOR ────────────────────────────────────────────
//
// Bunching detection has run on a timer since the core data model, over every
// eligible corridor. The only way to SEE what it found was the console's
// per-corridor panel, which requires an operator to have already picked the
// corridor the incident is on. Across ~1,020 active route-directions that made
// noticing a matter of luck. This feed is the whole population at once.
//
// ─── THE ASSERTION THAT MATTERS MOST ─────────────────────────────────────
//
// An alert list that empties itself when the control service is unreachable is
// indistinguishable from an all-clear, and this is the one surface in the
// product where those two must never render alike. Most of the tests below are
// about that single distinction.
//
// Route handlers are exercised directly with their guard and the control
// service transport mocked, like controlRoomRecommendations.test.ts. The
// transport is mocked rather than the client module, because the Zod contract
// in alerts.ts is one of the things under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const { GET } = await import('@/app/api/ops/control-room/alerts/route');
const { readAlertFeed, _resetAlertCacheForTests } = await import('@/lib/controlService/alerts');

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    routeDirectionId: 'rd-1',
    members: [
      { vehicleId: 'UP25FT1000', role: 'leader' },
      { vehicleId: 'UP25FT1001', role: 'follower' },
    ],
    severity: 'predicted',
    causeClass: 'endogenous',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-20T09:00:00.000Z',
    endedAt: null,
    evidence: {},
    routeId: 'r-1',
    routePublicName: 'Lucknow – Kanpur',
    directionCode: 'UP',
    directionName: 'Towards Kanpur',
    secondsToBunching: 900,
    riskScore: 0.5,
    ...overrides,
  };
}

function feed(overrides: Record<string, unknown> = {}) {
  return {
    alerts: [alert()],
    countsBySeverity: { predicted: 1 },
    totalOpenCount: 1,
    generatedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAlertCacheForTests();
  requireOpsRole.mockResolvedValue({ ok: true, session: { email: 'cr@example.com' } });
});

describe('GET /api/ops/control-room/alerts', () => {
  it('returns every open alert on the network, with its corridor named', async () => {
    fetchControlService.mockResolvedValue(feed());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alerts).toHaveLength(1);
    // The corridor NAME is the difference between this feed and the
    // per-corridor one. A reader who has chosen nothing yet cannot act on a
    // bare route-direction uuid.
    expect(body.alerts[0].routePublicName).toBe('Lucknow – Kanpur');
    expect(body.totalOpenCount).toBe(1);
  });

  // Counted upstream over ALL open incidents, not derived from the returned
  // page. Deriving it would answer "how bad is the network?" with the page
  // size.
  it('reports severity counts that survive a truncated page', async () => {
    fetchControlService.mockResolvedValue(
      feed({ alerts: [alert()], countsBySeverity: { predicted: 12, bunched: 3 }, totalOpenCount: 15 }),
    );

    const body = await (await GET()).json();
    expect(body.alerts).toHaveLength(1);
    expect(body.countsBySeverity).toEqual({ predicted: 12, bunched: 3 });
    expect(body.totalOpenCount).toBe(15);
  });

  it('never caches, so an operator cannot be served a stale list by a proxy', async () => {
    fetchControlService.mockResolvedValue(feed());
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses anyone who is not control room', async () => {
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await GET()).status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  // The segment-derived default already resolves to control_room, so no
  // OPS_API_ROLE_OVERRIDES entry exists or should. This asserts the two agree,
  // because middleware is the ceiling and the handler is the decision.
  it('is reachable at the edge by exactly the role the handler admits', () => {
    expect(rolesForOpsApiPath('/api/ops/control-room/alerts', 'GET')).toEqual(['control_room']);
  });
});

describe('when the control service cannot be reached', () => {
  // THE ONE THAT MATTERS. An empty list and an unreachable service must never
  // look the same on an alert surface.
  it('serves the last good feed, flagged stale, rather than an empty list', async () => {
    fetchControlService.mockResolvedValueOnce(feed());
    const first = await readAlertFeed();
    expect(first.stale).toBe(false);

    // Force the TTL to lapse so the next read goes upstream and fails.
    _resetAlertCacheForTests();
    fetchControlService.mockResolvedValueOnce(feed());
    await readAlertFeed();
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));

    // Nothing fresh, upstream failing: the previous feed comes back marked.
    const cachedThenFailed = await readAlertFeed();
    expect(cachedThenFailed.stale).toBe(false); // still inside TTL
    expect(cachedThenFailed.feed.alerts).toHaveLength(1);
  });

  // The test above never actually reaches the fallback branch: resetting the
  // cache wipes lastGood too, so the "failed" read above is served by a fresh
  // cache hit, not by the outage path. This one genuinely expires the TTL
  // while leaving lastGood in place, so the fetch really fails and the
  // fallback really runs.
  it('genuinely falls back to a stale last-good feed once the cache has actually expired', async () => {
    vi.useFakeTimers();
    try {
      fetchControlService.mockResolvedValueOnce(feed());
      const first = await readAlertFeed();
      expect(first.stale).toBe(false);

      // Past the 15s TTL: the fresh entry is gone, lastGood is not.
      vi.advanceTimersByTime(20_000);
      fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));

      const afterOutage = await readAlertFeed();
      expect(afterOutage.stale).toBe(true);
      expect(afterOutage.feed.alerts).toHaveLength(1);
      expect(afterOutage.ageMs).toBeGreaterThanOrEqual(20_000);
    } finally {
      vi.useRealTimers();
    }
  });

  // The mirror case: no lastGood exists yet (first-ever read fails), so there
  // is nothing to fall back to and the caller must see the failure rather
  // than a fabricated empty feed.
  it('propagates the failure when there is no last-good feed to fall back to', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));
    await expect(readAlertFeed()).rejects.toBeInstanceOf(ControlServiceUnavailableError);
  });

  it('answers 503 with an explicit "unknown, not empty" message on a cold outage', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('UNAVAILABLE');
    // The words are the point: an operator must not read this as an all-clear.
    expect(body.error.message).toContain('not empty');
  });

  it('says so plainly when the control service is not configured at all', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceConfigError('unset'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('NOT_CONFIGURED');
  });

  // A shape mismatch is a deployment-pair bug, not an outage. Absorbing it
  // into the stale-feed path would let the two halves drift while the inbox
  // showed a plausible, permanently frozen list.
  it('does not disguise a contract mismatch as an outage', async () => {
    fetchControlService.mockResolvedValue({ alerts: 'not-an-array' });
    const response = await GET();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('BAD_UPSTREAM');
  });
});

describe('the alert contract', () => {
  it('accepts the predicted severity the forecast tier raises', async () => {
    fetchControlService.mockResolvedValue(feed({ alerts: [alert({ severity: 'predicted' })] }));
    const body = await (await GET()).json();
    expect(body.alerts[0].severity).toBe('predicted');
  });

  // Null is not zero and not safety. On a predicted alert it means the
  // forecaster stopped having an opinion, which a UI must render as absence.
  it('carries a null countdown through rather than defaulting it', async () => {
    fetchControlService.mockResolvedValue(
      feed({ alerts: [alert({ secondsToBunching: null, riskScore: null })] }),
    );
    const body = await (await GET()).json();
    expect(body.alerts[0].secondsToBunching).toBeNull();
    expect(body.alerts[0].riskScore).toBeNull();
  });

  it('still accepts the reactive severities it shares the ladder with', async () => {
    for (const severity of ['warning', 'bunched', 'severe']) {
      _resetAlertCacheForTests();
      fetchControlService.mockResolvedValue(feed({ alerts: [alert({ severity })] }));
      const body = await (await GET()).json();
      expect(body.alerts[0].severity).toBe(severity);
    }
  });
});

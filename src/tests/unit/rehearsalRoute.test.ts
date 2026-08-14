// @vitest-environment node
//
// POST /api/ops/rehearsal, plus the client under it
// (src/lib/controlService/rehearsalData.ts).
//
// Two properties matter on this boundary, and neither is about the
// simulation itself:
//
//   1. THE REFUSAL SURVIVES. 561 of the 759 seeded corridors have no
//      MEASURED target headway. Every bunching threshold in this system is a
//      ratio of that number, so a run against their sentinel would produce a
//      complete set of confident-looking results from a denominator nobody
//      measured. The control service refuses those, and that refusal has to
//      reach the operator with its explanation intact rather than becoming a
//      500 or, worse, a result.
//
//   2. THE PROVENANCE MANIFEST SURVIVES. A result whose "which of these
//      numbers is invented" labelling did not arrive is refused rather than
//      rendered, because that labelling is the only thing separating this
//      page from a page of fabricated operational numbers.
//
// Route handler exercised directly with its guard and the control-service
// transport mocked - same approach as the recommendations route tests. The
// Zod contract in rehearsalData.ts is under test, so it is mocked at the
// transport rather than at the client module.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

const requireUpsrtcAccess = vi.fn();
const fetchControlService = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: () => requireUpsrtcAccess() as unknown,
}));

vi.mock('@/lib/controlService/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/controlService/client')>();
  return { ...actual, fetchControlService: (...args: unknown[]) => fetchControlService(...args) as unknown };
});

const { POST } = await import('@/app/api/ops/rehearsal/route');

const ROUTE_DIRECTION_ID = '44444444-4444-4444-4444-444444444444';
const ORIGIN = 'https://ops.example.test';

function request(body: unknown, init: { origin?: string | null; contentType?: string } = {}) {
  const headers = new Headers({
    'content-type': init.contentType ?? 'application/json',
    host: 'ops.example.test',
  });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  return new NextRequest(`${ORIGIN}/api/ops/rehearsal`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** A minimally-valid rehearsal payload - enough for the schema, nothing more. */
function payload(patch: Record<string, unknown> = {}) {
  return {
    corridor: {
      routeDirectionId: ROUTE_DIRECTION_ID,
      routeId: '1348',
      routeName: 'Lucknow - Kanpur',
      directionCode: 'OUT',
      isLoop: false,
      totalDistanceMeters: 90_000,
      calibrationSource: 'timetable',
      stops: [],
      shape: [],
      controlPointCount: 5,
    },
    policy: {
      targetHeadwaySeconds: 900,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.6,
      kb: 0.3,
      selfEqualizingK: 0.5,
      maxHoldSeconds: 90,
      cooldownSeconds: 60,
      predictionHorizonControlPoints: 3,
      occupancyCapacity: null,
      occupancyStaleSeconds: null,
    },
    inputs: {
      cruiseSpeedKmph: 35,
      travelTimeVariation: 0.12,
      boardingRatePerMinute: 1.5,
      alightingFraction: 0.18,
      baseDwellSeconds: 20,
      secondsPerBoarding: 2.5,
      secondsPerAlighting: 1.5,
      vehicleCapacity: 52,
      vehicleCount: 6,
      seed: 1,
      disturbance: 'none',
    },
    provenance: [
      { field: 'Passenger demand', source: 'modelled', value: '1.5/min', note: 'INVENTED.' },
    ],
    arms: {
      uncontrolled: {
        name: 'no-control',
        kpis: emptyKpis(),
        frames: [],
        appliedHoldSeconds: 0,
        refusedHoldSeconds: 0,
      },
      controlled: {
        name: 'deployed-control-laws',
        kpis: emptyKpis(),
        frames: [],
        appliedHoldSeconds: 90,
        refusedHoldSeconds: 0,
      },
    },
    decisions: [],
    occupancyContrast: {
      decisionsScored: 0,
      decisionsUsingFallbackToday: 0,
      meanOnboardCostAsDeployedToday: null,
      meanOnboardCostWithModelledOccupancy: null,
      rankingComparable: false,
    },
    disturbedVehicleId: null,
    notRehearsed: ['Terminal dispatch regulation.'],
    horizonSeconds: 10_000,
    ...patch,
  };
}

function emptyKpis() {
  return {
    meanHeadwaySeconds: 900,
    headwayCv: 0.4,
    bunchingIncidents: 2,
    excessWaitSeconds: 100,
    deniedBoardings: 5,
    strandedPassengers: 5,
    onTimeDispatchRate: 0.9,
    complianceRate: null,
    totalBoardings: 500,
  };
}

describe('POST /api/ops/rehearsal', () => {
  beforeEach(() => {
    requireUpsrtcAccess.mockReset();
    fetchControlService.mockReset();
    requireUpsrtcAccess.mockResolvedValue({ ok: true, claims: { sub: 'u1', email: 'p@example.test', role: 'planner' } });
  });

  describe('who may run one', () => {
    it('refuses a caller with no active ops profile, and never reaches the simulator', async () => {
      requireUpsrtcAccess.mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      });

      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));

      expect(response.status).toBe(401);
      expect(fetchControlService).not.toHaveBeenCalled();
    });

    it('refuses a cross-origin post', async () => {
      const response = await POST(
        request({ routeDirectionId: ROUTE_DIRECTION_ID }, { origin: 'https://elsewhere.test' }),
      );
      expect(response.status).toBe(403);
      expect(requireUpsrtcAccess).not.toHaveBeenCalled();
    });

    it('refuses a body that is not JSON', async () => {
      const response = await POST(
        request({ routeDirectionId: ROUTE_DIRECTION_ID }, { contentType: 'text/plain' }),
      );
      expect(response.status).toBe(415);
    });
  });

  describe('the refusal that matters', () => {
    // The whole point. This is 561 of 759 corridors.
    it('passes an uncalibrated corridor through as a 404 with its explanation intact', async () => {
      fetchControlService.mockRejectedValue(
        new ControlServiceRequestError(
          'Route-direction rd-561 has no measured target headway, so no simulation can be run on it.',
          404,
          'no_active_policy',
        ),
      );

      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      const body = (await response.json()) as { error: { code: string; message: string } };

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('UNCALIBRATED_CORRIDOR');
      expect(body.error.message).toMatch(/no measured target headway/i);
    });

    it('never turns that refusal into an empty result the page could render', async () => {
      fetchControlService.mockRejectedValue(
        new ControlServiceRequestError('no target', 404, 'no_active_policy'),
      );
      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty('arms');
      expect(body).not.toHaveProperty('policy');
    });
  });

  describe('the provenance manifest', () => {
    it('returns a well-formed result with its manifest', async () => {
      fetchControlService.mockResolvedValue(payload());

      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      const body = (await response.json()) as { provenance: { source: string }[] };

      expect(response.status).toBe(200);
      expect(body.provenance.some((entry) => entry.source === 'modelled')).toBe(true);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    // Rendering the numbers without the labels is the exact failure the
    // whole design exists to prevent, so a payload missing them is refused.
    it('refuses a result whose provenance manifest did not arrive', async () => {
      const broken = payload();
      delete (broken as Record<string, unknown>).provenance;
      fetchControlService.mockResolvedValue(broken);

      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      expect(response.status).toBe(502);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'CONTROL_SERVICE_ERROR',
      );
    });

    it('refuses a result carrying a sentinel target headway, whatever the service said', async () => {
      // Belt and braces on the one number every threshold divides by: the
      // schema requires it to be positive, so a zero or negative can never
      // reach a page that would then compute ratios from it.
      fetchControlService.mockResolvedValue(payload({ policy: { ...payload().policy, targetHeadwaySeconds: 0 } }));
      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      expect(response.status).toBe(502);
    });
  });

  describe('input validation', () => {
    it('requires a route-direction uuid', async () => {
      const response = await POST(request({ routeDirectionId: 'not-a-uuid' }));
      expect(response.status).toBe(422);
      expect(fetchControlService).not.toHaveBeenCalled();
    });

    // Refuse, do not clamp: a clamped run is a different simulation returned
    // as though it were the one that was asked for.
    it('refuses an out-of-range modelled input rather than quietly running a different simulation', async () => {
      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID, vehicleCount: 500 }));
      expect(response.status).toBe(422);
      expect(fetchControlService).not.toHaveBeenCalled();
    });

    it('refuses an unknown scenario rather than falling back to none', async () => {
      const response = await POST(
        request({ routeDirectionId: ROUTE_DIRECTION_ID, disturbance: 'earthquake' }),
      );
      expect(response.status).toBe(422);
    });

    it('forwards the operator\'s modelled inputs unchanged', async () => {
      fetchControlService.mockResolvedValue(payload());
      await POST(
        request({ routeDirectionId: ROUTE_DIRECTION_ID, vehicleCount: 9, cruiseSpeedKmph: 42, disturbance: 'gps_dropout' }),
      );
      const [path, options] = fetchControlService.mock.calls[0] as [string, { method: string; body: unknown }];
      expect(path).toContain(`/v1/route-directions/${ROUTE_DIRECTION_ID}/rehearsal`);
      expect(options.method).toBe('POST');
      expect(options.body).toMatchObject({ vehicleCount: 9, cruiseSpeedKmph: 42, disturbance: 'gps_dropout' });
    });
  });

  describe('when the simulator service is unavailable', () => {
    it('says it is unreachable rather than showing an empty run', async () => {
      fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('circuit open'));
      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'CONTROL_SERVICE_UNAVAILABLE',
      );
    });

    it('distinguishes not-configured from unreachable', async () => {
      fetchControlService.mockRejectedValue(new ControlServiceConfigError('no base url'));
      const response = await POST(request({ routeDirectionId: ROUTE_DIRECTION_ID }));
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_CONFIGURED');
    });
  });
});

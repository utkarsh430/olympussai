// @vitest-environment node
//
// The decision engine, from this app's side: POST
// /api/ops/control-room/recommendations plus the client under it
// (src/lib/controlService/recommendations.ts).
//
// WHAT WAS BROKEN BEFORE THIS ROUTE EXISTED: control-service has shipped a
// five-tier headway controller behind POST /v1/mpc/solve since the core data
// model landed, and no route handler, lib module or component in this app had
// ever called it. The control room's only way to act was a free-text form.
// These tests hold the wiring honest in the two ways that matter on a control
// path: the engine's own limits must survive to the wire (it proposes three
// hold types, never the six human-originated ones; it refuses candidates and
// says why), and nothing here may issue a command.
//
// Route handlers are exercised directly with their guard, repo and control
// service mocked — same approach as controlRoomCommandBridge.test.ts.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { rolesForOpsApiPath } from '@/lib/auth/rbac/roles';

const requireOpsRole = vi.fn();
const getActiveKillSwitches = vi.fn();
const fetchControlService = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ getActiveKillSwitches }),
}));

// Mocked at the transport, not at the client module: the Zod contract in
// src/lib/controlService/recommendations.ts is one of the things under test,
// so it has to actually run.
vi.mock('@/lib/controlService/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/controlService/client')>();
  return { ...actual, fetchControlService: (...args: unknown[]) => fetchControlService(...args) };
});

const CALLER_CLAIMS = { sub: 'ops-user-1', email: 'cr@example.com', role: 'control_room' as const };
const ROUTE_DIRECTION_ID = '44444444-4444-4444-4444-444444444444';
const PATH = '/api/ops/control-room/recommendations';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    actionType: 'two_way_hold',
    vehicleId: 'UP25FT4823',
    involvedVehicleIds: ['UP25FT4823', 'UP25FT9001'],
    holdSeconds: 45,
    objectiveCost: 0.4,
    clampResidualSeconds: 0,
    passengerCost: {
      waitPassengerSeconds: -12,
      onboardPassengerSeconds: 0,
      operatorPassengerSeconds: 0,
        latenessPassengerSeconds: 0,
      netPassengerSeconds: -12,
      loadEstimated: true,
      backwardEstimated: false,
        scheduleUnknown: true,
    },
    rationale: 'Hold 36s: UP25FT4823 has closed to 420s behind the bus ahead, 180s tighter than the 600s target and the bus behind is 900s back, so evening the two gaps is worth a net saving of 12 passenger-seconds; no onboard count is available, so no in-vehicle delay was priced in.',
    routeDirectionId: ROUTE_DIRECTION_ID,
    stateAsOf: '2026-08-12T09:00:00.000Z',
    headwayDeviationSeconds: -120,
    targetHeadwaySeconds: 600,
    ...overrides,
  };
}

function solveResult(overrides: Record<string, unknown> = {}) {
  const terminal = candidate({
    actionType: 'terminal_dispatch_hold',
    vehicleId: 'UP25FT1000',
    involvedVehicleIds: ['UP25FT1000', 'UP25FT1001'],
    holdSeconds: 90,
    objectiveCost: 0,
  });
  const midRoute = candidate();
  const rejected = candidate({ vehicleId: 'UP25FT7777', involvedVehicleIds: ['UP25FT7777', 'UP25FT7778'] });
  return {
    routeDirectionId: ROUTE_DIRECTION_ID,
    candidateActions: [terminal, midRoute, rejected],
    safeCandidates: [terminal, midRoute],
    selectedAction: terminal,
    selectedActionType: 'terminal_dispatch_hold',
    objectiveCost: 0,
    expectedRecoverySeconds: 90,
    constraints: { maxHoldSeconds: 120, cooldownSeconds: 60, staleAfterSeconds: 90 },
    controllerVersion: 'terminal-two-way-self-equalizing-v1',
    rejectedCandidates: [{ candidate: rejected, reasons: ['stale_state'] }],
    predictiveAdvisory: {
      label: 'PREDICTIVE',
      horizonControlPoints: 3,
      candidates: [
        {
          actionType: 'two_way_hold',
          vehicleId: 'UP25FT4823',
          holdSeconds: 45,
          waitCost: 320.1,
          onboardCost: 36,
          mpcObjectiveCost: 356.1,
          occupancyEstimated: false,
        },
      ],
      controllerVersion: 'occupancy-weighted-mpc-v1',
    },
    ...overrides,
  };
}

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function postRecommendations(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import('@/app/api/ops/control-room/recommendations/route');
  return POST(buildRequest(body, headers) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
  getActiveKillSwitches.mockResolvedValue([]);
  fetchControlService.mockResolvedValue(solveResult());
});

describe('POST /api/ops/control-room/recommendations — the engine is finally reachable', () => {
  it('calls the decision engine for the requested route-direction and returns what it proposed', async () => {
    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchControlService).toHaveBeenCalledWith('/v1/mpc/solve', {
      method: 'POST',
      body: { routeDirectionId: ROUTE_DIRECTION_ID },
    });

    // The full candidate, not just its type: naming the action without naming
    // the bus is what made the engine unusable for prefilling a command.
    expect(body.selectedAction).toMatchObject({
      actionType: 'terminal_dispatch_hold',
      vehicleId: 'UP25FT1000',
      holdSeconds: 90,
    });
    expect(body.selectionBasis).toBe('terminal_dispatch_priority');
    expect(body.controllerVersion).toBe('terminal-two-way-self-equalizing-v1');
    expect(body.expectedRecoverySeconds).toBe(90);
  });

  it('carries the reasoning and the refusals, not just a verdict', async () => {
    const body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();

    // Every candidate the control laws generated, the ones that survived the
    // safety filter, and the ones it refused with their reasons — an operator
    // overriding the engine can see what it would not do and why.
    expect(body.candidateActions).toHaveLength(3);
    expect(body.safeCandidates).toHaveLength(2);
    expect(body.rejectedCandidates).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ vehicleId: 'UP25FT7777' }),
        reasons: ['stale_state'],
      }),
    ]);

    // Each candidate carries the headway evidence it was computed from.
    expect(body.selectedAction).toMatchObject({
      headwayDeviationSeconds: -120,
      targetHeadwaySeconds: 600,
      stateAsOf: '2026-08-12T09:00:00.000Z',
      involvedVehicleIds: ['UP25FT1000', 'UP25FT1001'],
    });
    expect(body.constraints).toMatchObject({ maxHoldSeconds: 120, staleAfterSeconds: 90 });
  });

  it('states the engine’s action vocabulary in the payload — four holds and one non-hold', async () => {
    const body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();

    // Every type the engine can actually propose. `cost_optimal_hold` is the
    // closed-form law; `boarding_limit` is alighting-only, which is NOT a
    // hold — it asks a bus to spend less time at a stop, not more.
    //
    // Both belong here because the console derives "nothing in this system
    // generates these" by SUBTRACTING this vocabulary from the dispatchable
    // set. Omitting either would make the console claim an instruction is
    // human-originated while the engine emits it.
    expect(body.engineActionTypes).toEqual([
      'terminal_dispatch_hold',
      'two_way_hold',
      'self_equalizing_hold',
      'cost_optimal_hold',
      'boarding_limit',
    ]);
    // The five genuinely human-originated instructions are absent by
    // construction, so a console cannot imply the engine covers them.
    for (const humanOnly of [
      'stop_skip',
      'short_turn',
      'deadhead',
      'standby_injection',
      'speed_guidance',
    ]) {
      expect(body.engineActionTypes).not.toContain(humanOnly);
    }
  });

  it('keeps the predictive advisory labelled and separate from the committed choice', async () => {
    const body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();

    expect(body.predictiveAdvisory.label).toBe('PREDICTIVE');
    expect(body.predictiveAdvisory.controllerVersion).toBe('occupancy-weighted-mpc-v1');
    // The advisory's top-ranked candidate is a different bus than the selected
    // action here, and that is fine precisely because it cannot commit one.
    expect(body.predictiveAdvisory.candidates[0].vehicleId).toBe('UP25FT4823');
    expect(body.selectedAction.vehicleId).toBe('UP25FT1000');
    expect(body.predictiveAdvisory.candidates[0].occupancyEstimated).toBe(false);
  });

  it('says plainly that nothing was written down', async () => {
    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    const body = await response.json();

    expect(body.persistence).toBe('none');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports a kill switch alongside the recommendation instead of hiding either', async () => {
    getActiveKillSwitches.mockResolvedValue([
      {
        id: 'ks-1',
        scope: 'route',
        routeDirectionId: ROUTE_DIRECTION_ID,
        engagedAt: '2026-08-12T08:00:00.000Z',
        engagedBy: 'ops-user-9',
        reason: 'Flooding on the corridor',
        disengagedAt: null,
        disengagedBy: null,
        disengageReason: null,
      },
    ]);

    const body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();

    // The recommendation still comes back — an operator watching a halted
    // route still needs to see what the engine thinks is happening — but the
    // console is told the next command would be refused.
    expect(body.selectedAction).not.toBeNull();
    expect(body.commandsBlockedBy).toEqual({
      scope: 'route',
      routeDirectionId: ROUTE_DIRECTION_ID,
      reason: 'Flooding on the corridor',
      engagedAt: '2026-08-12T08:00:00.000Z',
    });
    expect(getActiveKillSwitches).toHaveBeenCalledWith(ROUTE_DIRECTION_ID);
  });

  it('distinguishes "nothing to do" from "everything was refused"', async () => {
    const rejected = candidate({ vehicleId: 'UP25FT7777' });
    fetchControlService.mockResolvedValue(
      solveResult({
        candidateActions: [rejected],
        safeCandidates: [],
        selectedAction: null,
        selectedActionType: null,
        objectiveCost: null,
        expectedRecoverySeconds: null,
        rejectedCandidates: [{ candidate: rejected, reasons: ['conflicting_active_command'] }],
      }),
    );
    let body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();
    expect(body.selectionBasis).toBe('all_candidates_rejected');
    expect(body.selectedAction).toBeNull();

    fetchControlService.mockResolvedValue(
      solveResult({
        candidateActions: [],
        safeCandidates: [],
        selectedAction: null,
        selectedActionType: null,
        objectiveCost: null,
        expectedRecoverySeconds: null,
        rejectedCandidates: [],
      }),
    );
    body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();
    expect(body.selectionBasis).toBe('no_candidates');
  });

  it('reports a mid-route selection as such', async () => {
    const midRoute = candidate({ actionType: 'self_equalizing_hold' });
    fetchControlService.mockResolvedValue(
      solveResult({
        candidateActions: [midRoute],
        safeCandidates: [midRoute],
        selectedAction: midRoute,
        selectedActionType: 'self_equalizing_hold',
        rejectedCandidates: [],
      }),
    );

    const body = await (await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID })).json();
    expect(body.selectionBasis).toBe('lowest_cost_mid_route');
  });
});

describe('POST /api/ops/control-room/recommendations — refusals', () => {
  it('refuses a cross-origin request before the guard or the engine is touched', async () => {
    const response = await postRecommendations(
      { routeDirectionId: ROUTE_DIRECTION_ID },
      { origin: 'http://evil.example' },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('INVALID_ORIGIN');
    expect(requireOpsRole).not.toHaveBeenCalled();
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('is control_room only, so a depot operator never reaches the engine through it', async () => {
    // The handler's own guard...
    await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(requireOpsRole).toHaveBeenCalledWith(['control_room']);

    // ...and the middleware role map that stands in front of it. Both have to
    // agree, or the depot boundary this system just closed reopens on the one
    // endpoint that names individual vehicles.
    expect(rolesForOpsApiPath(PATH, 'POST')).toEqual(['control_room']);

    // A refused guard short-circuits everything downstream.
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    });
    fetchControlService.mockClear();
    const denied = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(denied.status).toBe(403);
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON content type and a malformed body', async () => {
    const wrongType = await postRecommendations(
      { routeDirectionId: ROUTE_DIRECTION_ID },
      { 'content-type': 'text/plain' },
    );
    expect(wrongType.status).toBe(415);

    const malformed = await postRecommendations('{ not json');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe('INVALID_BODY');
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('refuses a missing or non-uuid route-direction with a self-identifying code', async () => {
    for (const body of [{}, { routeDirectionId: 'not-a-uuid' }]) {
      const response = await postRecommendations(body);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe('ROUTE_DIRECTION_REQUIRED');
    }
    expect(fetchControlService).not.toHaveBeenCalled();
  });

  it('tells the operator a route-direction has no active policy, rather than showing an empty plan', async () => {
    fetchControlService.mockRejectedValue(
      new ControlServiceRequestError('No active route policy for route-direction x', 404, 'no_active_policy'),
    );

    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NO_ACTIVE_POLICY');
  });

  it('reports an unreachable engine as unavailable rather than as "no recommendation"', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('control service request timed out'));

    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('CONTROL_SERVICE_UNAVAILABLE');
  });

  it('reports an unconfigured engine distinctly from an unreachable one', async () => {
    fetchControlService.mockRejectedValue(new ControlServiceConfigError('not configured'));

    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('NOT_CONFIGURED');
  });

  it('refuses an off-contract engine response instead of forwarding it to a control surface', async () => {
    fetchControlService.mockResolvedValue({ routeDirectionId: ROUTE_DIRECTION_ID, selectedActionType: 'two_way_hold' });

    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('CONTROL_SERVICE_ERROR');
  });

  it('refuses a response claiming an action type the engine cannot produce', async () => {
    // If the engine ever started emitting one of the six human-originated
    // instructions, the console must not render it as a recommendation. The
    // contract refuses the whole payload rather than passing an unmodelled
    // action to a control surface.
    fetchControlService.mockResolvedValue(
      solveResult({
        candidateActions: [candidate({ actionType: 'stop_skip' })],
        safeCandidates: [candidate({ actionType: 'stop_skip' })],
        selectedAction: candidate({ actionType: 'stop_skip' }),
        selectedActionType: 'stop_skip',
        rejectedCandidates: [],
      }),
    );

    const response = await postRecommendations({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(502);
  });
});

describe('the decision-engine client itself', () => {
  it('never serves a cached recommendation, because a stale one carries an expired safety verdict', async () => {
    const { solveRouteDirection } = await import('@/lib/controlService/recommendations');

    fetchControlService.mockResolvedValue(solveResult());
    await solveRouteDirection(ROUTE_DIRECTION_ID);
    await solveRouteDirection(ROUTE_DIRECTION_ID);
    expect(fetchControlService).toHaveBeenCalledTimes(2);

    // And an outage produces a refusal, not the last good answer — unlike the
    // dashboard snapshot clients in this directory, deliberately.
    fetchControlService.mockRejectedValue(new ControlServiceUnavailableError('down'));
    await expect(solveRouteDirection(ROUTE_DIRECTION_ID)).rejects.toBeInstanceOf(ControlServiceUnavailableError);
  });

  it('derives the selection basis from the engine’s own answer rather than re-running its rule', async () => {
    const { selectionBasisFor } = await import('@/lib/controlService/recommendations');
    const parsed = (await import('@/models/control')).mpcSolveResultSchema.parse(solveResult());

    expect(selectionBasisFor(parsed)).toBe('terminal_dispatch_priority');
  });
});

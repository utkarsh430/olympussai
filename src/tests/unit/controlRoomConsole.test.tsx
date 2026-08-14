// @vitest-environment jsdom
//
// The control-room console, driven the way an operator drives it.
//
// The pure rules behind it are asserted exhaustively in
// controlRoomConsoleModel.test.ts. What this file holds is the wiring those
// rules depend on being connected to: that every capability the old page had
// is still reachable and still works, that the engine's proposal reaches the
// command endpoint as the APPROVED triple and nothing else, and that the
// console refuses to offer an issue control in the states where issuing would
// be wrong.
//
// The map is mocked out. It is the one part of this screen with its own suite
// (opsFleetMapPanel.test.tsx, fleetCanvasLayer.test.ts) and the only part that
// needs a Google basemap, which no test process has.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { ControlRoomConsole } from '@/components/ops/control-room/console/ControlRoomConsole';
import type { ControlRoomOverview } from '@/lib/ops/controlRoomOverviewModel';
import type { RecommendationResult } from '@/lib/ops/recommendationView';

/**
 * Assert some element carries this text.
 *
 * `getByText` with a regex matches an element AND every ancestor whose
 * combined text also matches, so an alert's title reliably matches both the
 * title paragraph and the alert box around it. That ambiguity is a property of
 * the query, not of the UI, and collapsing it here keeps the assertions about
 * what the console SAYS rather than about which node happens to say it.
 */
function expectText(pattern: RegExp): void {
  expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
}

vi.mock('@/components/ops/map/OpsFleetMapPanel', () => ({
  OpsFleetMapPanel: ({ scopeLabel, routeDirectionId }: { scopeLabel: string; routeDirectionId?: string }) => (
    <div data-testid="fleet-map">
      map:{scopeLabel}:{routeDirectionId ?? 'none'}
    </div>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ops/control-room',
}));

const CORRIDOR = '11111111-1111-4111-8111-111111111111';

function overview(patch: Partial<ControlRoomOverview> = {}): ControlRoomOverview {
  return {
    fetchedAt: new Date().toISOString(),
    routeDirections: [
      { routeDirectionId: CORRIDOR, routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 },
    ],
    selectedRouteDirectionId: CORRIDOR,
    fleet: { reporting: 9170, source: 'live', stale: false, error: null },
    observability: { ok: true, stale: false, error: null },
    headway: {
      routeDirectionId: CORRIDOR,
      sampleCount: 12,
      meanHeadwaySeconds: 540,
      stddevHeadwaySeconds: 120,
      cv: 0.22,
      ewtSeconds: 95,
      targetHeadwaySeconds: 600,
    },
    incidents: [],
    dailyKpi: { ok: true, row: null },
    guardrails: { ok: true, total: 0, critical: 0 },
    killSwitches: { ok: true, active: [] },
    ...patch,
  };
}

const SELECTED = {
  actionType: 'two_way_hold' as const,
  vehicleId: 'UP25FT4823',
  involvedVehicleIds: ['UP25FT4823', 'UP25FT7778'],
  holdSeconds: 36,
  objectiveCost: 0,
  routeDirectionId: CORRIDOR,
  stateAsOf: new Date().toISOString(),
  headwayDeviationSeconds: -180,
  targetHeadwaySeconds: 600,
};

function recommendation(patch: Partial<RecommendationResult> = {}): RecommendationResult {
  return {
    routeDirectionId: CORRIDOR,
    solvedAt: new Date().toISOString(),
    controllerVersion: 'terminal-two-way-self-equalizing-v1',
    engineActionTypes: ['terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold'],
    selectedAction: SELECTED,
    selectionBasis: 'lowest_cost_mid_route',
    objectiveCost: 0,
    expectedRecoverySeconds: 36,
    candidateActions: [SELECTED],
    safeCandidates: [SELECTED],
    rejectedCandidates: [
      {
        candidate: {
          ...SELECTED,
          vehicleId: 'UP25FT7777',
          involvedVehicleIds: ['UP25FT7777', 'UP25FT7778'],
        },
        reasons: ['stale_state'],
      },
    ],
    predictiveAdvisory: {
      label: 'PREDICTIVE',
      horizonControlPoints: 3,
      candidates: [
        {
          actionType: 'two_way_hold',
          vehicleId: 'UP25FT9999',
          holdSeconds: 40,
          waitCost: 10,
          onboardCost: 20,
          mpcObjectiveCost: 72,
          occupancyEstimated: true,
        },
      ],
      controllerVersion: 'occupancy-weighted-mpc-v1',
    },
    constraints: { maxHoldSeconds: 120, cooldownSeconds: 300, staleAfterSeconds: 90 },
    commandsBlockedBy: null,
    persistence: 'none',
    ...patch,
  };
}

const APPROVAL = {
  id: '22222222-2222-4222-8222-222222222222',
  dispatcherUserId: 'dispatcher-1',
  actionType: 'two_way_hold',
  vehicleId: 'UP25FT4823',
  routeDirectionId: CORRIDOR,
  incidentId: null,
  reason: 'bunching reported by the depot',
  consumedAt: null,
  rejectedAt: null,
  rejectedBy: null,
  rejectionReason: null,
  createdAt: new Date().toISOString(),
  decision: 'pending' as const,
};

interface RouteStubs {
  overview?: ControlRoomOverview;
  recommendation?: RecommendationResult | { error: { code: string; message: string }; status: number };
  approvals?: unknown[];
  onCommand?: (body: Record<string, unknown>) => { ok: boolean; status: number; payload: unknown };
}

function stubFetch(stubs: RouteStubs) {
  const commandBodies: Record<string, unknown>[] = [];
  const calls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const json = (payload: unknown, status = 200) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

    if (url.startsWith('/api/ops/control-room/overview')) {
      return json(stubs.overview ?? overview());
    }
    if (url.startsWith('/api/ops/control-room/recommendations')) {
      const value = stubs.recommendation ?? recommendation();
      if (value && 'error' in value) return json({ error: value.error }, value.status);
      return json(value);
    }
    if (url.startsWith('/api/ops/dispatcher/approvals')) {
      return json({ actions: stubs.approvals ?? [] });
    }
    if (url.startsWith('/api/ops/control-room/commands') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      commandBodies.push(body);
      const result = stubs.onCommand?.(body) ?? {
        ok: true,
        status: 201,
        payload: { ok: true, commandId: 'cmd-1', status: 'delivered', expiresAt: 'later', auditEventId: 'audit-1' },
      };
      return json(result.payload, result.status);
    }
    if (url.startsWith('/api/ops/control-room/kill-switches')) {
      return json({ active: [] });
    }
    if (url.startsWith('/api/ops/fleet/breakdown-reports')) {
      return json({ reports: [], nextCursor: null });
    }
    return json({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, commandBodies, calls };
}

function renderConsole(props: Partial<React.ComponentProps<typeof ControlRoomConsole>> = {}) {
  return render(
    <ControlRoomConsole
      email="control@example.gov.in"
      initialOverview={overview()}
      initialOverviewError={null}
      initialActiveKillSwitches={[]}
      initialTab="decisions"
      fleetPanel={<div data-testid="fleet-panel">fleet roster</div>}
      reportsPanel={<div data-testid="reports-panel">breakdown reports</div>}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('control-room console — the map holds the frame and every capability is reachable', () => {
  beforeEach(() => stubFetch({ approvals: [APPROVAL] }));

  it('mounts the statewide map, not a depot-scoped one', async () => {
    renderConsole();
    // Control room is not depot-scoped, and the map must say the boundary it
    // is actually drawing rather than implying a narrower one.
    expect(await screen.findByTestId('fleet-map')).toHaveTextContent(`map:all depots:${CORRIDOR}`);
  });

  it('keeps the map mounted while the operator works in every other panel', async () => {
    renderConsole();
    for (const tab of ['approvals', 'fleet', 'copilot', 'safety', 'reports'] as const) {
      fireEvent.click(screen.getByTestId(`console-tab-${tab}`));
      expect(screen.getByTestId('fleet-map')).toBeInTheDocument();
    }
  });

  it('still reaches the approval queue, the command form and command lookup', async () => {
    renderConsole();
    fireEvent.click(screen.getByTestId('console-tab-approvals'));
    expect(await screen.findByText(/bunching reported by the depot/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issue command/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/control-service command id/i)).toBeInTheDocument();
  });

  it('still reaches the kill switches, the fleet roster and the breakdown reports', async () => {
    renderConsole();
    fireEvent.click(screen.getByTestId('console-tab-safety'));
    expect(await screen.findByRole('heading', { name: /kill switches/i })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('console-tab-fleet'));
    expect(screen.getByTestId('fleet-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('console-tab-reports'));
    expect(screen.getByTestId('reports-panel')).toBeInTheDocument();
  });

  it('still reaches the copilot, without leaving the map', async () => {
    renderConsole();
    fireEvent.click(screen.getByTestId('console-tab-copilot'));
    await screen.findAllByText(/ask about this corridor/i);
    expect(screen.getByTestId('fleet-map')).toBeInTheDocument();
  });

  it('reads the approval queue UNFILTERED, or the engine-proposed holds would be invisible', async () => {
    const { calls } = stubFetch({ approvals: [APPROVAL] });
    renderConsole();
    await waitFor(() => expect(calls.some((url) => url.includes('/api/ops/dispatcher/approvals'))).toBe(true));
    // Holds are not in the four "disruptive" action types the default queue
    // filters to, so the default read would never show the approval that
    // authorizes the engine's own proposal.
    expect(calls.some((url) => url.includes('disruptiveOnly=false'))).toBe(true);
    expect(calls.some((url) => url.includes('disruptiveOnly=true'))).toBe(false);
  });
});

describe('control-room console — the status band', () => {
  it('shows measured numbers when the sources answered', async () => {
    stubFetch({});
    renderConsole();
    expect(await screen.findByText('9170')).toBeInTheDocument();
    expect(screen.getByText('540s')).toBeInTheDocument();
  });

  it('shows n/a rather than zero when a source did not answer', async () => {
    stubFetch({
      overview: overview({
        observability: { ok: false, stale: true, error: 'timed out' },
        guardrails: { ok: false, total: 0, critical: 0 },
      }),
    });
    renderConsole({
      initialOverview: overview({
        observability: { ok: false, stale: true, error: 'timed out' },
        guardrails: { ok: false, total: 0, critical: 0 },
      }),
    });
    await waitFor(() => expect(screen.getAllByText('n/a').length).toBeGreaterThan(0));
    expectText(/tiles marked/i);
    expect(screen.queryByText(/this corridor is clear/i)).not.toBeInTheDocument();
  });

  it('warns that commands are halted when a kill switch is engaged', async () => {
    const engaged = overview({
      killSwitches: {
        ok: true,
        active: [
          {
            id: 'ks-1',
            scope: 'network',
            routeDirectionId: null,
            engagedAt: new Date().toISOString(),
            engagedBy: 'u1',
            reason: 'comms failure',
            disengagedAt: null,
            disengagedBy: null,
            disengageReason: null,
          },
        ],
      },
    });
    stubFetch({ overview: engaged });
    renderConsole({ initialOverview: engaged });
    await screen.findAllByText(/network kill switch engaged/i);
  });
});

describe('control-room console — the engine proposal', () => {
  it('shows the proposal, its reasoning and what the safety filter refused', async () => {
    stubFetch({ approvals: [APPROVAL] });
    renderConsole();

    await screen.findAllByText(/Proposed: Two-way hold/i);
    expectText(/Cheapest safe mid-route hold/i);

    // Rejections are visible, not behind a disclosure, and they blame the
    // dependency set rather than the named bus.
    expectText(/Refused by the safety filter/i);
    expectText(/data this depends on is stale/i);
    expectText(/UP25FT7778/);
  });

  it('states the engine only proposes holds, and names the six it does not', async () => {
    stubFetch({ approvals: [APPROVAL] });
    renderConsole();
    await screen.findAllByText(/What this engine can and cannot propose/i);
    expectText(/nothing in this system generates or ranks them/i);
  });

  it('keeps the predictive advisory separate and gives it no way to be issued', async () => {
    stubFetch({ approvals: [APPROVAL] });
    renderConsole();
    const advisory = (await screen.findByText('Predictive advisory')).closest('section');
    expect(advisory).not.toBeNull();
    expect(within(advisory as HTMLElement).getByText('PREDICTIVE')).toBeInTheDocument();
    // It ranks a different bus, and must say that is not a tie to break.
    expect(within(advisory as HTMLElement).getByText(/is not the bus the engine proposed/i)).toBeInTheDocument();
    expect(within(advisory as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(advisory as HTMLElement).getByText(/configured horizon, not a horizon/i)).toBeInTheDocument();
  });

  it('says the solve was never written down', async () => {
    stubFetch({ approvals: [APPROVAL] });
    renderConsole();
    await screen.findAllByText(/not an audited record/i);
  });

  it('distinguishes "nothing to regulate" from "the filter refused everything"', async () => {
    stubFetch({
      approvals: [],
      recommendation: recommendation({
        selectedAction: null,
        selectionBasis: 'all_candidates_rejected',
        safeCandidates: [],
      }),
    });
    renderConsole();
    await screen.findAllByText(/refused every option/i);
    expectText(/not a quiet corridor/i);
  });

  it('never renders an unreachable engine as "no action needed"', async () => {
    stubFetch({
      approvals: [],
      recommendation: {
        status: 503,
        error: { code: 'CONTROL_SERVICE_UNAVAILABLE', message: 'unreachable' },
      },
    });
    renderConsole();
    await screen.findAllByText(/decision engine is unreachable/i);
    expectText(/may have wanted to act/i);
  });

  it('calls an off-contract answer a version skew, not an outage', async () => {
    // Measured against the captain's own running system: the deployed control
    // service predates the solver fields this console requires, so this is the
    // response the live stack produces today. "Unreachable" would send an
    // engineer to check a service that is up and answering.
    stubFetch({
      approvals: [],
      recommendation: {
        status: 502,
        error: { code: 'CONTROL_SERVICE_ERROR', message: 'Unexpected response shape from /v1/mpc/solve' },
      },
    });
    renderConsole();
    await screen.findAllByText(/shape this console will not accept/i);
    expectText(/older than this console/i);
    expect(screen.queryAllByText(/unreachable/i)).toHaveLength(0);
  });

  it('calls a missing route policy a configuration gap, not an absent recommendation', async () => {
    stubFetch({
      approvals: [],
      recommendation: { status: 404, error: { code: 'NO_ACTIVE_POLICY', message: 'no policy' } },
    });
    renderConsole();
    await screen.findAllByText(/No control policy is configured/i);
    expectText(/configuration gap, not a fault/i);
  });
});

describe('control-room console — a proposal can never issue itself', () => {
  it('offers no issue control when no dispatcher approval authorizes the proposal', async () => {
    stubFetch({ approvals: [] });
    renderConsole();
    await screen.findAllByText(/Proposed: Two-way hold/i);
    expect(screen.queryByTestId('engine-issue')).toBeNull();
    expect(screen.getByTestId('engine-prefill')).toBeInTheDocument();
    expectText(/cannot approve their own proposal/i);
  });

  it('offers no issue control when the approval is for a different vehicle', async () => {
    stubFetch({ approvals: [{ ...APPROVAL, vehicleId: 'UP25FT0000' }] });
    renderConsole();
    await screen.findAllByText(/Proposed: Two-way hold/i);
    expect(screen.queryByTestId('engine-issue')).toBeNull();
  });

  it('offers no issue control while a kill switch halts the corridor', async () => {
    stubFetch({
      approvals: [APPROVAL],
      recommendation: recommendation({
        commandsBlockedBy: {
          scope: 'network',
          routeDirectionId: null,
          reason: 'comms failure',
          engagedAt: new Date().toISOString(),
        },
      }),
    });
    renderConsole();
    await screen.findAllByText(/Proposed: Two-way hold/i);
    expect(screen.queryByTestId('engine-issue')).toBeNull();
    expectText(/Commands are halted for this corridor/i);
  });

  it('withdraws the issue control once the solve has aged past its safety verdict', async () => {
    stubFetch({
      approvals: [APPROVAL],
      recommendation: recommendation({ solvedAt: new Date(Date.now() - 300_000).toISOString() }),
    });
    renderConsole();
    await screen.findAllByText(/Proposed: Two-way hold/i);
    expectText(/This recommendation has expired/i);
    expect(screen.queryByTestId('engine-issue')).toBeNull();
  });

  it('requires a confirmation before anything reaches a driver', async () => {
    const { commandBodies } = stubFetch({ approvals: [APPROVAL] });
    renderConsole();

    fireEvent.click(await screen.findByTestId('engine-issue'));
    // Staging is not issuing. Nothing has been sent yet.
    expect(commandBodies).toHaveLength(0);
    expectText(/Confirm before this reaches the driver/i);
  });

  it('sends exactly the approved triple, against the approval that authorized it', async () => {
    const { commandBodies } = stubFetch({ approvals: [APPROVAL] });
    renderConsole();

    fireEvent.click(await screen.findByTestId('engine-issue'));
    fireEvent.click(screen.getByRole('button', { name: /confirm and issue/i }));

    await waitFor(() => expect(commandBodies).toHaveLength(1));
    const [body] = commandBodies;
    if (!body) throw new Error('no command body captured');
    expect(body.dispatcherActionId).toBe(APPROVAL.id);
    expect(body.actionType).toBe('two_way_hold');
    expect(body.vehicleId).toBe('UP25FT4823');
    expect(body.routeDirectionId).toBe(CORRIDOR);
    // The audit summary is the only surviving record that the engine authored
    // this: the solve itself is not persisted anywhere.
    expect(String(body.summary)).toContain('terminal-two-way-self-equalizing-v1');
    await screen.findAllByText(/Hold issued/i);
  });

  it('surfaces a server refusal rather than claiming the hold went out', async () => {
    stubFetch({
      approvals: [APPROVAL],
      onCommand: () => ({
        ok: false,
        status: 422,
        payload: { error: { code: 'APPROVAL_MISMATCH', message: 'Approval does not match this command.' } },
      }),
    });
    renderConsole();
    fireEvent.click(await screen.findByTestId('engine-issue'));
    fireEvent.click(screen.getByRole('button', { name: /confirm and issue/i }));
    await screen.findAllByText(/Approval does not match this command/i);
    expect(screen.queryAllByText(/Hold issued/i)).toHaveLength(0);
  });

  it('prefills the command form from a proposal instead of making the operator type uuids', async () => {
    stubFetch({ approvals: [] });
    renderConsole();
    fireEvent.click(await screen.findByTestId('engine-prefill'));

    // It switches to the panel that holds the form, and fills it.
    expect(await screen.findByLabelText(/vehicle id/i)).toHaveValue('UP25FT4823');
    expect(screen.getByLabelText(/route-direction id/i)).toHaveValue(CORRIDOR);
    expect(screen.getByLabelText(/action type/i)).toHaveValue('two_way_hold');
    expect((screen.getByLabelText(/summary/i) as HTMLTextAreaElement).value).toContain(
      'terminal-two-way-self-equalizing-v1',
    );
    // Still no approval id: the one field only a dispatcher's decision can
    // supply is left empty rather than invented.
    expect(screen.getByLabelText(/dispatcher action id/i)).toHaveValue('');
  });
});

describe('control-room console — approving from the queue still works', () => {
  it('seeds the command form with the approval the operator approved', async () => {
    stubFetch({ approvals: [APPROVAL] });
    renderConsole({ initialTab: 'approvals' });

    fireEvent.click(await screen.findByRole('button', { name: /approve — issue command/i }));
    expect(screen.getByLabelText(/dispatcher action id/i)).toHaveValue(APPROVAL.id);
  });

  it('still rejects with a mandatory reason', async () => {
    const { fetchMock } = stubFetch({ approvals: [APPROVAL] });
    renderConsole({ initialTab: 'approvals' });

    fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
    const confirm = screen.getByRole('button', { name: /confirm reject/i });
    // Empty reason cannot be submitted.
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/rejection reason/i), { target: { value: 'not warranted' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes(`/api/ops/control-room/approvals/${APPROVAL.id}/reject`) &&
            String((init as RequestInit | undefined)?.body).includes('not warranted'),
        ),
      ).toBe(true);
    });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { DispatcherDashboard } from '@/components/ops/dispatcher/DispatcherDashboard';
import { DispatcherActionForm } from '@/components/ops/dispatcher/DispatcherActionForm';
import { ControlRoomDashboard } from '@/components/ops/control-room/ControlRoomDashboard';
import { ControlRoomCommandForm } from '@/components/ops/control-room/ControlRoomCommandForm';
import { ObservabilityDashboard } from '@/components/ops/control-room/ObservabilityDashboard';
import type { ObservabilitySnapshot } from '@/lib/controlService/observabilityData';
import type { RouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { DepotDashboard } from '@/components/ops/depot/DepotDashboard';
import { PlannerDashboard } from '@/components/ops/planner/PlannerDashboard';
import { DriverDashboard } from '@/components/ops/driver/DriverDashboard';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { DataSourceNotice } from '@/components/ops/DataSourceNotice';
import { BreakdownReportPanel } from '@/components/ops/driver/BreakdownReportPanel';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';
import { OpsAdminInvitesPanel } from '@/components/ops/OpsAdminInvitesPanel';

function bus(overrides: Partial<CanonicalLiveBus> = {}): CanonicalLiveBus {
  return {
    id: 'UP25FT4823',
    registrationNumber: 'UP25FT4823',
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 12,
    headingDegrees: 90,
    depotName: 'Bareilly',
    routeId: 'RT-1',
    routeName: 'Bareilly Express',
    serviceNumber: 'RKD0399',
    tripId: 'trip-1',
    vehicleType: 'AC',
    gpsTimestamp: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ignitionOn: true,
    rawStatus: 'Online',
    tripDate: '2026-08-05',
    dataQuality: 'good',
    ...overrides,
  };
}

function snapshot(overrides: Partial<OpsFleetSnapshot> = {}): OpsFleetSnapshot {
  return {
    buses: [bus()],
    source: 'live',
    stale: false,
    fetchedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

function routeBoardSnapshot(overrides: Partial<RouteOperationsBoardSnapshot> = {}): RouteOperationsBoardSnapshot {
  return {
    source: 'live',
    stale: false,
    error: null,
    fetchedAt: new Date().toISOString(),
    routeDirections: [],
    selectedRouteDirectionId: null,
    vehicles: [],
    headwayPairs: [],
    ...overrides,
  };
}

const NO_ACTIVE_KILL_SWITCHES: KillSwitchRecord[] = [];

// ApprovalQueuePanel (rendered inside DispatcherDashboard/ControlRoomDashboard)
// fetches its queue on mount. Tests below that don't care about that panel's
// own behaviour stub a perpetually-pending fetch so its effect never resolves
// mid-test and triggers a React "not wrapped in act(...)" warning after the
// test has already finished asserting. Tests that DO exercise the approval
// queue (see the ApprovalQueuePanel/KillSwitchPanel describe blocks) override
// this with their own resolving mock and await it with waitFor/findBy*.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DispatcherDashboard', () => {
  it('renders the live fleet status view and the approval/override action form', () => {
    render(<DispatcherDashboard snapshot={snapshot()} query="" routeBoard={routeBoardSnapshot()} activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.getByText('Live fleet status')).toBeInTheDocument();
    expect(screen.getByText('UP25FT4823')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /record approval/i })).toBeInTheDocument();
  });

  it('shows a visible degraded-data notice when the fleet snapshot fell back to a stale cache', () => {
    render(<DispatcherDashboard snapshot={snapshot({ source: 'cache', stale: true, error: 'upstream timed out' })} query="" routeBoard={routeBoardSnapshot()} activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/last known data/i);
  });

  it('shows a visible fixture-fallback notice when the live data source is unavailable', () => {
    render(<DispatcherDashboard snapshot={snapshot({ source: 'fixture', stale: true, error: 'upstream unreachable' })} query="" routeBoard={routeBoardSnapshot()} activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
  });

  it('does not show a data-source notice for a fresh live snapshot', () => {
    render(<DispatcherDashboard snapshot={snapshot()} query="" routeBoard={routeBoardSnapshot()} activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The dispatcher's fleet table is the surface the placeholder-data rule
  // exists to protect: during an upstream outage it must be empty and loudly
  // flagged, not quietly populated with bundled demo buses.
  it('renders an empty, explicitly-flagged fleet table for an unavailable snapshot', () => {
    render(
      <DispatcherDashboard
        snapshot={snapshot({ buses: [], source: 'unavailable', stale: true, error: 'network unreachable' })}
        query=""
        routeBoard={routeBoardSnapshot()}
        activeKillSwitches={NO_ACTIVE_KILL_SWITCHES}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-source', 'unavailable');
    expect(alert).toHaveTextContent(/outage, not an empty fleet/i);
    // No vehicle rows at all, and the empty state says why.
    expect(screen.queryByText('UP25FT4823')).not.toBeInTheDocument();
    expect(screen.getByText(/live feed is unavailable/i)).toBeInTheDocument();
  });
});

// DataSourceNotice has to make three degradations distinguishable at a
// glance, because they mean different things to the person on shift: a stale
// cache is real data that is simply older than it looks, an unavailable feed
// means nothing is being shown at all, and fixture data means the rows on
// screen describe vehicles that do not exist.
describe('DataSourceNotice states', () => {
  it('renders a distinct, visible error state for an unavailable source', () => {
    render(<DataSourceNotice source="unavailable" stale={true} error="network unreachable" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-source', 'unavailable');
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(alert).toHaveTextContent(/upstream feed did not respond/i);
    expect(alert).toHaveTextContent(/outage, not an empty fleet/i);
    expect(alert).toHaveTextContent(/network unreachable/);
    // Must not be mistaken for either of the other two states.
    expect(alert).not.toHaveTextContent(/last known data/i);
    expect(alert).not.toHaveTextContent(/demo\/fixture/i);
  });

  it('renders the stale-cache warning distinctly from the unavailable error', () => {
    render(<DataSourceNotice source="cache" stale={true} error="upstream timed out" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-source', 'cache');
    expect(alert).toHaveAttribute('data-tone', 'warning');
    expect(alert).toHaveTextContent(/last known data/i);
    expect(alert).not.toHaveTextContent(/outage/i);
  });

  it('renders the fixture notice distinctly, saying the vehicles are not real', () => {
    render(<DataSourceNotice source="fixture" stale={true} error="upstream unreachable" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-source', 'fixture');
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(alert).toHaveTextContent(/these vehicles are not real/i);
  });

  it('stays silent for live data and for a fresh cache hit', () => {
    const { unmount } = render(<DataSourceNotice source="live" stale={false} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    render(<DataSourceNotice source="cache" stale={false} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ControlRoomDashboard', () => {
  it('renders the live fleet status view and the issue-command action form', () => {
    render(<ControlRoomDashboard snapshot={snapshot()} query="" activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.getByText('Live fleet status')).toBeInTheDocument();
    expect(screen.getByText('UP25FT4823')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issue command/i })).toBeInTheDocument();
  });

  it('links to the live observability dashboard', () => {
    render(<ControlRoomDashboard snapshot={snapshot()} query="" activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    const link = screen.getByRole('link', { name: /live observability/i });
    expect(link).toHaveAttribute('href', '/ops/control-room/observability');
  });
});

function observabilitySnapshot(overrides: Partial<ObservabilitySnapshot> = {}): ObservabilitySnapshot {
  return {
    source: 'live',
    stale: false,
    error: null,
    fetchedAt: new Date().toISOString(),
    routeDirections: [{ routeDirectionId: 'dir-1', routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 }],
    selectedRouteDirectionId: 'dir-1',
    positions: [
      {
        vehicleId: 'V1',
        tripId: null,
        routeDirectionId: 'dir-1',
        distanceAlongRouteMeters: 500,
        speedKmph: 18,
        stopState: 'off_route',
        currentStopId: null,
        confidence: 0.9,
        observedAt: new Date().toISOString(),
      },
    ],
    headway: {
      routeDirectionId: 'dir-1',
      computedAt: new Date().toISOString(),
      pairs: [],
      aggregate: {
        routeDirectionId: 'dir-1',
        sampleCount: 2,
        meanHeadwaySeconds: 240,
        stddevHeadwaySeconds: 40,
        cv: 0.17,
        ewtSeconds: 12,
        targetHeadwaySeconds: 300,
      },
      incidents: [],
    },
    incidents: [
      {
        id: 'inc-1',
        routeDirectionId: 'dir-1',
        members: [
          { vehicleId: 'V1', role: 'leader' },
          { vehicleId: 'V2', role: 'follower' },
        ],
        severity: 'bunched',
        causeClass: 'endogenous',
        controllability: 'controllable',
        status: 'open',
        startedAt: new Date().toISOString(),
        endedAt: null,
        evidence: { ratio: 0.2 },
      },
    ],
    ...overrides,
  };
}

describe('ObservabilityDashboard', () => {
  it('shows live positions with a LIVE badge and active incidents distinctly from the headway summary', () => {
    render(<ObservabilityDashboard snapshot={observabilitySnapshot()} now={Date.now()} />);

    expect(screen.getByText('V1')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Excess Wait Time')).toBeInTheDocument();
    expect(screen.getByText('Bunched')).toBeInTheDocument();
    expect(screen.getByText(/V1 \(leader\), V2 \(follower\)/)).toBeInTheDocument();
  });

  it('renders a STALE badge for a position observed well outside the freshness window', () => {
    const now = Date.now();
    const stalePositions: ObservabilitySnapshot['positions'] = [
      {
        vehicleId: 'V9',
        tripId: null,
        routeDirectionId: 'dir-1',
        distanceAlongRouteMeters: 100,
        speedKmph: 5,
        stopState: 'off_route',
        currentStopId: null,
        confidence: 0.5,
        observedAt: new Date(now - 5 * 60_000).toISOString(),
      },
    ];
    render(<ObservabilityDashboard snapshot={observabilitySnapshot({ positions: stalePositions })} now={now} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('shows the control-service-unavailable notice when the snapshot could not be refreshed', () => {
    render(
      <ObservabilityDashboard
        snapshot={observabilitySnapshot({ source: 'unavailable', stale: true, error: 'control service circuit open' })}
        now={Date.now()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/last known control-service data/i);
  });
});

describe('DepotDashboard', () => {
  const BAREILLY_SCOPE = { kind: 'depot', depotCode: 'BAREILLY', depotName: 'Bareilly' } as const;

  it('renders the vehicle roster for the scoped depot plus a schedule lookup', () => {
    // Already scoped by the page — this component does no filtering of its
    // own (see its doc comment for why a second filter here would be a
    // liability rather than defence in depth).
    const buses = [bus({ id: 'a', depotName: 'Bareilly' }), bus({ id: 'b', registrationNumber: 'UP32AB1234', depotName: 'Bareilly' })];
    render(
      <DepotDashboard
        snapshot={snapshot({ buses })}
        routeBoard={routeBoardSnapshot()}
        activeKillSwitches={NO_ACTIVE_KILL_SWITCHES}
        scope={BAREILLY_SCOPE}
      />,
    );
    expect(screen.getByText(/Vehicle roster · Bareilly/)).toBeInTheDocument();
    expect(screen.getAllByText(/Bareilly/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /vehicle schedule lookup/i })).toBeInTheDocument();
  });

  it('names the depot rather than "all depots" on the route operations board', () => {
    render(
      <DepotDashboard
        snapshot={snapshot({ buses: [bus({ id: 'a', depotName: 'Bareilly' })] })}
        routeBoard={routeBoardSnapshot()}
        activeKillSwitches={NO_ACTIVE_KILL_SWITCHES}
        scope={BAREILLY_SCOPE}
      />,
    );
    // The old dashboard hardcoded depotLabel="all depots", which was an
    // accurate description of an unscoped view and would now be a lie.
    expect(screen.queryByText(/all depots/i)).not.toBeInTheDocument();
  });

  // The map counts what it draws from the list it was handed, which the page
  // narrowed server-side. If a statewide list ever reached this component the
  // caption would say so out loud, which is the point of captioning a count
  // rather than a boundary name alone.
  it('puts the scoped fleet on a map captioned with the depot and its own count', () => {
    const buses = [bus({ id: 'a', depotName: 'Bareilly' }), bus({ id: 'b', registrationNumber: 'UP32AB1234', depotName: 'Bareilly' })];
    render(
      <DepotDashboard
        snapshot={snapshot({ buses })}
        routeBoard={routeBoardSnapshot()}
        activeKillSwitches={NO_ACTIVE_KILL_SWITCHES}
        scope={BAREILLY_SCOPE}
      />,
    );
    expect(screen.getByRole('heading', { name: /live map · bareilly/i })).toBeInTheDocument();
    expect(screen.getByText('Bareilly · 2 vehicles')).toBeInTheDocument();
  });
});

describe('PlannerDashboard', () => {
  it('renders a roster grouped by route plus a schedule lookup', () => {
    const buses = [bus({ id: 'a', routeId: 'RT-1', routeName: 'Route One' }), bus({ id: 'b', registrationNumber: 'UP32AB1234', routeId: 'RT-2', routeName: 'Route Two' })];
    render(<PlannerDashboard snapshot={snapshot({ buses })} />);
    expect(screen.getByText('Route roster')).toBeInTheDocument();
    expect(screen.getAllByText(/Route One/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Route Two/).length).toBeGreaterThan(0);
  });
});

describe('DriverDashboard', () => {
  it('renders the narrower own-schedule + breakdown-report scope, with no fleet-wide table', () => {
    render(<DriverDashboard />);
    expect(screen.getByText('My schedule')).toBeInTheDocument();
    expect(screen.getByText('Report a breakdown')).toBeInTheDocument();
    expect(screen.queryByText('Live fleet status')).not.toBeInTheDocument();
  });

  it('with no admin-assigned vehicle, falls back to the self-reported/remembered registration convention', () => {
    render(<DriverDashboard />);
    expect(screen.getByLabelText(/registration number/i)).toHaveValue('');
    expect(screen.getByLabelText(/vehicle/i)).toHaveValue('');
  });

  it('with an admin-assigned vehicle, prefills the schedule lookup and breakdown vehicle field from it instead of localStorage', () => {
    window.localStorage.setItem('ops.driver.vehicleReg', 'UP99ZZ0000');

    render(<DriverDashboard assignedVehicleId="UP25FT4823" />);

    expect(screen.getByLabelText(/registration number/i)).toHaveValue('UP25FT4823');
    expect(screen.getByLabelText(/vehicle/i)).toHaveValue('UP25FT4823');

    window.localStorage.removeItem('ops.driver.vehicleReg');
  });
});

describe('DispatcherActionForm action flow', () => {
  it('submits to POST /api/ops/dispatcher/approvals and shows the returned dispatcherActionId on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, dispatcherActionId: 'action-123', createdAt: '2026-08-05T00:00:00.000Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DispatcherActionForm />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Bunching detected, holding vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: /record approval/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('action-123'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/dispatcher/approvals',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a visible error when the approval endpoint rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'INVALID_BODY', message: 'A valid actionType and reason are required.' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DispatcherActionForm />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /record approval/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/actionType and reason/i));
  });
});

// The form's fields changed with the endpoint's contract: the old
// {targetType, targetId} pair is gone, replaced by an explicit vehicleId AND
// routeDirectionId, both always sent. That is a deliberate widening of what
// the request must state, not a cosmetic rename — the route-scoped kill
// switch used to be consulted only when targetType happened to be
// 'route_direction', so a vehicle-targeted command on a killed route went
// straight through it, and control-service's rollout gate resolves the
// route-direction it gates on from the same value. The response gained
// commandId/expiresAt because the command is now really created.
describe('ControlRoomCommandForm action flow', () => {
  function fillCommandForm() {
    fireEvent.change(screen.getByLabelText(/dispatcher action id/i), { target: { value: 'da-1' } });
    fireEvent.change(screen.getByLabelText(/vehicle id/i), { target: { value: 'UP25FT4823' } });
    fireEvent.change(screen.getByLabelText(/route-direction id/i), { target: { value: 'rd-1' } });
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: 'Hold at terminal per approval' } });
  }

  it('submits to POST /api/ops/control-room/commands and shows the returned commandId and auditEventId on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        commandId: 'cmd-789',
        expiresAt: '2026-08-05T00:02:00.000Z',
        auditEventId: 'audit-456',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fillCommandForm();
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('audit-456'));
    // The commandId is the operator's handle on a command that now really
    // exists in the control service, so it has to be surfaced, not just the
    // audit id.
    expect(screen.getByRole('status')).toHaveTextContent('cmd-789');

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const sent = JSON.parse(init.body) as Record<string, unknown>;
    expect(sent).toMatchObject({
      dispatcherActionId: 'da-1',
      vehicleId: 'UP25FT4823',
      routeDirectionId: 'rd-1',
      actionType: 'self_equalizing_hold',
    });
    expect(sent).not.toHaveProperty('targetType');
    expect(sent).not.toHaveProperty('targetId');
  });

  it('promises an automatic retry only when status is "authorized" — the one status commandDeliverySweep actually retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        commandId: 'cmd-790',
        expiresAt: '2026-08-05T00:02:00.000Z',
        auditEventId: 'audit-457',
        status: 'authorized',
        deliveredAt: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fillCommandForm();
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/will retry automatically/i));
  });

  it('never claims an automatic retry for a reconciled status the sweep does not touch (e.g. already acknowledged)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        commandId: 'cmd-791',
        expiresAt: '2026-08-05T00:02:00.000Z',
        auditEventId: 'audit-458',
        status: 'acknowledged',
        deliveredAt: '2026-08-05T00:00:30.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fillCommandForm();
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/current status: acknowledged/i));
    expect(screen.getByRole('status')).not.toHaveTextContent(/will retry automatically/i);
  });

  it('never offers "override" as a dispatchable action type', () => {
    // An override is recorded, never dispatched: control-service's
    // commands.action_type CHECK does not include it, and widening that CHECK
    // would let an unmodelled action reach applyHardSafetyFilter, which
    // switches on actionType and has no 'override' case.
    render(<ControlRoomCommandForm />);
    const options = Array.from(
      (screen.getByLabelText(/action type/i) as HTMLSelectElement).options,
    ).map((option) => option.value);

    expect(options).not.toContain('override');
    expect(options).toContain('self_equalizing_hold');
  });

  it('surfaces a 409 dispatcher-action-invalid error from the endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'DISPATCHER_ACTION_INVALID', message: 'dispatcherActionId does not reference a valid, unconsumed approval.' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fillCommandForm();
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/unconsumed approval/i));
  });

  it('surfaces a 422 APPROVAL_MISMATCH, which only this app can detect', async () => {
    // control-service only ever sees the payload this app builds, so the
    // "does this command match the approval it cites?" check has no other
    // possible home.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: 'APPROVAL_MISMATCH',
          message: 'Approval da-1 authorizes stop_skip for vehicle UP25FT4823 on route-direction rd-1; this command does not match it.',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fillCommandForm();
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/does not match it/i));
  });
});

describe('ScheduleLookupForm action flow', () => {
  it('loads and renders a vehicle schedule from GET /api/ops/fleet/schedule', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schedule: {
          registrationNumber: 'UP25FT4823',
          date: '2026-08-05',
          routeId: 'RT-1',
          routeName: 'Bareilly Express',
          originName: 'Bareilly',
          destinationName: 'Rudrapur',
          tripId: 'trip-1',
          scheduledDeparture: '10:06:00',
          scheduledArrival: '12:00:00',
          direction: 'OUT',
          tripCount: 1,
          stops: [{ id: 'stop-1', name: 'Bareilly Old Bus Station', sequence: 1, latitude: 28.35, longitude: 79.42, scheduledArrival: '10:06:00', scheduledDeparture: '10:06:00' }],
        },
        source: 'live',
        stale: false,
        error: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScheduleLookupForm />);
    fireEvent.change(screen.getByLabelText(/registration number/i), { target: { value: 'UP25FT4823' } });
    fireEvent.click(screen.getByRole('button', { name: /load schedule/i }));

    await waitFor(() => expect(screen.getByText(/Bareilly Old Bus Station/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/ops/fleet/schedule?regNum=UP25FT4823'));
  });

  it('shows the "no schedule" message when the vehicle has no assignment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schedule: null, source: 'live', stale: false, error: null, message: 'No schedule assigned to UP25FT4823.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScheduleLookupForm />);
    fireEvent.change(screen.getByLabelText(/registration number/i), { target: { value: 'UP25FT4823' } });
    fireEvent.click(screen.getByRole('button', { name: /load schedule/i }));

    await waitFor(() => expect(screen.getByText(/No schedule assigned to UP25FT4823/)).toBeInTheDocument());
  });

  it('requires a registration number before submitting', () => {
    render(<ScheduleLookupForm />);
    fireEvent.click(screen.getByRole('button', { name: /load schedule/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a registration number/i);
  });

  // "No schedule found for this vehicle" is a statement about the roster. An
  // unreachable upstream must never be reported that way — it is a statement
  // about the network, and the difference decides whether a depot goes
  // looking for a missing assignment or for a missing feed.
  it('reports an unavailable schedule feed as an outage, not as "no assignment"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schedule: null,
        source: 'unavailable',
        stale: true,
        error: 'network unreachable',
        message: 'Live schedule data is unavailable — the upstream did not answer.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScheduleLookupForm />);
    fireEvent.change(screen.getByLabelText(/registration number/i), { target: { value: 'UP25FT4823' } });
    fireEvent.click(screen.getByRole('button', { name: /load schedule/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-source', 'unavailable');
    expect(alert).toHaveTextContent(/could not ask/i);
    expect(screen.queryByText(/No schedule found for this vehicle/i)).not.toBeInTheDocument();
  });

  it('says plainly that a fixture schedule is not real', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schedule: null,
        source: 'fixture',
        stale: true,
        error: 'network unreachable',
        message: 'Showing UPSRTC fixture fallback.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScheduleLookupForm />);
    fireEvent.change(screen.getByLabelText(/registration number/i), { target: { value: 'UP25FT4823' } });
    fireEvent.click(screen.getByRole('button', { name: /load schedule/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/this schedule is not real/i);
  });
});

describe('BreakdownReportPanel action flow', () => {
  it('submits to POST /api/ops/driver/breakdown-reports and shows the returned breakdownReportId plus a read-out summary on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, breakdownReportId: 'report-789', createdAt: '2026-08-06T00:00:00.000Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BreakdownReportPanel defaultVehicleReg="UP25FT4823" />);
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: 'Engine overheating near KM 12' } });
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    const summary = await screen.findByRole('status');
    expect(within(summary).getByText(/report-789/)).toBeInTheDocument();
    expect(within(summary).getByText(/UP25FT4823/)).toBeInTheDocument();
    expect(within(summary).getByText(/Engine overheating near KM 12/)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/driver/breakdown-reports',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a visible error when the breakdown-report endpoint rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 'INVALID_BODY', message: 'A valid vehicleReg, category and description are required.' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BreakdownReportPanel defaultVehicleReg="UP25FT4823" />);
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: 'Engine overheating near KM 12' } });
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/vehicleReg, category and description/i));
  });
});

function breakdownReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'br-1',
    driverUserId: 'driver-1',
    vehicleReg: 'UP25FT4823',
    category: 'Mechanical',
    description: 'Engine overheating near KM 12',
    createdAt: '2026-08-06T00:00:00.000Z',
    reporterName: 'Driver One',
    reporterEmail: 'driver1@example.com',
    ...overrides,
  };
}

describe('BreakdownReportsPanel', () => {
  it('scope="fleet" loads from GET /api/ops/fleet/breakdown-reports and shows the reporter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reports: [breakdownReport()], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BreakdownReportsPanel scope="fleet" />);

    await waitFor(() => expect(screen.getByText('Engine overheating near KM 12')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/fleet/breakdown-reports',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(screen.getByText(/reported by Driver One/)).toBeInTheDocument();
    // Even when the fleet payload happens to carry reporterEmail (as this
    // test's own fixture does), the fleet view must never display it.
    expect(screen.queryByText(/driver1@example\.com/)).not.toBeInTheDocument();
  });

  it('scope="mine" loads from GET /api/ops/driver/breakdown-reports and omits the reporter line', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reports: [breakdownReport()], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BreakdownReportsPanel scope="mine" />);

    await waitFor(() => expect(screen.getByText('Engine overheating near KM 12')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/driver/breakdown-reports',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(screen.queryByText(/reported by/)).not.toBeInTheDocument();
  });

  it('shows a scope-appropriate empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reports: [], nextCursor: null }) }));
    render(<BreakdownReportsPanel scope="mine" />);
    await waitFor(() => expect(screen.getByText(/you have not filed any breakdown reports/i)).toBeInTheDocument());
  });

  it('shows a visible error when the endpoint rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Your role does not permit this action.' } }),
      }),
    );
    render(<BreakdownReportsPanel scope="fleet" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/does not permit/i));
  });

  it('fetches the next page with the cursor when "Load more" is clicked', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/ops/fleet/breakdown-reports') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ reports: [breakdownReport()], nextCursor: '2026-08-05T00:00:00.000Z' }),
        });
      }
      if (url === `/api/ops/fleet/breakdown-reports?before=${encodeURIComponent('2026-08-05T00:00:00.000Z')}`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ reports: [breakdownReport({ id: 'br-2', description: 'Flat tyre' })], nextCursor: null }),
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BreakdownReportsPanel scope="fleet" />);
    await waitFor(() => expect(screen.getByText('Engine overheating near KM 12')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText('Flat tyre')).toBeInTheDocument());
    expect(screen.getByText('Engine overheating near KM 12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});

describe('DriverDashboard breakdown-reports refresh-after-submit', () => {
  it('refetches the "mine" breakdown-reports list after a successful submit, so a filed report is not left showing stale data', async () => {
    let getCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/ops/driver/breakdown-reports' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, breakdownReportId: 'report-789', createdAt: '2026-08-06T00:00:00.000Z' }),
        });
      }
      if (url === '/api/ops/driver/breakdown-reports') {
        getCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ reports: getCalls > 1 ? [breakdownReport()] : [], nextCursor: null }),
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DriverDashboard assignedVehicleId="UP25FT4823" />);

    await waitFor(() => expect(screen.getByText(/you have not filed any breakdown reports/i)).toBeInTheDocument());
    expect(getCalls).toBe(1);

    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: 'Engine overheating near KM 12' } });
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await screen.findByRole('status');
    await waitFor(() => expect(getCalls).toBe(2));
    await waitFor(() => expect(screen.getByText('Engine overheating near KM 12')).toBeInTheDocument());
  });
});

describe('OpsAdminInvitesPanel vehicle assignment', () => {
  function usersResponse() {
    return {
      users: [
        {
          id: 'user-driver-1',
          email: 'driver1@olympuss.us',
          name: 'Driver One',
          role: 'driver',
          status: 'active',
          vehicleId: 'UP25FT4823',
          depotId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'user-dispatcher-1',
          email: 'dispatcher1@olympuss.us',
          name: 'Dispatcher One',
          role: 'dispatcher',
          status: 'active',
          vehicleId: null,
          depotId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'user-depot-1',
          email: 'depot1@olympuss.us',
          name: 'Depot One',
          role: 'depot',
          status: 'active',
          vehicleId: null,
          depotId: DEPOT_BAREILLY_ID,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
  }

  const DEPOT_BAREILLY_ID = 'aaaaaaaa-0000-4000-8000-00000000bbbb';
  const DEPOT_LUCKNOW_ID = 'cccccccc-0000-4000-8000-00000000dddd';

  function depotsResponse() {
    return {
      depots: [
        { id: DEPOT_BAREILLY_ID, code: 'BAREILLY', name: 'Bareilly' },
        { id: DEPOT_LUCKNOW_ID, code: 'LUCKNOW', name: 'Lucknow' },
      ],
    };
  }

  function routeFetch(
    onVehiclePost: (body: unknown) => { ok: boolean; json: unknown },
    onDepotPost: (body: unknown) => { ok: boolean; json: unknown } = () => ({
      ok: true,
      json: { ok: true, id: 'user-depot-1', depotId: DEPOT_LUCKNOW_ID },
    }),
  ) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/ops/admin/users' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => usersResponse() };
      }
      if (url === '/api/ops/admin/invites' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ invites: [] }) };
      }
      if (url === '/api/ops/admin/depots' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => depotsResponse() };
      }
      if (url === '/api/ops/admin/users/user-depot-1/depot' && init?.method === 'POST') {
        const result = onDepotPost(JSON.parse(String(init.body)));
        return { ok: result.ok, json: async () => result.json };
      }
      if (url === '/api/ops/admin/users/user-driver-1/vehicle' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const result = onVehiclePost(body);
        return { ok: result.ok, json: async () => result.json };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  it('renders each driver/pilot_driver row with its current vehicleId and no assignment control for other roles', async () => {
    const fetchMock = routeFetch(() => ({ ok: true, json: { ok: true, vehicleId: null } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<OpsAdminInvitesPanel />);

    expect(await screen.findByDisplayValue('UP25FT4823')).toBeInTheDocument();
    // A dispatcher is neither vehicle- nor depot-assignable, so that row
    // carries a placeholder in both columns and no control in either.
    const dispatcherRow = (await screen.findByText('Dispatcher One')).closest('tr')!;
    expect(within(dispatcherRow).getAllByText('—')).toHaveLength(2);
    expect(within(dispatcherRow).queryByLabelText(/assign vehicle/i)).not.toBeInTheDocument();
    expect(within(dispatcherRow).queryByLabelText(/assign depot/i)).not.toBeInTheDocument();
  });

  it('offers a depot picker only for depot-role rows, preselected to the current assignment', async () => {
    vi.stubGlobal('fetch', routeFetch(() => ({ ok: true, json: { ok: true, vehicleId: null } })));
    render(<OpsAdminInvitesPanel />);

    const select = (await screen.findByLabelText(/assign depot/i)) as HTMLSelectElement;
    expect(select.value).toBe(DEPOT_BAREILLY_ID);
    // One picker in the whole table: only the depot-role row gets one.
    expect(screen.getAllByLabelText(/assign depot/i)).toHaveLength(1);
  });

  it('posts the chosen depot id to POST /api/ops/admin/users/:id/depot', async () => {
    const seen: unknown[] = [];
    const fetchMock = routeFetch(
      () => ({ ok: true, json: { ok: true, vehicleId: null } }),
      (body) => {
        seen.push(body);
        return { ok: true, json: { ok: true, id: 'user-depot-1', depotId: DEPOT_LUCKNOW_ID } };
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<OpsAdminInvitesPanel />);

    const select = await screen.findByLabelText(/assign depot/i);
    fireEvent.change(select, { target: { value: DEPOT_LUCKNOW_ID } });

    await waitFor(() => expect(seen).toEqual([{ depotId: DEPOT_LUCKNOW_ID }]));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/admin/users/user-depot-1/depot',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends null to unassign a depot', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      routeFetch(
        () => ({ ok: true, json: { ok: true, vehicleId: null } }),
        (body) => {
          seen.push(body);
          return { ok: true, json: { ok: true, id: 'user-depot-1', depotId: null } };
        },
      ),
    );
    render(<OpsAdminInvitesPanel />);

    fireEvent.change(await screen.findByLabelText(/assign depot/i), { target: { value: '' } });
    await waitFor(() => expect(seen).toEqual([{ depotId: null }]));
  });

  it('shows a visible error when the depot-assignment endpoint rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(
        () => ({ ok: true, json: { ok: true, vehicleId: null } }),
        () => ({ ok: false, json: { error: { code: 'DEPOT_NOT_FOUND', message: 'Depot not found.' } } }),
      ),
    );
    render(<OpsAdminInvitesPanel />);

    fireEvent.change(await screen.findByLabelText(/assign depot/i), { target: { value: DEPOT_LUCKNOW_ID } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Depot not found.'));
  });

  it('submits to POST /api/ops/admin/users/:id/vehicle and shows a saved confirmation on success', async () => {
    const fetchMock = routeFetch((body) => {
      expect(body).toEqual({ vehicleId: 'UP25FT9999' });
      return { ok: true, json: { ok: true, id: 'user-driver-1', vehicleId: 'UP25FT9999' } };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<OpsAdminInvitesPanel />);

    const input = await screen.findByDisplayValue('UP25FT4823');
    fireEvent.change(input, { target: { value: 'UP25FT9999' } });
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/admin/users/user-driver-1/vehicle',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends null when the input is cleared, to unassign the vehicle', async () => {
    const fetchMock = routeFetch((body) => {
      expect(body).toEqual({ vehicleId: null });
      return { ok: true, json: { ok: true, id: 'user-driver-1', vehicleId: null } };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<OpsAdminInvitesPanel />);

    const input = await screen.findByDisplayValue('UP25FT4823');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  });

  it('shows a visible error when the vehicle-assignment endpoint rejects the request', async () => {
    const fetchMock = routeFetch(() => ({
      ok: false,
      json: { error: { code: 'NOT_FOUND', message: 'User not found.' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<OpsAdminInvitesPanel />);

    const input = await screen.findByDisplayValue('UP25FT4823');
    fireEvent.change(input, { target: { value: 'UP25FT9999' } });
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('User not found.'));
  });
});

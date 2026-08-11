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
  it('renders a vehicle roster grouped by depot plus a schedule lookup', () => {
    const buses = [bus({ id: 'a', depotName: 'Bareilly' }), bus({ id: 'b', registrationNumber: 'UP32AB1234', depotName: 'Lucknow' })];
    render(<DepotDashboard snapshot={snapshot({ buses })} routeBoard={routeBoardSnapshot()} activeKillSwitches={NO_ACTIVE_KILL_SWITCHES} />);
    expect(screen.getByText('Vehicle roster by depot')).toBeInTheDocument();
    expect(screen.getAllByText(/Bareilly/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lucknow/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /vehicle schedule lookup/i })).toBeInTheDocument();
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
          createdAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'user-dispatcher-1',
          email: 'dispatcher1@olympuss.us',
          name: 'Dispatcher One',
          role: 'dispatcher',
          status: 'active',
          vehicleId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
  }

  function routeFetch(onVehiclePost: (body: unknown) => { ok: boolean; json: unknown }) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/ops/admin/users' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => usersResponse() };
      }
      if (url === '/api/ops/admin/invites' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ invites: [] }) };
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
    const dispatcherRow = (await screen.findByText('Dispatcher One')).closest('tr')!;
    expect(within(dispatcherRow).getByText('—')).toBeInTheDocument();
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

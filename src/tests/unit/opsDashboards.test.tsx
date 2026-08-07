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

describe('ControlRoomCommandForm action flow', () => {
  it('submits to POST /api/ops/control-room/commands and shows the returned auditEventId on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, auditEventId: 'audit-456', createdAt: '2026-08-05T00:00:00.000Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fireEvent.change(screen.getByLabelText(/dispatcher action id/i), { target: { value: 'da-1' } });
    fireEvent.change(screen.getByLabelText(/target id/i), { target: { value: 'UP25FT4823' } });
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: 'Hold at terminal per approval' } });
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('audit-456'));
  });

  it('surfaces a 409 dispatcher-action-invalid error from the endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'DISPATCHER_ACTION_INVALID', message: 'dispatcherActionId does not reference a valid, unconsumed approval.' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControlRoomCommandForm />);
    fireEvent.change(screen.getByLabelText(/dispatcher action id/i), { target: { value: 'already-used' } });
    fireEvent.change(screen.getByLabelText(/target id/i), { target: { value: 'UP25FT4823' } });
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: 'Hold at terminal' } });
    fireEvent.click(screen.getByRole('button', { name: /issue command/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/unconsumed approval/i));
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

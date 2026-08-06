// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { DispatcherDashboard } from '@/components/ops/dispatcher/DispatcherDashboard';
import { DispatcherActionForm } from '@/components/ops/dispatcher/DispatcherActionForm';
import { ControlRoomDashboard } from '@/components/ops/control-room/ControlRoomDashboard';
import { ControlRoomCommandForm } from '@/components/ops/control-room/ControlRoomCommandForm';
import { DepotDashboard } from '@/components/ops/depot/DepotDashboard';
import { PlannerDashboard } from '@/components/ops/planner/PlannerDashboard';
import { DriverDashboard } from '@/components/ops/driver/DriverDashboard';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { BreakdownReportPanel } from '@/components/ops/driver/BreakdownReportPanel';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DispatcherDashboard', () => {
  it('renders the live fleet status view and the approval/override action form', () => {
    render(<DispatcherDashboard snapshot={snapshot()} query="" />);
    expect(screen.getByText('Live fleet status')).toBeInTheDocument();
    expect(screen.getByText('UP25FT4823')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /record approval/i })).toBeInTheDocument();
  });

  it('shows a visible degraded-data notice when the fleet snapshot fell back to a stale cache', () => {
    render(<DispatcherDashboard snapshot={snapshot({ source: 'cache', stale: true, error: 'upstream timed out' })} query="" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/last known data/i);
  });

  it('shows a visible fixture-fallback notice when the live data source is unavailable', () => {
    render(<DispatcherDashboard snapshot={snapshot({ source: 'fixture', stale: true, error: 'upstream unreachable' })} query="" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
  });

  it('does not show a data-source notice for a fresh live snapshot', () => {
    render(<DispatcherDashboard snapshot={snapshot()} query="" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ControlRoomDashboard', () => {
  it('renders the live fleet status view and the issue-command action form', () => {
    render(<ControlRoomDashboard snapshot={snapshot()} query="" />);
    expect(screen.getByText('Live fleet status')).toBeInTheDocument();
    expect(screen.getByText('UP25FT4823')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issue command/i })).toBeInTheDocument();
  });
});

describe('DepotDashboard', () => {
  it('renders a vehicle roster grouped by depot plus a schedule lookup', () => {
    const buses = [bus({ id: 'a', depotName: 'Bareilly' }), bus({ id: 'b', registrationNumber: 'UP32AB1234', depotName: 'Lucknow' })];
    render(<DepotDashboard snapshot={snapshot({ buses })} />);
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

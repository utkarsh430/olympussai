// @vitest-environment jsdom
//
// The mounted ops map panel: what it says when it can draw, and what it says
// when it cannot.
//
// There is no Google basemap in a test process and there never will be, which
// is exactly the state a misconfigured or offline deployment is in. The
// properties worth holding are therefore about honesty rather than pixels: the
// caption names the boundary and the count the operator is actually looking
// at, a missing basemap points at the tables instead of failing the page, and
// incidents that could not be placed are declared rather than quietly missing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpsFleetMapPanel } from '@/components/ops/map/OpsFleetMapPanel';
import { toOpsMapVehicles } from '@/lib/ops/mapVehicles';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { BunchingIncident } from '@/models/control';

function bus(id: string, latitude = 28.3, longitude = 79.4): CanonicalLiveBus {
  return {
    id,
    registrationNumber: id,
    latitude,
    longitude,
    speedKmph: 20,
    headingDegrees: 90,
    depotName: 'Bareilly',
    routeId: 'RT-1',
    routeName: 'Route 1',
    serviceNumber: 'S1',
    tripId: 'T1',
    vehicleType: null,
    gpsTimestamp: '2026-08-12T06:00:00Z',
    lastUpdatedAt: '2026-08-12T06:00:00Z',
    ignitionOn: true,
    rawStatus: 'RUNNING',
    tripDate: '2026-08-12',
    dataQuality: 'good',
  };
}

function incident(id: string, members: string[]): BunchingIncident {
  return {
    id,
    routeDirectionId: 'rd-1',
    members: members.map((vehicleId, index) => ({
      vehicleId,
      role: index === 0 ? ('leader' as const) : ('follower' as const),
    })),
    severity: 'bunched',
    causeClass: 'endogenous',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-12T06:00:00Z',
    endedAt: null,
    evidence: {},
  };
}

const twoVehicles = toOpsMapVehicles([bus('A'), bus('B', 28.4, 79.5)]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpsFleetMapPanel', () => {
  it('captions the boundary and the count it is actually showing', () => {
    render(<OpsFleetMapPanel vehicles={twoVehicles} scopeLabel="Bareilly" />);
    expect(screen.getByText('Bareilly · 2 vehicles')).toBeInTheDocument();
  });

  // The control room deliberately takes no server-side vehicle read - the
  // statewide roster is thousands of rows and does not belong in the page
  // payload - so it mounts unseeded. Captioned "all depots · 0 vehicles" it
  // contradicted the status band's own "VEHICLES REPORTING 9,181" for the
  // first fifteen seconds of every visit.
  it('does not claim a count it has not taken yet', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<OpsFleetMapPanel vehicles={null} scopeLabel="all depots" live />);
    expect(screen.getByText('all depots · counting vehicles…')).toBeInTheDocument();
    expect(screen.queryByText(/0 vehicles/)).not.toBeInTheDocument();
    // The freshness legend beside the caption was making the same claim.
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.queryByText('Fresh 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale 0')).not.toBeInTheDocument();
  });

  // An empty ARRAY is still a measurement. A depot whose buses are all in the
  // shed genuinely has none reporting, and "counting…" forever would be its
  // own lie.
  it('still reports a measured empty fleet as zero', () => {
    render(<OpsFleetMapPanel vehicles={[]} scopeLabel="Bareilly" />);
    expect(screen.getByText('Bareilly · 0 vehicles')).toBeInTheDocument();
  });

  it('says one vehicle rather than 1 vehicles', () => {
    render(<OpsFleetMapPanel vehicles={toOpsMapVehicles([bus('A')])} scopeLabel="Bareilly" />);
    expect(screen.getByText('Bareilly · 1 vehicle')).toBeInTheDocument();
  });

  // A control room with no basemap still has a working shift. The map says so
  // and points at the surface that still works, rather than taking the page
  // down or showing an empty grey rectangle.
  it('degrades to a stated failure that points at the tables', () => {
    render(<OpsFleetMapPanel vehicles={twoVehicles} scopeLabel="Bareilly" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/map unavailable/i);
    expect(alert).toHaveTextContent(/still listed in the tables/i);
  });

  // ─── THE MAP DRAWS ONE INCIDENT, NOT ALL OF THEM ───────────────────────
  //
  // It used to draw every open incident at once. On the statewide console that
  // was a web of hundreds of dashed links across Uttar Pradesh, which is what
  // let a real detector failure - incidents that never closed, linking buses a
  // median of 59 km apart - hide in plain sight for as long as it did. The
  // list beside the map is the index; the map answers one question at a time.
  it('draws nothing until an incident is selected, and says the list is there', () => {
    render(
      <OpsFleetMapPanel
        vehicles={twoVehicles}
        incidents={[incident('inc-1', ['A', 'B']), incident('inc-2', ['A', 'B'])]}
        scopeLabel="Bareilly"
      />,
    );
    expect(
      screen.getByText('2 incidents on this corridor. Select one to see it on the map.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Showing 1 of/)).not.toBeInTheDocument();
  });

  it('says which one of the corridor’s incidents is on the map', () => {
    render(
      <OpsFleetMapPanel
        vehicles={twoVehicles}
        incidents={[incident('inc-1', ['A', 'B']), incident('inc-2', ['A', 'B'])]}
        selectedIncidentId="inc-1"
        scopeLabel="Bareilly"
      />,
    );
    expect(screen.getByText('Showing 1 of 2 incidents on this corridor.')).toBeInTheDocument();
  });

  // A click that draws nothing must not look like a broken click.
  it('says so when the selected incident’s buses cannot be placed', () => {
    render(
      <OpsFleetMapPanel
        vehicles={twoVehicles}
        incidents={[incident('inc-foreign', ['SOMEONE_ELSE'])]}
        selectedIncidentId="inc-foreign"
        scopeLabel="Bareilly"
      />,
    );
    expect(
      screen.getByText(/selected incident's buses are not reporting a position/i),
    ).toBeInTheDocument();
  });

  // The honest half of a scoped overlay: a depot operator SHOULD NOT see an
  // incident between two other depots' buses, and should be told that is why
  // the map looks quieter than the incident count elsewhere on the page.
  it('declares incidents it could not place instead of hiding them', () => {
    render(
      <OpsFleetMapPanel
        vehicles={twoVehicles}
        incidents={[incident('inc-foreign', ['SOMEONE_ELSE'])]}
        scopeLabel="Bareilly"
      />,
    );
    expect(screen.getByText(/1 further incident involves vehicles outside this view/i)).toBeInTheDocument();
  });

  it('states how many positions came from the control service', () => {
    const enriched = toOpsMapVehicles(
      [bus('A'), bus('B', 28.4, 79.5)],
      [
        {
          vehicleId: 'A',
          tripId: null,
          routeDirectionId: 'rd-1',
          position: { latitude: 28.31, longitude: 79.41 },
          distanceAlongRouteMeters: 100,
          speedKmph: 10,
          headingDegrees: 12,
          stopState: 'departed_stop',
          currentStopId: null,
          occupancyCount: null,
          occupancyLoadBand: null,
          confidence: 0.9,
          observedAt: '2026-08-12T06:00:10Z',
        },
      ],
    );
    render(<OpsFleetMapPanel vehicles={enriched} scopeLabel="Bareilly" />);
    expect(screen.getByText(/1 of 2 positions from the control service/i)).toBeInTheDocument();
  });

  it('does not poll the scoped endpoint unless asked to', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<OpsFleetMapPanel vehicles={twoVehicles} scopeLabel="Bareilly" />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The corridor is enrichment, not scope - the request carries no depot, and
  // the endpoint derives one from the caller's own record.
  it('polls the scoped endpoint with only the corridor when live, and draws what it answers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        vehicles: toOpsMapVehicles([bus('A')]),
        incidents: [],
        scopeLabel: 'Bareilly',
        source: 'live',
        stale: false,
        fetchedAt: '2026-08-12T06:00:00.000Z',
        error: null,
        controlServiceError: null,
      }),
    );

    render(<OpsFleetMapPanel vehicles={twoVehicles} scopeLabel="Bareilly" routeDirectionId="rd-9" live />);

    expect(fetchSpy).toHaveBeenCalledWith('/api/ops/fleet/map?routeDirectionId=rd-9', { cache: 'no-store' });
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).not.toMatch(/depot/i);

    // The poll's own scoped answer replaces the server-rendered seed.
    expect(await screen.findByText('Bareilly · 1 vehicle')).toBeInTheDocument();
  });
});

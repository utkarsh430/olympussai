// @vitest-environment jsdom
//
// THE DEFECT: the statewide map opened on empty ocean.
//
// One vehicle in the live UPSRTC feed - UP78JT5520, depot CHUTMALPUR -
// reported `latitude 0.000` with an otherwise plausible longitude. The camera
// fit is taken once over every vehicle handed to the map, so that single
// reading stretched the fitted bounds from lat 0 to lat 30.71 and centred the
// opening view at 15.35N: peninsular India. The live control room opened on
// Mumbai, Bengaluru, Chennai and Kerala with the entire Uttar Pradesh fleet
// off the top edge, and an operator had to pan north on every first load.
//
// The markers were all drawn correctly - they were simply outside the
// viewport - so nothing looked broken. That is what makes this the same family
// of defect as the `observed_at = 2046` reading already fixed: the feed
// carries occasional garbage, and the console must not smooth it into
// something that looks fine.
//
// `isValidCoordinate` in src/lib/upsrtc/normalizer.ts does not catch it. That
// gate rejects exact (0,0) null island, and lat 0 with a real longitude is not
// exact (0,0) - it is explicitly allowed there, and tested as allowed
// (normalizer.test.ts: `isValidCoordinate(28.35, 0)` is true). A single
// zeroed axis therefore passes every existing check.
//
// These tests hold the property directly on the fitted bounds, because that is
// where the operator experiences the defect. They mock only the Google SDK
// surface OpsFleetMap actually touches; there is no basemap in a test process
// and there never will be.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OpsFleetMap } from '@/components/ops/map/OpsFleetMap';
import { toOpsMapVehicles } from '@/lib/ops/mapVehicles';
import type { CanonicalLiveBus } from '@/models/canonical';

/* ── the smallest Google Maps stand-in that exercises the fit ─────────────── */

interface Extended {
  lat: number;
  lng: number;
}

/** Records every point the component extends the fit over. */
class FakeLatLngBounds {
  readonly extended: Extended[] = [];
  extend(point: Extended) {
    this.extended.push(point);
    return this;
  }
  isEmpty() {
    return this.extended.length === 0;
  }
}

const fitBounds = vi.fn();
const setZoom = vi.fn();
const panTo = vi.fn();

class FakeMap {
  constructor(
    public container: HTMLElement,
    public options: unknown,
  ) {}
  fitBounds = fitBounds;
  setZoom = setZoom;
  panTo = panTo;
  getZoom = () => 7;
}

vi.mock('@/lib/maps/loader', () => ({
  isMapsConfigured: () => true,
  mapsAuthFailed: () => false,
  onMapsAuthFailure: () => () => {},
  getMapsLoader: () => ({
    importLibrary: async (library: string) => {
      if (library !== 'maps') throw new Error(`unexpected library ${library}`);
      return { Map: FakeMap };
    },
  }),
}));

// The canvas layer needs a 2D context jsdom does not provide, and this suite is
// about the camera rather than the chevrons.
vi.mock('@/components/map/fleetCanvasLayer', () => ({
  createFleetLayer: () => ({
    setVehicles: vi.fn(),
    setOverlays: vi.fn(),
    setSelected: vi.fn(),
    destroy: vi.fn(),
  }),
}));

beforeEach(() => {
  fitBounds.mockClear();
  setZoom.mockClear();
  panTo.mockClear();
  (globalThis as unknown as { google: unknown }).google = {
    maps: {
      LatLngBounds: FakeLatLngBounds,
      event: { addListenerOnce: () => ({ remove: () => {} }) },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { google?: unknown }).google;
});

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function bus(id: string, latitude: number, longitude: number): CanonicalLiveBus {
  return {
    id,
    registrationNumber: id,
    latitude,
    longitude,
    speedKmph: 0,
    headingDegrees: 90,
    depotName: 'CHUTMALPUR',
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

/** The fitted rectangle, as the camera would compute it. */
async function fittedBounds() {
  await waitFor(() => expect(fitBounds).toHaveBeenCalled());
  const [firstCall] = fitBounds.mock.calls as [FakeLatLngBounds][];
  if (firstCall === undefined) throw new Error('fitBounds was not called');
  const [bounds] = firstCall;
  const lats = bounds.extended.map((point) => point.lat);
  const lngs = bounds.extended.map((point) => point.lng);
  return {
    points: bounds.extended,
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    centreLat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
}

describe('OpsFleetMap opening camera', () => {
  // THE REGRESSION. Reproduces the exact live reading and the exact live
  // fleet extent: the real feed spans lat 23.84 to 30.71, and UP78JT5520
  // reported lat 0.000 / lng 77.855354.
  it('does not let a zeroed latitude drag the opening view into the sea', async () => {
    const vehicles = toOpsMapVehicles([
      bus('UP78JT5520', 0.0, 77.855354), // the garbage reading
      bus('UP78JT6631', 28.731026, 77.77132),
      bus('UP78KT7331', 30.709913, 80.1),
      bus('UP78JT1078', 23.837769, 79.4),
    ]);

    render(<OpsFleetMap vehicles={vehicles} />);
    const fit = await fittedBounds();

    // Before the fix this was 0 and the centre was 15.35N - the Arabian Sea /
    // peninsular India, ~1,500 km south of the fleet.
    expect(fit.south).toBeGreaterThan(20);
    expect(fit.centreLat).toBeGreaterThan(23);
    expect(fit.centreLat).toBeLessThan(32);

    // The three real vehicles still define the view.
    expect(fit.north).toBeCloseTo(30.709913, 5);
    expect(fit.points).toHaveLength(3);
  });

  it('refuses non-finite and null-island readings as fit input', async () => {
    const vehicles = toOpsMapVehicles([
      bus('GOOD', 26.85, 80.95),
      bus('NAN', Number.NaN, 80.0),
      bus('INF', Number.POSITIVE_INFINITY, 80.0),
      bus('NULL-ISLAND', 0, 0),
      bus('OFF-NETWORK', -33.86, 151.2), // Sydney
    ]);

    render(<OpsFleetMap vehicles={vehicles} />);
    const fit = await fittedBounds();

    expect(fit.points).toEqual([{ lat: 26.85, lng: 80.95 }]);
  });

  // Hiding a real bus silently is the other half of the same dishonesty. The
  // console removed it from the picture, so it has to say so.
  it('declares how many vehicles it could not place', async () => {
    const vehicles = toOpsMapVehicles([
      bus('GOOD', 26.85, 80.95),
      bus('UP78JT5520', 0.0, 77.855354),
    ]);

    render(<OpsFleetMap vehicles={vehicles} />);
    await waitFor(() => expect(fitBounds).toHaveBeenCalled());

    expect(screen.getByText(/1 vehicle reported a position that is not on the network/i)).toBeInTheDocument();
  });

  it('says nothing about unplaceable vehicles when every position is good', async () => {
    const vehicles = toOpsMapVehicles([bus('GOOD', 26.85, 80.95), bus('ALSO', 27.1, 80.2)]);

    render(<OpsFleetMap vehicles={vehicles} />);
    await waitFor(() => expect(fitBounds).toHaveBeenCalled());

    expect(screen.queryByText(/not on the network/i)).not.toBeInTheDocument();
  });

  // A fleet whose every reading is garbage must not fit to nothing; the
  // fallback state view is the honest camera when there is no evidence.
  it('leaves the camera on the state view when nothing is placeable', async () => {
    const vehicles = toOpsMapVehicles([bus('BAD', 0, 0), bus('ALSO-BAD', Number.NaN, 80)]);

    render(<OpsFleetMap vehicles={vehicles} />);
    await screen.findByText(/2 vehicles reported positions that are not on the network/i);

    expect(fitBounds).not.toHaveBeenCalled();
  });
});

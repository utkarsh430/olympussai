import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RadarSweep } from '@/components/map/RadarSweep';
import { createFleetLayer } from '@/components/map/fleetCanvasLayer';
import type { CanonicalLiveBus } from '@/models/canonical';

/**
 * When the Maps key is rejected for the page origin, the SDK calls `gm_authFailure` and
 * replaces every Map/MVCObject prototype method with `function(){}`. From then on
 * `map.addListener` returns `undefined`, despite its declared type. Observed in the
 * browser on 127.0.0.1:3210 (RefererNotAllowedMapError); this stub reproduces that state.
 */
function disabledMap(): google.maps.Map {
  const noop = (): undefined => undefined;
  return {
    addListener: noop,
    getProjection: noop,
    getBounds: noop,
    getDiv: noop,
    getZoom: noop,
  } as unknown as google.maps.Map;
}

const bus: CanonicalLiveBus = {
  id: 'UP25FT4823',
  registrationNumber: 'UP25FT4823',
  latitude: 28.356138,
  longitude: 79.42025,
  speedKmph: 38,
  headingDegrees: 253.2,
  depotName: 'ROHILKHAND',
  routeId: '6842',
  routeName: 'RKD_4560_ORD_OUT',
  serviceNumber: 'RKD0399',
  tripId: '30396',
  vehicleType: null,
  gpsTimestamp: '2026-07-20T10:00:00Z',
  lastUpdatedAt: '2026-07-20T10:00:05Z',
  ignitionOn: true,
  rawStatus: 'Live',
  tripDate: '2026-07-20',
  dataQuality: 'good',
};

describe('map listener cleanup after a Maps authorisation failure', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('RadarSweep unmounts cleanly when addListener returned no handle', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(<RadarSweep map={disabledMap()} bus={bus} />));

    // Deselecting the bus (Escape in the vehicle drawer) unmounts the sweep.
    expect(() => act(() => root.unmount())).not.toThrow();
  });

  it('the fleet layer destroys cleanly when addListener returned no handle', () => {
    class OverlayViewStub {
      setMap(): void {}
    }
    vi.stubGlobal('google', { maps: { OverlayView: OverlayViewStub } });

    const layer = createFleetLayer(disabledMap(), () => undefined);

    expect(() => layer.destroy()).not.toThrow();
  });
});

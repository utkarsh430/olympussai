// Orchestration tests: what getVehicleArrivals fetches, in what order, and what
// it deliberately does NOT fetch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/arrival-prediction/repository.js', () => ({
  loadVehicleStateForPrediction: vi.fn(),
  vehicleExists: vi.fn(),
  loadRouteGeometry: vi.fn(),
  loadRouteDirectionStops: vi.fn(),
  loadPeerSpeeds: vi.fn(),
  loadActiveHold: vi.fn(),
}));

const repo = await import('../src/arrival-prediction/repository.js');
const { getVehicleArrivals } = await import('../src/arrival-prediction/service.js');
const { MAX_STATE_AGE_SECONDS } = await import('../src/arrival-prediction/predict.js');

const NOW = new Date('2026-08-14T10:00:00.000Z');

function matchedState() {
  return {
    vehicleId: 'UP78JT5520',
    routeDirectionId: 'rd-1',
    distanceAlongRouteMeters: 1_000,
    speedKmph: 40,
    stopState: 'departed_stop',
    currentStopId: null,
    stopEnteredAt: null,
    confidence: 0.8,
    isLowConfidence: false,
    observedAt: '2026-08-14T09:59:30.000Z',
    position: { lat: 28.35, lon: 79.42 },
    velocityVarianceMeters2PerSecond2: 1,
  };
}

describe('getVehicleArrivals', () => {
  beforeEach(() => {
    vi.mocked(repo.loadVehicleStateForPrediction).mockReset();
    vi.mocked(repo.vehicleExists).mockReset();
    vi.mocked(repo.loadRouteGeometry).mockReset();
    vi.mocked(repo.loadRouteDirectionStops).mockReset();
    vi.mocked(repo.loadPeerSpeeds).mockReset();
    vi.mocked(repo.loadActiveHold).mockReset();
  });

  it('predicts from live state, geometry, stops and peers', async () => {
    vi.mocked(repo.loadVehicleStateForPrediction).mockResolvedValue(matchedState());
    vi.mocked(repo.loadRouteGeometry).mockResolvedValue({
      routeDirectionId: 'rd-1',
      isLoop: false,
      totalDistanceMeters: 20_000,
    });
    vi.mocked(repo.loadRouteDirectionStops).mockResolvedValue([
      { stopId: 's2', stopName: 'Faridpur', sequence: 2, cumulativeDistanceMeters: 5_000, isControlPoint: false },
    ]);
    vi.mocked(repo.loadPeerSpeeds).mockResolvedValue([]);
    vi.mocked(repo.loadActiveHold).mockResolvedValue(false);

    const res = await getVehicleArrivals('UP78JT5520', { now: NOW });

    expect(res.prediction.status).toBe('available');
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.arrivals).toHaveLength(1);
    expect(repo.loadPeerSpeeds).toHaveBeenCalledWith('rd-1', MAX_STATE_AGE_SECONDS);
  });

  it('does not query geometry, stops or peers for an off-route vehicle', async () => {
    // 69% of the live fleet is off route. Loading a route-direction's whole stop
    // list for each of them would be the most expensive query in the service,
    // issued for the vehicles it can tell nothing about.
    vi.mocked(repo.loadVehicleStateForPrediction).mockResolvedValue({
      ...matchedState(),
      routeDirectionId: null,
      distanceAlongRouteMeters: null,
      stopState: 'off_route',
      isLowConfidence: true,
      confidence: 0.03,
    });

    const res = await getVehicleArrivals('UP78JT5520', { now: NOW });

    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('off_route');
    expect(repo.loadRouteGeometry).not.toHaveBeenCalled();
    expect(repo.loadRouteDirectionStops).not.toHaveBeenCalled();
    expect(repo.loadPeerSpeeds).not.toHaveBeenCalled();
  });

  it('separates a bus that has never reported from a bus that does not exist', async () => {
    vi.mocked(repo.loadVehicleStateForPrediction).mockResolvedValue(null);
    vi.mocked(repo.vehicleExists).mockResolvedValue(true);
    const known = await getVehicleArrivals('UP78JT5520', { now: NOW });
    if (known.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(known.prediction.reason).toBe('no_live_state');

    vi.mocked(repo.vehicleExists).mockResolvedValue(false);
    const unknown = await getVehicleArrivals('NOT-A-BUS', { now: NOW });
    if (unknown.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(unknown.prediction.reason).toBe('vehicle_unknown');
  });

  it('costs one query for a vehicle with state, not two', async () => {
    vi.mocked(repo.loadVehicleStateForPrediction).mockResolvedValue({
      ...matchedState(),
      routeDirectionId: null,
      distanceAlongRouteMeters: null,
      stopState: 'off_route',
    });
    await getVehicleArrivals('UP78JT5520', { now: NOW });
    expect(repo.vehicleExists).not.toHaveBeenCalled();
  });

  it('refuses a held vehicle even when its own stop state has not caught up', async () => {
    // The hold lives in `commands`; `vehicle_states.stop_state` only becomes
    // 'held_by_controller' on the next processed fix. Between those two moments
    // the bus is held and the state row does not say so, and this is the branch
    // that keeps a countdown off the driver's screen in that window.
    vi.mocked(repo.loadVehicleStateForPrediction).mockResolvedValue(matchedState());
    vi.mocked(repo.loadRouteGeometry).mockResolvedValue({
      routeDirectionId: 'rd-1',
      isLoop: false,
      totalDistanceMeters: 20_000,
    });
    vi.mocked(repo.loadRouteDirectionStops).mockResolvedValue([
      { stopId: 's2', stopName: 'Faridpur', sequence: 2, cumulativeDistanceMeters: 5_000, isControlPoint: false },
    ]);
    vi.mocked(repo.loadPeerSpeeds).mockResolvedValue([]);
    vi.mocked(repo.loadActiveHold).mockResolvedValue(true);

    const res = await getVehicleArrivals('UP78JT5520', { now: NOW });
    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('held_by_controller');
  });
});

// Per-event failure classification on the ingestion path.
//
// The whole reason POST /v1/positions takes a batch and answers 200 with a
// `rejected` array is that a poll cycle carries ~665 vehicles: letting one
// unregistered bus or one out-of-range heading fail the other 664 good
// fixes would blind the fleet over a single bad row. So each event's
// failure has to be classified on its own, with a stable code the caller
// can act on - and an UNRECOGNISED failure has to keep failing loudly,
// because bucketing an unknown SQLSTATE into a 4xx would hide a real
// defect behind a "client error".
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/db/pool.js', () => ({
  getPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
  pingDb: vi.fn(),
  closePool: vi.fn(),
}));

const { ingestPositionEvents, ingestPositionEvent, getIngestStats, _resetIngestStatsForTests } =
  await import('../src/ingestion/pipeline.js');
const { StateEstimationService } = await import('../src/state-estimation/service.js');
const { InMemoryStateEstimationRepository } = await import(
  '../src/state-estimation/testing/inMemoryRepository.js'
);
const singleton = await import('../src/state-estimation/singleton.js');
const { stateStore } = await import('../src/state/store.js');
const { AppError } = await import('../src/lib/errors.js');
const { toIngestionError } = await import('../src/state-estimation/errors.js');

const METERS_PER_DEGREE_LAT = 111320;
const ORIGIN = { lat: 26.8467, lon: 80.9462 }; // Lucknow

function pointEast(meters: number) {
  const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
  return { lat: ORIGIN.lat, lon: ORIGIN.lon + meters / metersPerDegLon };
}

const shape = {
  routeDirectionId: 'rd-1',
  routeId: 'route-1',
  directionCode: 'UP',
  corridorId: null,
  isLoop: false,
  corridorOffsetMeters: null,
  corridorDirectionSign: 1 as const,
  totalDistanceMeters: 2000,
  points: [pointEast(0), pointEast(1000), pointEast(2000)],
};

/** A pg driver error carries its SQLSTATE on `.code`; that is all this layer reads. */
function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function event(vehicleId: string, offsetMeters = 500, observedAt = '2026-08-05T08:00:00.000Z') {
  const p = pointEast(offsetMeters);
  return { vehicleId, lat: p.lat, lon: p.lon, headingDegrees: 90, speedKmph: 20, observedAt };
}

async function installService(): Promise<InstanceType<typeof StateEstimationService>> {
  const repo = new InMemoryStateEstimationRepository([shape]);
  const service = new StateEstimationService(repo);
  await service.rehydrate();
  vi.spyOn(singleton, 'getStateEstimationService').mockReturnValue(service);
  return service;
}

describe('toIngestionError', () => {
  it('maps 23503 foreign_key_violation to unknown_vehicle 422', () => {
    const mapped = toIngestionError(pgError('23503'), 'UP77AN2509');
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe('unknown_vehicle');
    expect(mapped.status).toBe(422);
    expect(mapped.message).toContain('UP77AN2509');
  });

  it('maps 23514 check_violation to invalid_position 422', () => {
    const mapped = toIngestionError(pgError('23514'), 'veh-1');
    expect(mapped.code).toBe('invalid_position');
    expect(mapped.status).toBe(422);
  });

  it('maps 57014 query_canceled to ingest_unavailable 503', () => {
    expect(toIngestionError(pgError('57014'), 'veh-1')).toMatchObject({
      code: 'ingest_unavailable',
      status: 503,
    });
  });

  it.each(['08000', '08003', '08006', '08P01'])(
    'maps connection-exception %s to ingest_unavailable 503',
    (code) => {
      expect(toIngestionError(pgError(code), 'veh-1')).toMatchObject({
        code: 'ingest_unavailable',
        status: 503,
      });
    },
  );

  it('RETHROWS an unclassifiable error rather than inventing a 4xx for it', () => {
    // A null-pointer bug in this service is not a caller data problem, and
    // reporting it as one would make it invisible in the rejected array.
    const bug = new TypeError('cannot read properties of undefined');
    expect(() => toIngestionError(bug, 'veh-1')).toThrow(bug);
    expect(() => toIngestionError(pgError('42P01'), 'veh-1')).toThrow('pg error 42P01');
  });
});

describe('ingestPositionEvents per-event classification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stateStore._resetForTests();
    _resetIngestStatsForTests();
  });

  it('rejects only the failing event and accepts the rest of the batch', async () => {
    const service = await installService();
    const repo = (service as unknown as { repository: InstanceType<typeof InMemoryStateEstimationRepository> })
      .repository;

    const original = repo.saveVehicleState.bind(repo);
    vi.spyOn(repo, 'saveVehicleState').mockImplementation(async (estimate) => {
      if (estimate.vehicleId === 'ghost-bus') throw pgError('23503');
      return original(estimate);
    });

    const result = await ingestPositionEvents([
      event('veh-a', 400),
      event('ghost-bus', 500),
      event('veh-b', 600),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toEqual([
      {
        index: 1,
        vehicleId: 'ghost-bus',
        code: 'unknown_vehicle',
        message: expect.stringContaining('ghost-bus'),
      },
    ]);
  });

  it('reports the index positionally so a caller can correlate rejections with its own input', async () => {
    const service = await installService();
    const repo = (service as unknown as { repository: InstanceType<typeof InMemoryStateEstimationRepository> })
      .repository;
    vi.spyOn(repo, 'saveVehicleState').mockRejectedValue(pgError('23514'));

    const result = await ingestPositionEvents([event('a'), event('b'), event('c')]);

    expect(result.accepted).toBe(0);
    expect(result.rejected.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(result.rejected.every((r) => r.code === 'invalid_position')).toBe(true);
  });

  it('surfaces the pre-rehydration 503 as a per-event code instead of a raw crash', async () => {
    const repo = new InMemoryStateEstimationRepository([shape]);
    // Deliberately NOT rehydrated.
    vi.spyOn(singleton, 'getStateEstimationService').mockReturnValue(
      new StateEstimationService(repo),
    );

    const result = await ingestPositionEvents([event('veh-a')]);
    expect(result.accepted).toBe(0);
    expect(result.rejected[0]?.code).toBe('state_not_rehydrated');
  });

  it('fails the whole batch on an unclassifiable error - an unknown failure is a bug, not a data problem', async () => {
    const service = await installService();
    const repo = (service as unknown as { repository: InstanceType<typeof InMemoryStateEstimationRepository> })
      .repository;
    vi.spyOn(repo, 'saveVehicleState').mockRejectedValue(new TypeError('undefined is not a function'));

    await expect(ingestPositionEvents([event('veh-a')])).rejects.toThrow(
      'undefined is not a function',
    );
  });
});

describe('ingestPositionEvent write-through to the runtime store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stateStore._resetForTests();
    _resetIngestStatsForTests();
  });

  it('mirrors an accepted estimate into stateStore', async () => {
    await installService();
    await ingestPositionEvent(event('veh-a', 500));

    const stored = stateStore.getVehicleState('veh-a');
    expect(stored?.routeDirectionId).toBe('rd-1');
    expect(stored?.position).not.toBeNull();
    expect(getIngestStats().lastEventAt).not.toBeNull();
  });

  it('does NOT mirror an estimate the repository suppressed as out-of-order', async () => {
    await installService();
    await ingestPositionEvent(event('veh-a', 900, '2026-08-05T08:05:00.000Z'));
    const afterFirst = stateStore.getVehicleState('veh-a');

    // Late redelivery: the in-memory repo mirrors the SQL ordering guard
    // and returns persisted=false, so the store must not move either.
    await ingestPositionEvent(event('veh-a', 100, '2026-08-05T08:00:00.000Z'));

    expect(stateStore.getVehicleState('veh-a')).toBe(afterFirst);
    expect(stateStore.getVehicleState('veh-a')?.observedAt).toBe('2026-08-05T08:05:00.000Z');
  });

  it('counts only accepted events in eventsLastCycle', async () => {
    const service = await installService();
    const repo = (service as unknown as { repository: InstanceType<typeof InMemoryStateEstimationRepository> })
      .repository;
    const original = repo.saveVehicleState.bind(repo);
    vi.spyOn(repo, 'saveVehicleState').mockImplementation(async (estimate) => {
      if (estimate.vehicleId === 'bad') throw pgError('23503');
      return original(estimate);
    });

    await ingestPositionEvents([event('good-1'), event('bad'), event('good-2')]);
    expect(getIngestStats().eventsLastCycle).toBe(2);
  });
});

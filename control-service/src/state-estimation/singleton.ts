// Process-wide StateEstimationService, built once over the shared pg Pool
// and wrapped in a NetworkGeometryCache.
//
// The service class itself stays dependency-injected and singleton-free so
// it can be unit-tested against an in-memory repository; this module is the
// one place that binds it to real process-wide resources. Both HTTP
// ingestion (routes/positions.ts) and the in-process GPS poller go through
// here, so they share one prior-state cache and one geometry snapshot -
// two instances would each hold a divergent view of every vehicle.

import { loadEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { CachedGeometryRepository, NetworkGeometryCache } from './cache.js';
import { PgStateEstimationRepository } from './repository.js';
import { StateEstimationService } from './service.js';

let baseRepository: PgStateEstimationRepository | undefined;
let cache: NetworkGeometryCache | undefined;
let service: StateEstimationService | undefined;

function getBaseRepository(): PgStateEstimationRepository {
  baseRepository ??= new PgStateEstimationRepository(getPool());
  return baseRepository;
}

export function getNetworkGeometryCache(): NetworkGeometryCache {
  cache ??= new NetworkGeometryCache(getBaseRepository(), loadEnv().SHAPE_CACHE_TTL_MS);
  return cache;
}

export function getStateEstimationService(): StateEstimationService {
  service ??= new StateEstimationService(
    new CachedGeometryRepository(getBaseRepository(), getNetworkGeometryCache()),
  );
  return service;
}

/** Test-only: drop the process-wide instances so a test can rebuild them. */
export function _resetStateEstimationSingletonForTests(): void {
  baseRepository = undefined;
  cache = undefined;
  service = undefined;
}

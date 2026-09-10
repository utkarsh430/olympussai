// The completion sweep is a BEHAVIOUR CHANGE, so it is opt-in.
//
// Applying 20260907093000__command_completion.sql creates two functions and
// calls neither. The only thing that changes what a running service does is
// this job, and with COMMAND_COMPLETION_SWEEP_ENABLED false it is not
// registered at all - so the job list, and therefore the service's behaviour,
// is identical to what it was before the flag existed.
//
// Why the flag is needed at all: freeing the slot when the action ends lets
// the controller issue instructions the unique index used to refuse. That
// changes which instructions reach a driver, and has to be a deliberate act -
// even though the measured size of the change is nothing at all on any preset
// at its design density (docs/COMMAND_COMPLETION.md section 3).
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { buildJobs } from '../src/scheduler/jobs.js';

vi.mock('../src/state-estimation/singleton.js', () => ({
  getNetworkGeometryCache: () => ({ warm: () => Promise.resolve({ version: 1, shapes: [] }) }),
}));

function env(overrides: Partial<Env> = {}): Env {
  return {
    COMMAND_DELIVERY_SWEEP_INTERVAL_MS: 15_000,
    COMMAND_TTL_SWEEP_INTERVAL_MS: 30_000,
    COMMAND_COMPLETION_SWEEP_ENABLED: false,
    HEADWAY_COMPUTE_INTERVAL_MS: 60_000,
    SHAPE_CACHE_TTL_MS: 900_000,
    INCIDENT_STALENESS_SWEEP_INTERVAL_MS: 300_000,
    DAILY_KPI_SNAPSHOT_INTERVAL_MS: 900_000,
    RETENTION_SWEEP_INTERVAL_MS: 3_600_000,
    RETENTION_ENABLED: false,
    GPS_POLL_ENABLED: false,
    GPS_POLL_INTERVAL_MS: 30_000,
    DECISION_CYCLE_ENABLED: false,
    DECISION_CYCLE_INTERVAL_MS: 90_000,
    ...overrides,
  } as unknown as Env;
}

describe('commandCompletionSweep job registration', () => {
  it('is NOT registered at the default, so the flag off is the pre-existing behaviour', () => {
    const names = buildJobs(env()).map((j) => j.name);
    expect(names).not.toContain('commandCompletionSweep');
  });

  it('is registered when COMMAND_COMPLETION_SWEEP_ENABLED is true', () => {
    const names = buildJobs(env({ COMMAND_COMPLETION_SWEEP_ENABLED: true })).map((j) => j.name);
    expect(names).toContain('commandCompletionSweep');
  });

  it('turning the flag on adds exactly one job and removes none', () => {
    // The flag must not reach anything else. If enabling it changed any other
    // job, "default off is byte-identical" would stop being provable from the
    // job list alone.
    const off = buildJobs(env()).map((j) => j.name);
    const on = buildJobs(env({ COMMAND_COMPLETION_SWEEP_ENABLED: true })).map((j) => j.name);
    expect(on.filter((n) => n !== 'commandCompletionSweep')).toEqual(off);
  });
});

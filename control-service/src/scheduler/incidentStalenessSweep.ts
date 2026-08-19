// Backstop sweep: closes open bunching incidents whose evidence has gone cold.
//
// THE PRIMARY PATH IS ELSEWHERE. `closeSupersededIncidents` in
// src/headway/service.ts ends an incident the moment its corridor is
// recomputed without that pair in it - precise, immediate, and driven by a
// fresh measurement. This sweep exists only for the case that path
// structurally cannot reach: a corridor that stops being computed AT ALL,
// because it dropped below two fresh vehicles
// (listRouteDirectionsWithLiveHeadwayPairs) or because the service was
// stopped. Nothing then revisits its incidents, so without this they stay
// `open` forever.
//
// That is not a hypothetical. On the pilot database this shipped against there
// were 9,692 open incidents, 96% of which had not had their pair evaluated in
// over half an hour, and the control room drew every one of them as a bunching
// link between buses a median of 59 km apart.
//
// CLOSING IS NOT "STOPPING WATCHING". Every bus stays under the standing
// detection sweep regardless. `findOpenIncidentForPair` only matches
// non-closed rows, so a pair that closes up again simply opens a new incident
// on the next cycle - two honest intervals instead of one that never ended.
import { loadEnv, type Env } from '../config/env.js';
import { closeStaleOpenIncidents } from '../headway/repository.js';
import { logger } from '../lib/logger.js';

export interface IncidentStalenessSweepResult {
  closed: number;
  /** True when the batch limit was reached, so a backlog is still draining. */
  moreLikelyPending: boolean;
  durationMs: number;
}

export interface IncidentStalenessSweepDeps {
  closeStale?: (maxSampleAgeSeconds: number, limit: number) => Promise<number>;
  now?: () => number;
}

/**
 * One sweep. Returns rather than throws on an empty result - "nothing was
 * stale" is the healthy steady state once the initial backlog has drained,
 * and is logged at debug rather than info so it does not fill the log.
 */
export async function runIncidentStalenessSweep(
  env: Env = loadEnv(),
  deps: IncidentStalenessSweepDeps = {},
): Promise<IncidentStalenessSweepResult> {
  const now = deps.now ?? Date.now;
  const closeStale = deps.closeStale ?? closeStaleOpenIncidents;
  const startedAt = now();

  const closed = await closeStale(
    env.INCIDENT_PAIR_SAMPLE_MAX_AGE_SECONDS,
    env.INCIDENT_STALENESS_SWEEP_BATCH,
  );

  const result: IncidentStalenessSweepResult = {
    closed,
    moreLikelyPending: closed >= env.INCIDENT_STALENESS_SWEEP_BATCH,
    durationMs: now() - startedAt,
  };

  if (closed === 0) {
    logger.debug(result, 'incident staleness sweep: nothing stale');
  } else {
    // Worth an INFO line: this is the system retracting something an operator
    // may have had on screen, and a review of "why did that alert vanish"
    // has to be answerable from the log.
    logger.info(result, 'incident staleness sweep closed incidents whose evidence went cold');
  }
  return result;
}

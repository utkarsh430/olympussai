/**
 * Which corridors a depot is actually running, and what those corridors can
 * honestly tell it.
 *
 * ─── WHY THIS IS DERIVED AND NOT CONFIGURED ──────────────────────────────
 *
 * A route-direction is not owned by a depot. Control-service records no depot
 * on one, buses from many depots run the same road, and nothing in either
 * datastore lists "the corridors of Bareilly". The depot dashboard's own page
 * said so, and drew the consequence that a depot view had to show the
 * STATEWIDE corridor list — 759 entries, of which a given depot typically runs
 * a handful, ordered by nothing an operator cares about.
 *
 * There is a real signal, and it costs one call. `GET /v1/vehicle-states` with
 * no `routeDirectionId` returns every vehicle state the control service holds,
 * each carrying the corridor it is on. Intersect that with the depot's own
 * scoped fleet — which `filterVehicleStatesToScope` already does, and is the
 * only thing that knows a vehicle's depot — and what falls out is the set of
 * corridors this depot's buses are on RIGHT NOW, with a count each. Measured,
 * not declared, and it moves with the service.
 *
 * ─── THIS IS NOT THE SECURITY BOUNDARY ───────────────────────────────────
 *
 * Say it plainly, because the shape invites the mistake: narrowing the
 * corridor LIST is a usability decision, not an authorization one. The
 * boundary is on vehicles, it is enforced in depotScope.ts / depotAccess.ts,
 * and it holds whatever corridor is selected. A depot operator who somehow
 * selected a corridor they do not run would still see only their own depot's
 * vehicles on it, because every vehicle list on the page is intersected
 * against their scoped fleet before it is serialised. Nothing here may ever be
 * relied on to keep another depot's buses off the screen.
 *
 * ─── AND IT MUST NOT INVENT DETECTION ────────────────────────────────────
 *
 * 561 of the 759 mapped corridors carry a sentinel target headway rather than
 * a measured one (`calibration_source = 'none'` in control-service's
 * route_policies; the flag reaches this app as `hasActivePolicy: false`). Those
 * corridors are observation-only: they can be watched, and they will report no
 * bunching, ever. A depot whose corridors are all in that set must be told so
 * in words, rather than shown seven empty readings.
 *
 * Pure and I/O-free on purpose, exactly like depotScope.ts: the rules that
 * decide what a console claims are the ones that most need to be testable
 * without a database.
 */
import type { RouteDirectionMeta } from '@/models/control';

/** One corridor this depot is currently running, with what it can report. */
export interface DepotCorridor {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  isLoop: boolean;
  /**
   * Whether bunching detection runs on this corridor.
   *
   * `undefined` means the control service does not report policy state at all
   * (an older build), which is NOT the same as `false`. Kept as three states
   * all the way to the copy, because "we know it cannot detect" and "we do not
   * know whether it can" are different things to tell an operator.
   */
  hasActivePolicy: boolean | undefined;
  /** How many of THIS depot's vehicles the control service currently places on it. */
  depotVehicleCount: number;
}

/** What a corridor can say, as one word. */
export type CorridorDetection = 'detecting' | 'observation-only' | 'unknown';

export function corridorDetection(
  corridor: Pick<DepotCorridor, 'hasActivePolicy'>,
): CorridorDetection {
  if (corridor.hasActivePolicy === true) return 'detecting';
  if (corridor.hasActivePolicy === false) return 'observation-only';
  return 'unknown';
}

/** `1348 · OUT (loop)` — the corridor as an operator reads it in a picker. */
export function depotCorridorLabel(
  corridor: Pick<DepotCorridor, 'routeId' | 'directionCode' | 'isLoop'>,
): string {
  return `${corridor.routeId} · ${corridor.directionCode}${corridor.isLoop ? ' (loop)' : ''}`;
}

/**
 * The corridors this depot's own vehicles are on, busiest first.
 *
 * `scopedVehicleStates` must ALREADY be narrowed to the depot (see this
 * module's header). A state with no `routeDirectionId` is a vehicle the
 * control service is not placing on any mapped corridor — common, since 561 of
 * ~9,170 vehicles run roads that have never been seeded — and contributes to
 * no corridor rather than to a catch-all bucket.
 *
 * A corridor the depot is running that is absent from `routeDirections` is
 * dropped: the corridor list is what carries `hasActivePolicy`, and inventing
 * an entry for an id this app cannot describe would mean showing an operator a
 * corridor it can say nothing true about.
 *
 * Ordering is total and deterministic — count desc, then routeId, then
 * directionCode — so a picker does not reshuffle under an operator between two
 * renders in which two corridors happen to tie.
 */
export function deriveDepotCorridors(
  routeDirections: readonly RouteDirectionMeta[],
  scopedVehicleStates: readonly { vehicleId: string; routeDirectionId: string | null }[],
): DepotCorridor[] {
  const counts = new Map<string, number>();
  for (const state of scopedVehicleStates) {
    if (state.routeDirectionId === null) continue;
    counts.set(state.routeDirectionId, (counts.get(state.routeDirectionId) ?? 0) + 1);
  }

  const corridors: DepotCorridor[] = [];
  for (const meta of routeDirections) {
    const depotVehicleCount = counts.get(meta.routeDirectionId);
    if (depotVehicleCount === undefined) continue;
    corridors.push({
      routeDirectionId: meta.routeDirectionId,
      routeId: meta.routeId,
      directionCode: meta.directionCode,
      isLoop: meta.isLoop,
      hasActivePolicy: meta.hasActivePolicy,
      depotVehicleCount,
    });
  }

  return corridors.sort(
    (a, b) =>
      b.depotVehicleCount - a.depotVehicleCount ||
      a.routeId.localeCompare(b.routeId) ||
      a.directionCode.localeCompare(b.directionCode),
  );
}

/**
 * Which corridor the console opens on.
 *
 * A requested id is honoured only when the depot is actually running it. That
 * is not a security check (see the header) — it is that the alternative is a
 * console showing an empty running order and a blank headway table for a road
 * none of this depot's buses are on, with nothing on screen explaining why. A
 * stale bookmark therefore degrades to a real corridor instead of to an empty
 * screen.
 *
 * ─── WHY BUSIEST IS THE WRONG DEFAULT ON ITS OWN ─────────────────────────
 *
 * It was, and the cost was measured on the live console: KAUSHAMBI's busiest
 * corridor is watch-only, so the depot opened every shift on a screen where
 * the whole bunching panel was a paragraph explaining why there was nothing in
 * it. The first thing a new operator saw was an apology.
 *
 * 561 of the 759 mapped corridors carry no planned gap, so this is the common
 * case rather than an edge one. Opening on the busiest corridor that can
 * actually report something puts a working screen in front of the operator,
 * and the picker still offers every corridor with its own marking — nothing is
 * hidden, and the count on each option means the operator can see immediately
 * that a busier one exists.
 *
 * The fallback is deliberately the plain busiest corridor rather than nothing:
 * a depot where NO corridor can detect must still show its running order, its
 * roster and its map, with the panels saying in words why bunching is blank.
 * Skipping straight to "nothing to show" would be the same lie by omission.
 *
 * A corridor whose detection state is UNKNOWN is not preferred and not
 * excluded. Preferring it would be treating "we did not hear" as "yes".
 */
export function selectDepotCorridor(
  corridors: readonly DepotCorridor[],
  requestedRouteDirectionId: string | null | undefined,
): DepotCorridor | null {
  if (requestedRouteDirectionId !== null && requestedRouteDirectionId !== undefined) {
    const requested = corridors.find((c) => c.routeDirectionId === requestedRouteDirectionId);
    if (requested) return requested;
  }
  // `corridors` is already ordered busiest-first and the order is total, so the
  // first detecting entry is the busiest detecting one without a second sort.
  return corridors.find((c) => corridorDetection(c) === 'detecting') ?? corridors[0] ?? null;
}

/** How much of what this depot is running can actually detect bunching. */
export interface DepotDetectionCoverage {
  /** Corridors this depot's vehicles are on right now. */
  running: number;
  /** Of those, how many have a measured target headway and can raise an incident. */
  detecting: number;
  /** Of those, how many are mapped but carry no measured target — watchable, never reporting. */
  observationOnly: number;
  /** Of those, how many the control service does not report a policy state for. */
  unknown: number;
}

export function depotDetectionCoverage(
  corridors: readonly DepotCorridor[],
): DepotDetectionCoverage {
  const coverage: DepotDetectionCoverage = {
    running: corridors.length,
    detecting: 0,
    observationOnly: 0,
    unknown: 0,
  };
  for (const corridor of corridors) {
    switch (corridorDetection(corridor)) {
      case 'detecting':
        coverage.detecting += 1;
        break;
      case 'observation-only':
        coverage.observationOnly += 1;
        break;
      case 'unknown':
        coverage.unknown += 1;
        break;
    }
  }
  return coverage;
}

function corridorWord(count: number): string {
  return count === 1 ? 'corridor' : 'corridors';
}

/**
 * The standing sentence under this depot's corridor readings.
 *
 * Written as a plain fact rather than a warning, for the reason the control
 * room's own coverage caption gives: an operator warned twice a shift about a
 * normal condition stops reading warnings. What it must never do is let a
 * depot whose corridors are all observation-only read its blank bunching panel
 * as "a quiet night".
 */
export function describeDepotDetectionCoverage(
  coverage: DepotDetectionCoverage,
  depotLabel: string,
): string {
  const { running, detecting, observationOnly, unknown } = coverage;

  if (running === 0) {
    return `None of ${depotLabel}'s buses is on a surveyed corridor right now, so there is nothing here to check for buses closing up. That is a gap in the survey, not a quiet depot — only part of the state's roads have been surveyed into the control database.`;
  }

  const unknownClause =
    unknown === 0
      ? ''
      : ` The control service does not say whether ${unknown} of them ${unknown === 1 ? 'has' : 'have'} a planned gap, so whether ${unknown === 1 ? 'that one' : 'those'} can be checked is unknown, not no.`;

  if (detecting === 0 && observationOnly === running) {
    return `None of the ${running} ${corridorWord(running)} ${depotLabel} is on has a planned gap set, so all of them are watch-only: you can see the buses here, and nothing will ever be reported about them closing up. An empty panel on this depot is that fact, not a quiet night.`;
  }

  if (detecting === running) {
    return `All ${running} ${corridorWord(running)} ${depotLabel} is on have a planned gap set, so buses closing up can be reported on every one of them.`;
  }

  const watchOnlyClause =
    observationOnly === 0
      ? ''
      : observationOnly === 1
        ? ' The other one is surveyed but has no planned gap set, so it is watch-only and nothing will ever be raised on it.'
        : ` The other ${observationOnly} ${corridorWord(observationOnly)} are surveyed but have no planned gap set, so they are watch-only and nothing will ever be raised on them.`;

  return `${detecting} of the ${running} ${corridorWord(running)} ${depotLabel} is on ${detecting === 1 ? 'has' : 'have'} a planned gap set, so buses closing up can be reported there.${watchOnlyClause}${unknownClause}`;
}

/**
 * What a corridor with no detection says in place of a reading.
 *
 * Returns null for a corridor that can detect, so a caller renders the real
 * readings. The two non-detecting cases get different copy on purpose: one is
 * a fact about the corridor, the other is a fact about the control service.
 */
export function describeCorridorObservationOnly(corridor: DepotCorridor): string | null {
  switch (corridorDetection(corridor)) {
    case 'detecting':
      return null;
    case 'observation-only':
      return `${depotCorridorLabel(corridor)} is surveyed, but no planned gap has been set for it, so buses closing up cannot be checked here. There are no gap readings to show and nothing can be raised on this corridor — this is the control service reporting its own settings, not a failure to reach it.`;
    case 'unknown':
      return `The control service does not say whether ${depotCorridorLabel(corridor)} has a planned gap set, so whether buses closing up can be checked here is unknown. An empty panel below cannot be read as a quiet corridor.`;
  }
}

import { compareText } from '../stats/order';
import { ARRIVAL_GRID_MIN, BLOCK_END_RADIUS_KM, DISPATCH_LEAD_MIN, FOLLOWING_MAX_BEHIND_KM, KIND_ORDER, MAX_CANDIDATES_PER_KIND, MAX_HEADWAY_MIN, MAX_SPARE_RANGE_KM, MIN_HEADWAY_MIN, OTHER_DEPOT_RESERVE_SPARES, RESERVE_LOSS_MIN, TRANSFER_MIN } from './config';
import type { ReplacementCandidate, ReplacementInput, ReplacementKind, ReplacementPlan } from './types';

/*
 * The most efficient replacement: passengers moving soonest, then the least
 * dead running, then the least knock-on to other passengers. Candidates that
 * cannot carry the passengers are kept with their reason. Pure.
 */

const upToGrid = (minutes: number): number => Math.ceil(minutes / ARRIVAL_GRID_MIN) * ARRIVAL_GRID_MIN;

type Draft = Omit<ReplacementCandidate, 'passengersMovingMinutes'>;

function finish(draft: Draft): ReplacementCandidate {
  return { ...draft, passengersMovingMinutes: draft.arrivalMinutes === null ? null : draft.arrivalMinutes + TRANSFER_MIN };
}

function spareCandidates(input: ReplacementInput): ReplacementCandidate[] {
  const at = input.incident.position;
  if (at === null) return [];
  const aboard = input.passengersAboard.value;
  const own = input.ownSpares.map((spare) => {
    const road = input.roadTime(spare.position, at);
    const ferry = input.ownFerryDriverSlotsFree > 0;
    return finish({
      id: `own:${spare.registrationNumber}`,
      kind: 'own_yard_spare',
      registrationNumber: spare.registrationNumber,
      depotId: input.incident.depotId,
      depotName: input.depotName,
      arrivalMinutes: upToGrid(DISPATCH_LEAD_MIN.own_yard_spare + road.minutes),
      deadKm: road.km,
      knockOnMinutes: 0,
      seatsFree: spare.seats,
      crew: ferry ? 'ferry_driver_needed' : 'no_ferry_driver',
      direction: null,
      excludedReason: spare.seats < aboard ? 'not_enough_seats' : ferry ? null : 'no_ferry_driver',
    });
  });
  const others = input.otherDepots.flatMap((depot) => {
    if (depot.spares <= 0) return [];
    const road = input.roadTime(depot.position, at);
    if (road.km > MAX_SPARE_RANGE_KM) return [];
    const ferry = depot.ferryDriverSlotsFree > 0;
    return [
      finish({
        id: `other:${depot.depotId}`,
        kind: 'other_depot_spare',
        registrationNumber: null,
        depotId: depot.depotId,
        depotName: depot.depotName,
        arrivalMinutes: upToGrid(DISPATCH_LEAD_MIN.other_depot_spare + road.minutes),
        deadKm: Math.round(road.km * 2 * 10) / 10,
        knockOnMinutes: depot.spares - 1 < OTHER_DEPOT_RESERVE_SPARES ? RESERVE_LOSS_MIN : 0,
        seatsFree: depot.seats,
        crew: ferry ? 'ferry_driver_needed' : 'no_ferry_driver',
        direction: null,
        excludedReason: depot.seats < aboard ? 'not_enough_seats' : ferry ? null : 'no_ferry_driver',
      }),
    ];
  });
  return [...own, ...others];
}

function followingCandidates(input: ReplacementInput): ReplacementCandidate[] {
  const at = input.incident.position;
  if (at === null) return [];
  const aboard = input.passengersAboard.value;
  const mySequence = input.incident.nearestStop?.sequence ?? null;
  return input.busesOnRoute
    .filter((bus) => bus.registrationNumber !== input.incident.registrationNumber)
    .flatMap((bus) => {
      const road = input.roadTime(bus.position, at);
      const known = mySequence !== null && bus.sequence !== null;
      const behind = known && (bus.sequence as number) <= (mySequence as number);
      if (known && !behind) return [];
      if (!known && road.km > FOLLOWING_MAX_BEHIND_KM) return [];
      const seatsFree = Math.max(0, bus.seats - bus.aboard);
      return [
        finish({
          id: `follow:${bus.registrationNumber}`,
          kind: 'following_bus',
          registrationNumber: bus.registrationNumber,
          depotId: input.incident.depotId,
          depotName: input.depotName,
          arrivalMinutes: upToGrid(road.minutes),
          deadKm: 0,
          knockOnMinutes: bus.aboard * TRANSFER_MIN,
          seatsFree,
          crew: 'own_crew_aboard',
          direction: known ? 'behind' : 'unknown',
          excludedReason: seatsFree < aboard ? 'not_enough_seats' : null,
        }),
      ];
    });
}

function blockEndingCandidates(input: ReplacementInput): ReplacementCandidate[] {
  const at = input.incident.position;
  if (at === null) return [];
  const aboard = input.passengersAboard.value;
  return input.blockEndingBuses.flatMap((bus) => {
    const road = input.roadTime(bus.position, at);
    if (road.km > BLOCK_END_RADIUS_KM) return [];
    return [
      finish({
        id: `ending:${bus.registrationNumber}`,
        kind: 'block_ending_bus',
        registrationNumber: bus.registrationNumber,
        depotId: input.incident.depotId,
        depotName: input.depotName,
        arrivalMinutes: upToGrid(DISPATCH_LEAD_MIN.block_ending_bus + road.minutes),
        deadKm: road.km,
        knockOnMinutes: 0,
        seatsFree: bus.seats,
        crew: 'original_crew_continues',
        direction: null,
        excludedReason: bus.seats < aboard ? 'not_enough_seats' : null,
      }),
    ];
  });
}

function baselineCandidate(input: ReplacementInput): ReplacementCandidate {
  const headway =
    input.cycleMinutes === null || input.busesOnRouteNow <= 0
      ? null
      : Math.min(MAX_HEADWAY_MIN, Math.max(MIN_HEADWAY_MIN, input.cycleMinutes / input.busesOnRouteNow));
  return finish({
    id: 'next',
    kind: 'next_scheduled',
    registrationNumber: null,
    depotId: input.incident.depotId,
    depotName: input.depotName,
    arrivalMinutes: headway === null ? null : upToGrid(headway / 2),
    deadKm: 0,
    knockOnMinutes: input.nextBusSeatsFree < input.passengersAboard.value ? TRANSFER_MIN * input.passengersAboard.value : 0,
    seatsFree: input.nextBusSeatsFree,
    crew: 'own_crew_aboard',
    direction: null,
    excludedReason: null,
  });
}

const byRank = (a: ReplacementCandidate, b: ReplacementCandidate): number =>
  (a.passengersMovingMinutes ?? Number.MAX_SAFE_INTEGER) - (b.passengersMovingMinutes ?? Number.MAX_SAFE_INTEGER) ||
  a.deadKm - b.deadKm ||
  a.knockOnMinutes - b.knockOnMinutes ||
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  compareText(a.id, b.id);

function capPerKind(candidates: readonly ReplacementCandidate[]): ReplacementCandidate[] {
  const counts = new Map<ReplacementKind, number>();
  return candidates.filter((c) => {
    const n = counts.get(c.kind) ?? 0;
    counts.set(c.kind, n + 1);
    return n < MAX_CANDIDATES_PER_KIND;
  });
}

function planKeyOf(input: ReplacementInput, recommended: ReplacementCandidate | null): string {
  const text = JSON.stringify([input.incident.registrationNumber, recommended?.id ?? null, recommended?.arrivalMinutes ?? null, input.passengersAboard.value]);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function planReplacement(input: ReplacementInput): ReplacementPlan {
  const clamped: string[] = [];
  if (input.incident.position === null) clamped.push('The bus has no usable position, so no replacement can be routed to it.');
  if (input.incident.profileState === 'not_loaded') clamped.push('Stop positions for this route are not loaded; the direction of other buses on it is not known.');
  if (input.incident.routeName === null) clamped.push('The bus carries no route name, so the following bus and the next scheduled bus are not known.');
  const all = [...spareCandidates(input), ...followingCandidates(input), ...blockEndingCandidates(input)].sort(byRank);
  const ranked = capPerKind(all.filter((c) => c.excludedReason === null));
  const excluded = capPerKind(all.filter((c) => c.excludedReason !== null));
  const baseline = baselineCandidate(input);
  const recommended = ranked.find((c) => c.direction !== 'unknown') ?? null;
  const coveredBy: NonNullable<ReplacementPlan['restOfBlock']>['coveredBy'] =
    recommended === null
      ? input.dayKnockOn !== null && input.dayKnockOn.blocksWithoutBusDelta <= 0 ? 'reassigned' : 'uncovered'
      : recommended.kind === 'following_bus'
        ? input.dayKnockOn !== null && input.dayKnockOn.blocksWithoutBusDelta <= 0 ? 'reassigned' : 'uncovered'
        : 'replacement_continues';
  return {
    incident: input.incident,
    passengersAboard: input.passengersAboard,
    remainingTrip: input.remainingTrip,
    candidates: [...ranked, ...excluded],
    recommended,
    baseline,
    restOfBlock: input.restOfBlock === null ? null : { ...input.restOfBlock, coveredBy },
    dayKnockOn: input.dayKnockOn,
    clamped,
    planKey: planKeyOf(input, recommended),
  };
}

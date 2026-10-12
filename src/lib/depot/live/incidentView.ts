import type { DepotBusRow } from '@/models/depotLive';
import type { CrewRepository } from '../crew/types';
import { TOWING_STATUS_WORD, REFERENCE_SPEED_KMPH, BLOCK_END_WINDOW_MIN } from '../incident/config';
import { declaredIncident, detectIncidents, type DetectInput } from '../incident/detect';
import { planReplacement } from '../incident/replace';
import type { BlockEndingBus, DayKnockOn, Incident, OtherDepotSpares, RemainingTrip, ReplacementInput, RouteBus, SpareBus } from '../incident/types';
import type { DeclaredIncidentResponse, IncidentView, IncidentsResponse } from '../incident/api';
import { distanceM, hasUsablePosition, haversineKm } from '../infer/geo';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import { roadDistanceKm } from '../optimise/rebalance';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { schedulePortsFor } from '../repositories/schedulePorts';
import { depotPositions } from '../routes/depotPositions';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import type { RouteProfile } from '../routes/types';
import type { SchedulePlan } from '../schedule/types';
import { serviceClassOfRoute, tripsPerBusHour } from '../service/need';
import { SEATS_BY_CLASS } from '../sim/config';
import { feedMinuteOn } from '../sim/dayPlan';
import { operatingDateOf } from '../sim/seed';
import type { Figure, LatLng } from '../types';
import { MINUTES_PER_HOUR, TENTH } from '../units';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { queryMemo } from './queryMemo';
import { heldSchedulePlan } from './scheduleView';

/*
 * One depot's incidents and the replacement plan for each, held per snapshot.
 * The detector reads the snapshot and the cached profiles; the plan reads the
 * depot's held schedule (spares, blocks, crew) and the need port for the
 * passengers aboard. No upstream call is ever made.
 */

const MAX_OTHER_DEPOTS = 6;

interface IncidentsBody {
  readonly depotName: string;
  readonly operatingDate: string;
  readonly incidents: readonly IncidentView[];
  readonly detection: IncidentsResponse['detection'];
}

const bodies = queryMemo<IncidentsBody | null>({ keep: (v) => v !== null });
const declared = queryMemo<IncidentView | null>({ keep: (v) => v !== null });

function roadTime(from: LatLng, to: LatLng): { readonly km: number; readonly minutes: number } {
  const km = roadDistanceKm(from, to, DEFAULT_REBALANCE_PARAMS.detourFactor);
  return { km: Math.round(km * TENTH) / TENTH, minutes: (km / REFERENCE_SPEED_KMPH) * MINUTES_PER_HOUR };
}

function detectInput(view: FleetSnapshotView, analysis: SnapshotAnalysis, depotId: string, operatingDate: string): DetectInput {
  return {
    depotId,
    feedNow: view.feedNow,
    operatingDate,
    rows: analysis.rowsByDepot.get(depotId) ?? [],
    stateOf: analysis.stateOf,
    locate: analysis.locate,
    profiles: cachedRouteProfiles(view, operatingDate),
    stoppedSince: analysis.stoppedSince,
  };
}

const isLocated = (s: { lat: number | null; lng: number | null }): s is { lat: number; lng: number } =>
  s.lat !== null && s.lng !== null && !(s.lat === 0 && s.lng === 0);

function nearestSequence(profile: RouteProfile | undefined, row: DepotBusRow): number | null {
  if (profile === undefined || !hasUsablePosition(row)) return null;
  let best: { d: number; sequence: number } | null = null;
  for (const stop of profile.stops) {
    if (!isLocated(stop)) continue;
    const d = distanceM(row.latitude, row.longitude, stop.lat, stop.lng);
    if (best === null || d < best.d) best = { d, sequence: stop.sequence };
  }
  return best?.sequence ?? null;
}

function remainingTripOf(incident: Incident, profile: RouteProfile | undefined, feedNow: string | null, operatingDate: string): RemainingTrip | null {
  if (incident.routeName === null) return null;
  const end = incident.scheduledEnd === null ? null : feedMinuteOn(incident.scheduledEnd, operatingDate);
  const now = feedMinuteOn(feedNow, operatingDate);
  const minutes = end !== null && now !== null ? Math.max(0, end - now) : null;
  if (profile === undefined || incident.nearestStop === null) return { stops: null, km: null, minutes, destination: profile?.destination?.name ?? null };
  const after = [...profile.stops].filter((s) => s.sequence > (incident.nearestStop as { sequence: number }).sequence).sort((a, b) => a.sequence - b.sequence);
  let km = 0;
  let previous: LatLng | null = incident.position;
  for (const stop of after) {
    if (!isLocated(stop)) continue;
    if (previous !== null) km += haversineKm(previous.lat, previous.lng, stop.lat, stop.lng);
    previous = { lat: stop.lat, lng: stop.lng };
  }
  return { stops: after.length, km: Math.round(km * TENTH) / TENTH, minutes, destination: profile.destination?.name ?? null };
}

/** Passengers aboard one bus of the route at the feed hour: a busiest-stretch estimate, capped at the seats. */
async function aboardOf(view: FleetSnapshotView, services: ServiceRepositories, crew: CrewRepository, routeName: string | null, operatingDate: string, busesOnRouteNow: number): Promise<Figure<number>> {
  if (routeName === null) return { value: 0, provenance: 'modelled', note: 'no route name' };
  const seats = SEATS_BY_CLASS[serviceClassOfRoute(routeName)];
  const need = await schedulePortsFor(view, services, crew).need.needByHour(routeName, operatingDate);
  const hour = Math.floor((feedMinuteOn(view.feedNow, operatingDate) ?? 0) / MINUTES_PER_HOUR);
  const boardings = need.boardingsByHour[hour] ?? 0;
  const perBus = boardings * need.need.busiestStretchShare / Math.max(1, busesOnRouteNow * tripsPerBusHour(need.need));
  return { value: Math.min(seats, Math.max(0, Math.round(perBus))), provenance: 'modelled', note: 'busiest-stretch load for this hour' };
}

function dayKnockOnOf(base: SchedulePlan, out: SchedulePlan): DayKnockOn {
  return {
    blocksWithoutBusDelta: base.blocks.length - out.blocks.length + (out.assignment.blocksWithoutBus - base.assignment.blocksWithoutBus),
    uncoveredBusHoursDelta: out.figures.uncoveredBusHours - base.figures.uncoveredBusHours,
  };
}

async function replacementFor(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
  incident: Incident,
  depotName: string,
  operatingDate: string,
  crew: CrewRepository,
  services: ServiceRepositories,
): Promise<IncidentView> {
  const depotId = incident.depotId;
  const profiles = cachedRouteProfiles(view, operatingDate);
  const profile = incident.routeName === null ? undefined : profiles.get(incident.routeName);
  const feedMinute = feedMinuteOn(view.feedNow, operatingDate);
  const rows = analysis.rowsByDepot.get(depotId) ?? [];
  const rowOf = new Map(rows.map((r) => [r.registrationNumber, r] as const));
  const seatsOf = (route: string | null): number => SEATS_BY_CLASS[serviceClassOfRoute(route ?? '')];
  const [held, out] = await Promise.all([
    heldSchedulePlan(view, depotId, crew, services),
    heldSchedulePlan(view, depotId, crew, services, { busesOutOfService: [incident.registrationNumber] }),
  ]);
  const plan = held?.plan ?? null;
  const onRoute = view.rows.filter((r) => incident.routeName !== null && r.routeName === incident.routeName && (analysis.stateOf(r) === 'in_service' || analysis.stateOf(r) === 'on_road'));
  const aboard = await aboardOf(view, services, crew, incident.routeName, operatingDate, Math.max(1, onRoute.length));
  const ownSpares: SpareBus[] = (plan?.assignment.spareBuses ?? []).flatMap((reg) => {
    const row = rowOf.get(reg);
    if (row === undefined || !hasUsablePosition(row) || analysis.locate(row).location !== 'in_yard') return [];
    return [{ registrationNumber: reg, position: { lat: row.latitude, lng: row.longitude }, seats: seatsOf(row.routeName) }];
  });
  const busOf = new Map((plan?.assignment.assignments ?? []).map((a) => [a.blockId, a.registrationNumber] as const));
  const blockEndingBuses: BlockEndingBus[] = (plan?.blocks ?? []).flatMap((block) => {
    const reg = busOf.get(block.id) ?? null;
    const row = reg === null ? undefined : rowOf.get(reg);
    if (reg === null || row === undefined || !hasUsablePosition(row) || feedMinute === null) return [];
    if (block.endMin < feedMinute || block.endMin > feedMinute + BLOCK_END_WINDOW_MIN || reg === incident.registrationNumber) return [];
    return [{ registrationNumber: reg, position: { lat: row.latitude, lng: row.longitude }, seats: seatsOf(row.routeName), endMin: block.endMin }];
  });
  const shiftsNow = (plan?.crew.shifts ?? []).filter((s) => feedMinute !== null && s.driverSlot !== null && s.startMin <= feedMinute && s.endMin > feedMinute).length;
  const ownFerryDriverSlotsFree = Math.max(0, (plan?.crew.available.driver ?? 0) - shiftsNow);
  const positions = depotPositions(analysis.depots, analysis.yards);
  const otherDepots: OtherDepotSpares[] = incident.position === null
    ? []
    : analysis.depots
        .filter((d) => d.kind === 'depot' && d.id !== depotId)
        .flatMap((d) => {
          const at = positions.get(d.id);
          if (at === undefined) return [];
          const spares = (analysis.rowsByDepot.get(d.id) ?? []).filter((r) => analysis.stateOf(r) === 'standing' && analysis.locate(r).location === 'in_yard').length;
          const depot: OtherDepotSpares = { depotId: d.id, depotName: d.name, position: at.position, spares, seats: SEATS_BY_CLASS.ordinary, ferryDriverSlotsFree: 1 };
          return [{ depot, km: haversineKm(at.position.lat, at.position.lng, (incident.position as LatLng).lat, (incident.position as LatLng).lng) }];
        })
        .sort((a, b) => a.km - b.km)
        .slice(0, MAX_OTHER_DEPOTS)
        .map((entry) => entry.depot);
  const busesOnRoute: RouteBus[] = onRoute.flatMap((r) => {
    if (!hasUsablePosition(r)) return [];
    return [{ registrationNumber: r.registrationNumber, position: { lat: r.latitude, lng: r.longitude }, seats: seatsOf(r.routeName), aboard: aboard.value, sequence: nearestSequence(profile, r) }];
  });
  const timing = incident.routeName === null ? null : await schedulePortsFor(view, services, crew).timing.timingFor(incident.routeName, operatingDate);
  const own = plan?.assignment.assignments.find((a) => a.registrationNumber === incident.registrationNumber) ?? null;
  const ownBlock = own === null ? null : (plan?.blocks.find((b) => b.id === own.blockId) ?? null);
  const input: ReplacementInput = {
    incident,
    depotName,
    feedMinute,
    remainingTrip: remainingTripOf(incident, profile, view.feedNow, operatingDate),
    passengersAboard: aboard,
    ownSpares,
    ownFerryDriverSlotsFree,
    otherDepots,
    busesOnRoute,
    blockEndingBuses,
    cycleMinutes: timing?.cycleMinutes ?? null,
    busesOnRouteNow: onRoute.length,
    nextBusSeatsFree: Math.max(0, seatsOf(incident.routeName) - aboard.value),
    restOfBlock: ownBlock === null ? null : { blockId: ownBlock.id, remainingPieces: ownBlock.pieces.filter((p) => feedMinute === null || p.endMin > feedMinute).length, endMin: ownBlock.endMin },
    dayKnockOn: plan !== null && out !== null ? dayKnockOnOf(plan, out.plan) : null,
    roadTime,
  };
  const built = planReplacement(input);
  const notes = [...built.clamped];
  if (otherDepots.length > 0) notes.push('Driver availability at other depots is not checked; one free slot is assumed.');
  if (row(incident, rowOf)?.tripStatus?.trim().toLowerCase() === TOWING_STATUS_WORD) notes.push('The feed reports this bus under tow.');
  return { incident, plan: { ...built, clamped: notes } };
}

const row = (incident: Incident, rowOf: ReadonlyMap<string, DepotBusRow>): DepotBusRow | undefined => rowOf.get(incident.registrationNumber);

async function revisionKey(view: FleetSnapshotView, depotId: string, services: ServiceRepositories): Promise<string> {
  return `${depotId}|${operatingDateOf(view.feedNow, view.fetchedAt)}|${routeCatalogueRevision()}|${await services.scheduled.revision()}`;
}

async function bodyFor(view: FleetSnapshotView, analysis: SnapshotAnalysis, depotId: string, crew: CrewRepository, services: ServiceRepositories): Promise<IncidentsBody | null> {
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const { incidents, summary } = detectIncidents(detectInput(view, analysis, depotId, operatingDate));
  const views = await Promise.all(incidents.map((incident) => replacementFor(view, analysis, incident, depot.name, operatingDate, crew, services)));
  return { depotName: depot.name, operatingDate, incidents: views, detection: summary };
}

/** The depot's suspected incidents, each with its replacement plan; null for an unknown depot. */
export async function buildIncidentsResponse(view: FleetSnapshotView, depotId: string, crewRepository: CrewRepository, services: ServiceRepositories): Promise<IncidentsResponse | null> {
  const analysis = analyseSnapshot(view);
  const body = await bodies.hold(analysis, await revisionKey(view, depotId, services), () => bodyFor(view, analysis, depotId, crewRepository, services));
  return body === null ? null : { ...feedEnvelope(view), depotId, ...body };
}

/** A bus the person declares broken down: its plan, or null when the depot or the bus is unknown. */
export async function declaredIncidentResponse(view: FleetSnapshotView, depotId: string, registration: string, crewRepository: CrewRepository, services: ServiceRepositories): Promise<DeclaredIncidentResponse | 'no_depot' | 'no_bus'> {
  const analysis = analyseSnapshot(view);
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return 'no_depot';
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const key = `${await revisionKey(view, depotId, services)}|${registration.trim().toLowerCase()}`;
  const built = await declared.hold(analysis, key, async () => {
    const incident = declaredIncident(registration, detectInput(view, analysis, depotId, operatingDate));
    return incident === null ? null : replacementFor(view, analysis, incident, depot.name, operatingDate, crewRepository, services);
  });
  return built === null ? 'no_bus' : { ...feedEnvelope(view), depotId, depotName: depot.name, operatingDate, incident: built };
}

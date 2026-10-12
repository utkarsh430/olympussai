import type { DepotBusRow } from '@/models/depotLive';
import { gpsAgeMinutes, isRecentlyHeard, notHeardMinutes } from '../infer/busState';
import { distanceM, hasUsablePosition } from '../infer/geo';
import { isScheduledForFeedDate } from '../infer/outshed';
import type { LocatedBus } from '../infer/types';
import { terminalsOf } from '../routes/deadKm';
import type { RouteProfile, RouteStop } from '../routes/types';
import { feedMinuteOn } from '../sim/dayPlan';
import { compareText } from '../stats/order';
import type { BusOpState } from '../types';
import { MS_PER_MINUTE } from '../units';
import { NEAR_YARD_KM, NOT_HEARD_ON_ROUTE_MIN, STOPPED_MIN, STOP_RADIUS_M, TERMINAL_RADIUS_M, TOWING_STATUS_WORD } from './config';
import type { StoppedSince } from './stoppedSince';
import type { DetectionSummary, ExclusionReason, Incident, IncidentConfidence, IncidentSignal } from './types';

/*
 * Which of a depot's buses may have broken down on the road, from one
 * snapshot: the feed's own tow status and emergency flag (high), a bus
 * standing away from every stop, terminal and yard on a running journey
 * (medium once it has stood ten minutes, else low), or one not heard on its
 * journey (low). Pure: the clock is the feed's. Stop positions come only from
 * profiles already cached; none are fetched.
 */

export interface DetectInput {
  readonly depotId: string;
  readonly feedNow: string | null;
  readonly operatingDate: string;
  readonly rows: readonly DepotBusRow[];
  readonly stateOf: (row: DepotBusRow) => BusOpState;
  readonly locate: (row: DepotBusRow) => LocatedBus;
  readonly profiles: ReadonlyMap<string, RouteProfile>;
  readonly stoppedSince: ReadonlyMap<string, StoppedSince>;
}

const CONFIDENCE_ORDER: Readonly<Record<IncidentConfidence, number>> = { high: 0, medium: 1, low: 2 };

const isLocated = (stop: RouteStop): stop is RouteStop & { lat: number; lng: number } =>
  stop.lat !== null && stop.lng !== null && !(stop.lat === 0 && stop.lng === 0);

function nearestStop(profile: RouteProfile, lat: number, lng: number): Incident['nearestStop'] {
  let best: Incident['nearestStop'] = null;
  for (const stop of profile.stops) {
    if (!isLocated(stop)) continue;
    const d = Math.round(distanceM(lat, lng, stop.lat, stop.lng));
    if (best === null || d < best.distanceM) best = { name: stop.name, distanceM: d, sequence: stop.sequence };
  }
  return best;
}

function atTerminal(profile: RouteProfile, lat: number, lng: number): boolean {
  const terminals = terminalsOf(profile);
  if (terminals === null) return false;
  return [terminals.first, terminals.last].some((t) => distanceM(lat, lng, t.lat, t.lng) <= TERMINAL_RADIUS_M);
}

/** Minutes of the feed clock since `since`, read as digits on the same clock. */
function minutesSince(since: string, feedNow: string, operatingDate: string): number | null {
  const a = feedMinuteOn(since, operatingDate);
  const b = feedMinuteOn(feedNow, operatingDate);
  if (a === null || b === null) {
    const diff = (Date.parse(feedNow) - Date.parse(since)) / MS_PER_MINUTE;
    return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
  }
  return Math.max(0, b - a);
}

/** The journey's scheduled end is after the feed time (the digits are on one clock). */
function scheduledEndAhead(row: DepotBusRow, feedNow: string | null): boolean {
  if (row.scheduledEnd === null || feedNow === null) return false;
  return row.scheduledEnd.slice(0, 16) > feedNow.slice(0, 16);
}

type Verdict = { readonly excluded: ExclusionReason } | { readonly incident: Incident };

function judge(row: DepotBusRow, input: DetectInput): Verdict {
  const state = input.stateOf(row);
  if (row.depotId === null || state === 'off_road') return { excluded: 'off_road' };
  const signals: IncidentSignal[] = [];
  if ((row.tripStatus ?? '').trim().toLowerCase() === TOWING_STATUS_WORD) signals.push('towing');
  if (row.emergency === true) signals.push('emergency_flag');
  const strong = signals.length > 0;
  const located = input.locate(row);
  const positioned = hasUsablePosition(row);
  const profile = row.routeName === null ? undefined : input.profiles.get(row.routeName);
  const stop = profile && positioned ? nearestStop(profile, row.latitude, row.longitude) : null;
  if (!strong) {
    if (located.location === 'in_yard') return { excluded: 'in_yard' };
    if (located.location === 'at_other_yard') return { excluded: 'at_other_yard' };
    if (!positioned) return { excluded: 'no_position' };
    const today = isScheduledForFeedDate(row, input.feedNow);
    if (!today) return { excluded: 'no_journey_today' };
    if (row.scheduledStart !== null && input.feedNow !== null && row.scheduledStart.slice(0, 16) > input.feedNow.slice(0, 16)) return { excluded: 'trip_not_started' };
    if (!scheduledEndAhead(row, input.feedNow)) return { excluded: 'trip_ended' };
    if (state === 'in_service' || state === 'on_road') return { excluded: 'moving' };
    if (located.distanceFromYardKm !== null && located.distanceFromYardKm <= NEAR_YARD_KM) return { excluded: 'near_yard' };
    if (profile && stop !== null && stop.distanceM <= STOP_RADIUS_M) return { excluded: 'at_stop' };
    if (profile && atTerminal(profile, row.latitude, row.longitude)) return { excluded: 'at_terminal' };
    const age = gpsAgeMinutes(row, input.feedNow);
    const notHeard = notHeardMinutes(row, state, input.feedNow);
    if (state === 'dark' || (notHeard !== null && notHeard >= NOT_HEARD_ON_ROUTE_MIN) || !isRecentlyHeard(age)) signals.push('not_heard_on_route');
    else signals.push('stopped_on_route');
    if (row.mainPowerOn === false && signals.includes('stopped_on_route')) signals.push('power_off');
  }
  const held = input.stoppedSince.get(row.registrationNumber);
  const stoppedMinutes = held && input.feedNow !== null ? minutesSince(held.since, input.feedNow, input.operatingDate) : null;
  const profiled = profile !== undefined;
  const confidence: IncidentConfidence = strong
    ? 'high'
    : signals.includes('stopped_on_route') && profiled && ((stoppedMinutes !== null && stoppedMinutes >= STOPPED_MIN) || signals.includes('power_off'))
      ? 'medium'
      : 'low';
  return {
    incident: {
      id: `inc:${row.registrationNumber}:${input.operatingDate}`,
      origin: 'detected',
      registrationNumber: row.registrationNumber,
      depotId: row.depotId,
      routeName: row.routeName,
      journeyId: row.journeyId,
      position: positioned ? { lat: row.latitude, lng: row.longitude } : null,
      stoppedMinutes,
      signals,
      confidence,
      nearestStop: stop,
      profileState: profiled ? 'profiled' : 'not_loaded',
      scheduledEnd: row.scheduledEnd,
      lastHeardMin: gpsAgeMinutes(row, input.feedNow),
    },
  };
}

const byPressure = (a: Incident, b: Incident): number =>
  CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
  (b.stoppedMinutes ?? -1) - (a.stoppedMinutes ?? -1) ||
  compareText(a.registrationNumber, b.registrationNumber);

/** The depot's suspected incidents, most pressing first, and what was considered and excluded. */
export function detectIncidents(input: DetectInput): { readonly incidents: readonly Incident[]; readonly summary: DetectionSummary } {
  const seen = new Set<string>();
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const incidents: Incident[] = [];
  let routesNotProfiled = 0;
  const routes = new Set<string>();
  for (const row of input.rows) {
    if (seen.has(row.registrationNumber)) continue;
    seen.add(row.registrationNumber);
    if (row.routeName !== null && !routes.has(row.routeName)) {
      routes.add(row.routeName);
      if (!input.profiles.has(row.routeName)) routesNotProfiled += 1;
    }
    const verdict = judge(row, input);
    if ('excluded' in verdict) excluded[verdict.excluded] = (excluded[verdict.excluded] ?? 0) + 1;
    else incidents.push(verdict.incident);
  }
  incidents.sort(byPressure);
  return { incidents, summary: { considered: seen.size, excluded, routesNotProfiled } };
}

/** A bus declared broken down by a person: whatever is true of it, with no exclusion applied. */
export function declaredIncident(registration: string, input: DetectInput): Incident | null {
  const key = registration.trim().toLowerCase();
  const row = input.rows.find((r) => r.registrationNumber.trim().toLowerCase() === key);
  if (row === undefined) return null;
  const verdict = judge(row, input);
  const base: Incident =
    'incident' in verdict
      ? verdict.incident
      : {
          id: `inc:${row.registrationNumber}:${input.operatingDate}`,
          origin: 'declared',
          registrationNumber: row.registrationNumber,
          depotId: row.depotId ?? input.depotId,
          routeName: row.routeName,
          journeyId: row.journeyId,
          position: hasUsablePosition(row) ? { lat: row.latitude, lng: row.longitude } : null,
          stoppedMinutes: null,
          signals: [],
          confidence: 'low',
          nearestStop: null,
          profileState: row.routeName !== null && input.profiles.has(row.routeName) ? 'profiled' : 'not_loaded',
          scheduledEnd: row.scheduledEnd,
          lastHeardMin: gpsAgeMinutes(row, input.feedNow),
        };
  return { ...base, origin: 'declared' };
}

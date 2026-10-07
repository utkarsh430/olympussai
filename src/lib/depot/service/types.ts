import type { DepotFeedEnvelope } from '../api';
import type { ServiceClass } from '../sim/types';
import type { Coverage, Provenance, StateMix } from '../types';

/*
 * Service by the hour: the shared shapes for one route's day, hour by hour.
 *
 * Three layers meet per route and hour. Deployment is observed from the live feed
 * for the hours this server saw (DERIVED) and taken from the modelled operating day
 * for the rest (MODELLED). Scheduled trips come from the journeys the feed itself
 * reports and from full-day timetables loaded on request (DERIVED, partial).
 * Passenger demand is modelled until ticketing is connected (MODELLED). Every
 * figure says which it is, and a proposal says what it rests on.
 *
 * Times are the feed clock's own digits (Indian wall-clock time behind a misleading
 * `Z`); an operating date is `YYYY-MM-DD`; an hour is 0 to 23 of that date.
 */

/** Minutes of feed time one sampling slot spans; 288 slots a day. */
export const SLOT_MINUTES = 5;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
/** An hour is observed only when at least this many of its 12 slots were sampled. */
export const MIN_SLOTS_FOR_AN_HOUR = 6;

/** One route in one 5-minute slot, as the newest snapshot of that slot showed it. */
export interface RouteSlotSample {
  readonly routeName: string;
  /** Buses carrying the route name, whatever their state. */
  readonly buses: number;
  readonly states: StateMix;
  readonly delayMedianMin: number | null;
  /** Buses late beyond the late threshold, and how many buses carried a delay at all. */
  readonly late: number;
  readonly delayCovered: number;
  /** Buses per operating depot id. */
  readonly operators: Readonly<Record<string, number>>;
}

/** One depot in one slot: the pool an "add" proposal may draw from. */
export interface DepotSlotSample {
  readonly depotId: string;
  readonly fleet: number;
  readonly states: StateMix;
  /** Standing buses of this depot inside its own yard circle; null when no yard is established. */
  readonly standingInYard: number | null;
  /** Buses on the road or in service that carry no route name at all. */
  readonly unroutedOnRoad: number;
}

/** Everything one snapshot contributes to one slot. */
export interface SlotSample {
  readonly operatingDate: string;
  /** 0 to 287 within the operating date. */
  readonly slot: number;
  /** The feed time the snapshot was read at (its own digits). */
  readonly feedNow: string;
  readonly totalRows: number;
  readonly routedRows: number;
  readonly routes: readonly RouteSlotSample[];
  readonly depots: readonly DepotSlotSample[];
}

/** One route's hour, rolled up from the slots observed in it. */
export interface ObservedRouteHour {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly hour: number;
  readonly slotsObserved: number;
  /**
   * Deployed = in service + on road, carrying the route name: the buses running it. Standing
   * buses that carry the name are in `states` only, never in the deployed figure.
   */
  readonly deployedMean: number;
  readonly deployedMax: number;
  readonly inServiceMean: number;
  readonly states: StateMix;
  readonly delayMedianMin: number | null;
  readonly lateShare: number | null;
  readonly delayCoverage: Coverage;
  /** Mean buses per operating depot id over the hour. */
  readonly operators: Readonly<Record<string, number>>;
}

/** One depot's hour: the mean standing pool and the unrouted buses that could hide a gap. */
export interface ObservedDepotHour {
  readonly depotId: string;
  readonly operatingDate: string;
  readonly hour: number;
  readonly slotsObserved: number;
  readonly standingInYardMean: number | null;
  readonly unroutedOnRoadMean: number;
}

/** A journey the feed itself reports on a bus row (about a fifth of buses carry one). */
export interface LedgerJourney {
  readonly operatingDate: string;
  readonly journeyId: string;
  readonly routeName: string;
  readonly registrationNumber: string;
  /** Feed digits, `HH:MM` of the operating date; null when the row lacked it. */
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly actualStart: string | null;
  /** The feed's delay figure, in the feed's own unit, as last seen. */
  readonly delayMinutes: number | null;
  /** When this journey was last seen on a row, feed digits. */
  readonly lastSeen: string;
}

/** One trip of one bus's day, as the corporation's schedule service lists it. */
export interface ScheduledTrip {
  /** The date the trip was asked for. */
  readonly forDate: string;
  /** The date the schedule service answered with (a fallback date is "borrowed"). */
  readonly answeredDate: string;
  readonly registrationNumber: string;
  readonly journeyId: string;
  readonly journeyCode: string | null;
  readonly routeName: string;
  /** `HH:MM` feed digits. */
  readonly startTime: string;
  readonly endTime: string | null;
  readonly stops: number;
}

/** Scheduled supply for one route and hour: bus-hours from the trips overlapping it. */
export interface ScheduledRouteHour {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly hour: number;
  /** Trips starting in the hour. */
  readonly tripsStarting: number;
  /** Sum over trips of the minutes overlapping the hour, divided by 60. */
  readonly busHours: number;
  /** Buses whose full day is known, of the distinct buses seen on the route that date. */
  readonly coverage: Coverage;
  /** True when every known trip came from the feed's own rows, none from a loaded timetable. */
  readonly fromFeedRowsOnly: boolean;
}

/** Modelled passenger demand for one route and hour. */
export interface RouteHourDemand {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly hour: number;
  /** Boardings in the hour. */
  readonly boardings: number;
  /** The route spread the model allows (plus or minus a quarter today). */
  readonly band: { readonly low: number; readonly high: number };
  readonly provenance: Extract<Provenance, 'modelled'>;
  /** One short sentence of what the figure rests on. */
  readonly basis: string;
}

/** The modelled operating day's deployment per hour, for hours this server did not observe. */
export interface ModelledRouteHour {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly hour: number;
  /** Bus-hours of the route's modelled duties that had a bus: buses running it, as observed counts deployed. */
  readonly deployed: number;
}

/** What the need formula was given for one route. */
export interface NeedInputs {
  readonly routeName: string;
  readonly serviceClass: ServiceClass;
  readonly seatsPerBus: number;
  /** Minutes, from the feed's schedule, the route profile or the trip model. */
  readonly journeyMinutes: number;
  readonly journeyMinutesProvenance: Provenance;
  readonly layoverMinutes: number;
  readonly targetLoad: number;
  readonly busiestStretchShare: number;
}

/** Which the deployed figure of an hour came from. */
export type HourBasis = 'observed' | 'modelled' | 'current';

/** One hour of one route's day, every layer side by side. */
export interface RouteHourFigures {
  readonly hour: number;
  /** Buses running the route (in service or on the road) in every basis; standing buses never count. */
  readonly deployed: number;
  readonly deployedBasis: HourBasis;
  readonly slotsObserved: number;
  readonly scheduled: number | null;
  readonly scheduledTripsStarting: number | null;
  readonly demand: number;
  readonly demandBand: { readonly low: number; readonly high: number };
  readonly needed: number;
  /** needed minus deployed; positive is short. */
  readonly gap: number;
  readonly delayMedianMin: number | null;
  readonly lateShare: number | null;
  readonly delayCoverage: Coverage;
}

/** What a proposal rests on: measured data only, measured plus modelled demand, or modelled only. */
export type ProposalTier = 'A' | 'B' | 'C';

export type ProposalKind =
  | 'add_buses'
  | 'hold_buses'
  | 'trips_not_run'
  | 'service_span_gap'
  | 'headway_gap'
  | 'revise_running_time';

/** A band of consecutive hours, `fromHour` to `toHour` inclusive. */
export interface HourBand {
  readonly fromHour: number;
  readonly toHour: number;
}

export interface ImpactRange {
  readonly low: number;
  readonly high: number;
}

/** The modelled consequence of acting on a proposal, always a range. */
export interface ProposalImpact {
  readonly passengersPerDay: ImpactRange;
  readonly revenuePerDay: ImpactRange;
  readonly busKmPerDay: ImpactRange;
  readonly costPerDay: ImpactRange;
  readonly provenance: Extract<Provenance, 'modelled'>;
}

/** Where the buses of an "add" would come from, or where a "hold" releases them. */
export interface ProposalSource {
  readonly depotId: string;
  readonly depotName: string;
  /** Standing buses in that depot's yard in the hour before the band, as observed; null when modelled. */
  readonly standingInYard: number | null;
  readonly basis: 'observed' | 'modelled';
  /** Buses the modelled day plan leaves idle at that depot; set only when the basis is modelled. */
  readonly idleInDayPlan?: number | null;
}

export interface Proposal {
  /** Deterministic: a hash of operating date, kind, route and band. */
  readonly id: string;
  readonly kind: ProposalKind;
  readonly routeName: string;
  readonly operatingDate: string;
  readonly band: HourBand;
  readonly deployed: number;
  readonly scheduled: number | null;
  readonly needed: number;
  /** Buses to add (positive) or hold (negative); zero for tier-A findings about the timetable. */
  readonly change: number;
  readonly source: ProposalSource | null;
  readonly tier: ProposalTier;
  /** Set when the operating depot's unrouted buses on the road could cover the gap. */
  readonly maybeCoveredByUnrouted: boolean;
  /** One fixed sentence per kind, with the figures filled in. */
  readonly reason: string;
  readonly impact: ProposalImpact | null;
}

/** Punctuality of one hour of one route's day, from the journeys the feed reported (DERIVED). */
export interface HourReliability {
  readonly hour: number;
  readonly delayMedianMin: number | null;
  /** Share of the journeys carrying a delay that ran more than LATE_AFTER_MIN behind. */
  readonly lateShare: number | null;
  /** Journeys carrying a delay, of the journeys placed in the hour. */
  readonly coverage: Coverage;
}

/** The per-route hourly view, as the API answers it. */
export interface RouteHourlyBody {
  readonly routeName: string;
  readonly routeDescription: string | null;
  readonly serviceClass: ServiceClass;
  readonly operatingDate: string;
  /** The feed clock's hour, 0 to 23, or null without a feed clock. */
  readonly currentHour: number | null;
  readonly hours: readonly RouteHourFigures[];
  readonly need: NeedInputs;
  /** Hours this server observed today, and since when; null when it has observed none. */
  readonly observed: { readonly since: string; readonly hours: number; readonly samples: number } | null;
  readonly scheduledCoverage: Coverage;
  /**
   * Feed-wide, not this route's: the buses now reporting any route name, of every bus in the
   * feed. Only buses that report a route name can be counted on a route.
   */
  readonly routeCoverage: Coverage;
  /** Standing buses now carrying the route name: not deployed, said once on the page. */
  readonly standingNow: number;
  readonly proposals: readonly Proposal[];
  readonly demandBasis: string;
  /** Punctuality by hour from the journeys the feed reported, placed by scheduled start; 24 hours. */
  readonly reliability: readonly HourReliability[];
  /** Every bus seen carrying the route name in the date, sorted: the timetable loader's list. */
  readonly busesOnRoute: readonly string[];
  /** The buses whose whole day is recorded for the date (the scheduled coverage's count), sorted. */
  readonly busesWithDay: readonly string[];
  /** Dates whose timetable stands in for this date's (the server had none for it), sorted. */
  readonly timetableBorrowedFrom: readonly string[];
}

export interface RouteHourlyResponse extends RouteHourlyBody, DepotFeedEnvelope {}

/** What this server has observed of a date: since when (`HH:MM` feed digits), hours, samples. */
export type ObservedSummary = NonNullable<RouteHourlyBody['observed']>;

/*
 * The network's hours, as the copilot reads them. The network view (`live/networkHourlyView.ts`)
 * fills this shape; the copilot's network facts and the daily brief are built against it.
 * Every field below is what those facts need: the view may carry more.
 */

/** The hour bands of the operating day: early 04–06, morning peak 06–10, midday 10–16, evening peak 16–20, late 20–24. */
export type ServiceBandKey = 'early' | 'morning_peak' | 'midday' | 'evening_peak' | 'late';

/** One route's mean gap over a band; positive is short, negative over-served. */
export interface NetworkRouteGap {
  readonly routeName: string;
  /** The depot running most of the route's buses; null when none is known. */
  readonly depotId: string | null;
  readonly depotName: string | null;
  /** Mean of the band's hourly gaps, buses, one decimal. */
  readonly gap: number;
  /** True when every hour of the band was observed by this server; otherwise modelled hours count in it. */
  readonly observed: boolean;
}

/** One band across the network: the short and over-served routes, largest first. */
export interface NetworkBandSummary {
  readonly key: ServiceBandKey;
  readonly band: HourBand;
  readonly shortRoutes: readonly NetworkRouteGap[];
  readonly overRoutes: readonly NetworkRouteGap[];
  /** Sum of the short routes' gaps and of the over-served routes' surplus, buses. */
  readonly busesShort: number;
  readonly busesOver: number;
}

/** A route's proposal on the network page, with the depot that runs the route. */
export interface NetworkProposal extends Proposal {
  readonly depotId: string | null;
}

/** Decisions recorded on the network's proposals today. */
export interface ProposalDecisionCounts {
  readonly accepted: number;
  readonly declined: number;
  readonly open: number;
}

/** The network's day by band, as the API answers it, less the envelope. */
export interface NetworkHourlyBody {
  readonly operatingDate: string;
  readonly currentHour: number | null;
  readonly observed: ObservedSummary | null;
  /** In band order, early first. */
  readonly bands: readonly NetworkBandSummary[];
  /** Every route's proposals, largest modelled passenger impact first. */
  readonly proposals: readonly NetworkProposal[];
  /** Buses the reallocation moves within a depot and between depots, over the day. */
  readonly moves: { readonly withinDepots: number; readonly betweenDepots: number };
  /** Null until a decision trail exists. */
  readonly decisions: ProposalDecisionCounts | null;
}

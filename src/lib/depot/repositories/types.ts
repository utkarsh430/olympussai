import type { UpstreamSource } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { CrewRepository } from '../crew/types';
import type { FuelRepository } from '../fuel/types';
import type { RevenueRepository } from '../revenue/types';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from '../sim/types';
import type {
  LedgerJourney,
  ObservedDepotHour,
  ObservedRouteHour,
  ObservedSummary,
  ScheduledTrip,
} from '../service/types';

/**
 * The seam between depot logic and where its data comes from.
 *
 * Depot modules never call the live snapshot, a modelled generator or (later)
 * a database directly. They ask a repository. Today the fleet repository reads
 * the in-memory live snapshot and the history repository generates a modelled
 * series; when a real feed or a database arrives it is a new adapter behind
 * the same interface, wired in the composition root (`./index.ts`).
 */

/** One consistent read of the fleet: every row comes from the same payload. */
export interface FleetSnapshotView {
  readonly rows: readonly DepotBusRow[];
  /** Newest `receivedTime` in the payload: the reference for every age. */
  readonly feedNow: string | null;
  /** Server time the snapshot was built. Also the memoisation key for views. */
  readonly fetchedAt: string;
  readonly source: UpstreamSource;
  readonly stale: boolean;
  readonly recordCount: number;
  /**
   * Rows whose receive time was later than the server's own clock allows and were ignored
   * when the feed clock was read. Above zero, the feed clock may lag the newest report.
   */
  readonly feedClockAheadRows?: number;
}

export interface FleetRepository {
  snapshot(): Promise<FleetSnapshotView>;
}

export interface HistoryRepository {
  /** A daily series for `metric`, ending on `anchor.date` at `anchor.value`. */
  series(
    metric: MetricKey,
    scope: HistoryScope,
    days: number,
    anchor: SeriesAnchor,
  ): Promise<readonly SeriesPoint[]>;
}

/**
 * What this server observed of an operating date, hour by hour: the record
 * "deployed per hour" is read from (DERIVED). In memory per process today; a
 * database written by a 5-minute sampler can replace it behind this interface.
 */
export interface HourlyObservationRepository {
  /** The route's observed hours of the date, in hour order; hours not observed are absent. */
  routeHours(routeName: string, operatingDate: string): Promise<readonly ObservedRouteHour[]>;
  /** The depot's observed hours of the date, in hour order; hours not observed are absent. */
  depotHours(depotId: string, operatingDate: string): Promise<readonly ObservedDepotHour[]>;
  /** Since when the date was observed, its observed hours and samples; null when none. */
  observedSummary(operatingDate: string): Promise<ObservedSummary | null>;
  /** Distinct buses seen carrying the route name in the date. */
  distinctBusesOnRoute(routeName: string, operatingDate: string): Promise<number>;
  /** The journeys the feed's own rows reported on the route in the date, by journey id. */
  journeysOnRoute(routeName: string, operatingDate: string): Promise<readonly LedgerJourney[]>;
}

/**
 * Every trip of the bus days looked up from the corporation's schedule
 * service (DERIVED, partial: only the buses looked up). In memory today.
 */
export interface ScheduledTripRepository {
  /** Records one bus's day; recording the same bus and date again replaces it. */
  recordBusDay(trips: readonly ScheduledTrip[]): Promise<void>;
  /** The trips on the route asked for that date, by start time then registration. */
  tripsForRoute(routeName: string, forDate: string): Promise<readonly ScheduledTrip[]>;
  /** Registrations whose recorded day has a trip on the route, sorted. */
  knownBusesOnRoute(routeName: string, forDate: string): Promise<readonly string[]>;
}

/** The hour-by-hour service stores, wired beside the depot repositories. */
export interface ServiceRepositories {
  readonly hourly: HourlyObservationRepository;
  readonly scheduled: ScheduledTripRepository;
}

export interface DepotRepositories {
  readonly fleet: FleetRepository;
  readonly history: HistoryRepository;
  readonly crew: CrewRepository;
  readonly fuel: FuelRepository;
  readonly revenue: RevenueRepository;
}

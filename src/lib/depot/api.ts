import type { UpstreamSource } from '@/models/canonical';
import type { DepotVehicleStatus } from '@/models/depotLive';
import type {
  BusOpState,
  DepotSummary,
  FieldCoverage,
  Figure,
  LatLng,
  NetworkKpis,
  Provenance,
} from './types';
import type { BusLocation, OutshedSummary, Yard } from './infer/types';
import type { DepotScore, ScoreWindow } from './score/types';
import type {
  BusException,
  DepotException,
  ExceptionBasis,
  ExceptionKind,
  ExceptionReport,
  ExceptionSeverity,
} from './exceptions/types';
import type { BusExceptionPage } from './exceptions/busPage';
import type { DepotBalance, RebalanceParams, TransferPlan } from './optimise/types';
import type { RequirementParams, SeriesAnchor, SeriesPoint } from './sim/types';

/**
 * Payloads of the depot APIs under `/api/upsrtc/depot/*`.
 *
 * Every response carries the same envelope as the existing live route: where
 * the data came from, whether it is stale, when the server built it, and the
 * feed's own "now" (the reference for every age shown).
 */
export interface DepotFeedEnvelope {
  readonly feedNow: string | null;
  readonly fetchedAt: string;
  readonly source: UpstreamSource;
  readonly stale: boolean;
  /**
   * Sent only when above zero: rows whose receive time was later than the server's own
   * clock allows, ignored when the feed clock was read. The feed clock may then lag.
   */
  readonly feedClockAheadRows?: number;
}

/** GET /api/upsrtc/depot/network */
export interface DepotNetworkResponse extends DepotFeedEnvelope {
  readonly depots: readonly DepotSummary[];
  readonly kpis: NetworkKpis;
  readonly coverage: readonly FieldCoverage[];
  readonly scores: readonly DepotScore[];
  readonly exceptionCounts: Readonly<Record<ExceptionKind, number>>;
  /** Depot and bus exceptions together, counted before the bus cap. */
  readonly exceptionSeverityCounts: Readonly<Record<ExceptionSeverity, number>>;
  readonly recordCount: number;
  /**
   * The rolling window the scores and the peer-comparison depot exceptions were
   * summed over (the widest any depot has). Always sent; optional for older fixtures.
   */
  readonly scoreWindow?: ScoreWindow;
  /** Which exception kinds are over the window and which as of the feed time. Always sent. */
  readonly exceptionBasis?: Readonly<Record<ExceptionKind, ExceptionBasis>>;
  /**
   * Per depot id: the feed times this server process has decided the depot's
   * yard on, since it started (or its yard memory last restarted). A yard is
   * held only from the second; at 0 or 1 a missing yard may be a fresh start
   * rather than evidence. 0 for the recorded fixture. Always sent.
   */
  readonly yardSnapshotsSeen?: Readonly<Record<string, number>>;
}

/** GET /api/upsrtc/depot/exceptions */
export interface DepotExceptionsResponse extends DepotFeedEnvelope {
  /** Depot exceptions, counts by kind and the bus total; bus rows come paged below. */
  readonly report: Omit<ExceptionReport, 'bus'>;
  /** Every bus exception on the snapshot by severity, before any filter. */
  readonly busSeverityCounts: Readonly<Record<ExceptionSeverity, number>>;
  /** One page of bus exceptions for the query's kind and depot, with the true total. */
  readonly busPage: BusExceptionPage;
  /** The rolling window the peer-comparison depot exceptions were computed over. */
  readonly scoreWindow?: ScoreWindow;
  /** Which exception kinds are over the window and which as of the feed time. Always sent. */
  readonly exceptionBasis?: Readonly<Record<ExceptionKind, ExceptionBasis>>;
}

/** One bus as a depot manager sees it. Only ever sent for a single depot. */
export interface DepotBusView {
  readonly registrationNumber: string;
  readonly state: BusOpState;
  readonly location: BusLocation;
  readonly otherDepotId: string | null;
  readonly distanceFromYardKm: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly speedKmph: number | null;
  readonly gpsAgeMin: number | null;
  readonly vehicleStatus: DepotVehicleStatus;
  readonly tripStatus: string | null;
  readonly routeName: string | null;
  readonly routeDescription: string | null;
  readonly journeyId: string | null;
  readonly journeyCode: string | null;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  /** YYYY-MM-DD of the bus's current assignment, for the schedule lookup. */
  readonly tripDate: string | null;
  /** Present only when the schedule is for the feed date and the value is plausible. */
  readonly delayMinutes: number | null;
  readonly mainPowerOn: boolean | null;
  readonly tamperCode: string | null;
  /**
   * Whole minutes since the bus last reported, when that is longer than the
   * reporting window and the bus is neither dark nor off road: its state is
   * then what it last reported, not what it is doing now. Null when heard recently.
   */
  readonly notHeardMin?: number | null;
}

/** A bus from another depot standing inside this depot's yard. */
export interface VisitorBus {
  readonly registrationNumber: string;
  readonly homeDepotId: string | null;
  readonly homeDepotName: string | null;
  readonly state: BusOpState;
  /** Where the bus stands; null when its position is missing or unusable. */
  readonly position: LatLng | null;
}

/** GET /api/upsrtc/depot/[depotId] */
export interface DepotDetailResponse extends DepotFeedEnvelope {
  readonly depot: DepotSummary;
  readonly score: DepotScore | null;
  readonly yard: Figure<Yard | null>;
  readonly buses: readonly DepotBusView[];
  readonly locationMix: Readonly<Record<BusLocation, number>>;
  readonly outshed: OutshedSummary;
  readonly exceptions: {
    readonly depot: readonly DepotException[];
    readonly bus: readonly BusException[];
  };
  readonly visitors: readonly VisitorBus[];
  /** The rolling window this depot's score and peer-comparison exceptions were summed over. */
  readonly scoreWindow?: ScoreWindow;
}

/** GET /api/upsrtc/depot/distribution */
export interface DepotDistributionResponse extends DepotFeedEnvelope {
  readonly balances: readonly DepotBalance[];
  readonly plan: TransferPlan;
  readonly requirementParams: RequirementParams;
  readonly rebalanceParams: RebalanceParams;
  /** YYYY-MM-DD the modelled world was seeded with. */
  readonly operatingDate: string;
}

/** GET /api/upsrtc/depot/history */
export interface DepotHistoryResponse {
  readonly series: readonly SeriesPoint[];
  readonly provenance: Provenance;
  readonly anchor: SeriesAnchor;
}

/** Body of every depot API error response. Never carries an upstream message. */
export interface DepotApiError {
  readonly error: string;
}

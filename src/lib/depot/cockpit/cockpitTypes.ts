import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';
import type { BusLocation, OutshedState } from '@/lib/depot/infer/types';
import type { BusOpState, Coverage } from '@/lib/depot/types';

/** Shapes the cockpit's pure modules return; the components render nothing else. */

export interface StateCell {
  readonly state: BusOpState;
  readonly label: string;
  readonly count: number;
  /** Share of the fleet, 0 to 1; null for a depot with no buses. */
  readonly share: number | null;
}

export interface LocationCell {
  readonly location: BusLocation;
  readonly label: string;
  readonly count: number;
}

export type YardStatus =
  | { readonly established: true; readonly sample: Coverage; readonly sentence: string }
  | { readonly established: false; readonly sentence: string };

export interface StatusBoard {
  readonly fleet: number;
  readonly states: readonly StateCell[];
  readonly standing: number;
  /** Standing buses by location; null when there is no yard to place them against. */
  readonly locations: readonly LocationCell[] | null;
  readonly yard: YardStatus;
}

export interface TrackerRow {
  readonly key: string;
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly journeyCode: string | null;
  readonly scheduledStart: string;
  readonly state: OutshedState;
  readonly label: string;
  readonly minutes: number | null;
  readonly minutesText: string;
}

export interface CockpitHeader {
  readonly name: string;
  readonly kindLabel: string;
  readonly fleet: number;
  readonly ranked: boolean;
  readonly index: number | null;
  readonly rank: number | null;
  readonly peerCount: number | null;
  readonly peerGroupLabel: string | null;
  readonly unrankedReason: string | null;
}

export interface ExceptionLine {
  readonly id: string;
  readonly severity: ExceptionSeverity;
  readonly severityLabel: string;
  /** "Depot", or the bus registration. */
  readonly subject: string;
  readonly registrationNumber: string | null;
  readonly sentence: string;
}

export interface VisitorRow {
  readonly registrationNumber: string;
  /** The visitor's own depot, whose roster lists it; null when the feed gives none. */
  readonly homeDepotId: string | null;
  readonly homeDepotLabel: string;
  readonly stateLabel: string;
}

export interface CockpitModel {
  readonly header: CockpitHeader;
  readonly board: StatusBoard;
  readonly tracker: readonly TrackerRow[];
  readonly coverageSentence: string;
  readonly hasSchedules: boolean;
  readonly exceptions: readonly ExceptionLine[];
  readonly visitors: readonly VisitorRow[];
}

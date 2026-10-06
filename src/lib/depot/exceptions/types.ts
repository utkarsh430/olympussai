/**
 * Exception types: depots and buses that need attention on this snapshot.
 * Exceptions name depots and vehicles. They never name or score a person.
 */

export type ExceptionSeverity = 'critical' | 'warning' | 'info';

export type DepotExceptionKind =
  | 'dark_share_high'
  | 'off_road_high'
  | 'on_road_low'
  | 'power_cut_cluster';

export type BusExceptionKind = 'long_dark' | 'power_cut' | 'tamper_code' | 'emergency';

export type ExceptionKind = DepotExceptionKind | BusExceptionKind;

export interface DepotException {
  /** Stable: `<kind>:<depotId>`. */
  readonly id: string;
  readonly depotId: string;
  readonly depotName: string;
  readonly kind: DepotExceptionKind;
  readonly severity: ExceptionSeverity;
  /** The depot's rate, 0 to 1 (or a count for `power_cut_cluster`). */
  readonly value: number;
  readonly peerMedian: number | null;
  readonly z: number | null;
  readonly affected: number;
  readonly fleet: number;
}

export interface BusException {
  /** Stable: `<kind>:<registration>`. */
  readonly id: string;
  readonly registrationNumber: string;
  readonly depotId: string | null;
  readonly depotName: string | null;
  readonly kind: BusExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly lastSeen: string | null;
  /** Extra fact for the row, e.g. the raw tamper code. */
  readonly detail: string | null;
}

export interface ExceptionReport {
  readonly depot: readonly DepotException[];
  /** Capped list; `busTotal` is the count before the cap. */
  readonly bus: readonly BusException[];
  readonly busTotal: number;
  readonly counts: Readonly<Record<ExceptionKind, number>>;
}

/**
 * Types for the modelled world: the data the live feed does not carry.
 *
 * Everything here is generated deterministically from (depot id, operating
 * date, live anchors) and is shown as MODELLED. It never overwrites a live
 * figure, and each real feed replaces its modelled counterpart when supplied.
 */

export interface ModelledDepotMaster {
  readonly depotId: string;
  /** Never below the depot's live fleet. */
  readonly parkingCapacity: number;
  readonly workshopBays: number;
  readonly fuelPoints: number;
}

export type ServiceClass = 'ordinary' | 'express' | 'ac' | 'premium';

export interface ModelledBus {
  readonly registrationNumber: string;
  readonly serviceClass: ServiceClass;
  readonly ageYears: number;
  readonly seats: number;
}

export interface RequirementParams {
  /** Spare buses held as a share of peak requirement. */
  readonly spareRatio: number;
  /** Share of available buses a typical depot needs at peak. */
  readonly baseUtilisation: number;
  /** How strongly a depot's on-road share over the score window moves its requirement. */
  readonly utilisationSensitivity: number;
  /** Half-width of the seeded per-depot variation. */
  readonly noise: number;
}

export type MetricKey = 'onRoadShare' | 'offRoadRate' | 'darkRate' | 'index' | 'available';

export type HistoryScope =
  | { readonly kind: 'network' }
  | { readonly kind: 'depot'; readonly depotId: string };

export interface SeriesPoint {
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly value: number;
}

/** The live value a modelled series must end on. */
export interface SeriesAnchor {
  readonly date: string;
  readonly value: number;
}

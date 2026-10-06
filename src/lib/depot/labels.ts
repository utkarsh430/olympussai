import type { BusOpState, DepotKind, Provenance } from './types';
import type { BusLocation } from './infer/types';

/**
 * On-screen wording for depot enums, in one place.
 *
 * `modelled` renders as MODELLED: the interface never uses the word
 * "simulated" (the e2e suite fails the build if it appears).
 */
export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  live: 'LIVE',
  derived: 'DERIVED',
  modelled: 'MODELLED',
  reference: 'REFERENCE',
};

export const DEPOT_KIND_LABEL: Readonly<Record<DepotKind, string>> = {
  depot: 'Depot',
  hired: 'Hired fleet',
  electric: 'Electric fleet',
  enforcement: 'Enforcement',
  unassigned: 'Unassigned',
};

export const BUS_STATE_LABEL: Readonly<Record<BusOpState, string>> = {
  in_service: 'In service',
  on_road: 'On road, no schedule in feed',
  standing: 'Standing',
  dark: 'Dark',
  off_road: 'Off road',
};

export const BUS_LOCATION_LABEL: Readonly<Record<BusLocation, string>> = {
  in_yard: 'In yard',
  at_other_yard: 'At another depot',
  away: 'Away',
  unknown: 'Location unknown',
};

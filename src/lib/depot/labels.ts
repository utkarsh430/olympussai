import type { BusOpState, DepotKind, Provenance } from './types';
import type { BusLocation } from './infer/types';
import type { ExceptionKind, ExceptionSeverity } from './exceptions/types';
import type { PeerGroupId, RankReason } from './score/types';
import { MIN_FLEET_FOR_RANK } from './score/config';

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

/** Short names for the exception kinds: counts strips, filters and the overview. */
export const EXCEPTION_KIND_LABEL: Readonly<Record<ExceptionKind, string>> = {
  dark_share_high: 'High dark rate',
  off_road_high: 'High off-road rate',
  on_road_low: 'Low on-road share',
  power_cut_cluster: 'Power-off cluster',
  long_dark: 'Long dark',
  power_cut: 'Power off',
  tamper_code: 'Tamper code',
  emergency: 'Emergency flag',
};

/** Severity is always shown as a word; colour only reinforces it. */
export const SEVERITY_LABEL: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

export const PEER_GROUP_LABEL: Readonly<Record<PeerGroupId, string>> = {
  small: 'Small fleets',
  medium: 'Medium fleets',
  large: 'Large fleets',
  all: 'All depots',
};

/** Why a depot carries no index, in a few words. */
export const RANK_REASON_LABEL: Readonly<Record<RankReason, string>> = {
  ok: 'Ranked',
  not_a_depot: 'Not an operating depot',
  fleet_too_small: `Fewer than ${MIN_FLEET_FOR_RANK} buses`,
};

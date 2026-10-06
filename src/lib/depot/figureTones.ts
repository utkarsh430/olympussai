import { BUS_KIND_SEVERITY } from '@/lib/depot/exceptions/config';
import type { DepotExceptionKind, ExceptionKind } from '@/lib/depot/exceptions/types';
import type { DepotMeaning } from '@/lib/depot/palette';
import type { BusOpState, NetworkKpis } from '@/lib/depot/types';

/**
 * What each page's figures measure, read against the palette's one table of colour
 * meanings (`DEPOT_MEANING_TONE`), so a figure is coloured by what it counts and the same
 * thing has the same colour on every page. A figure not listed is a plain count (cyan).
 */

/** A bus state's meaning: the same five colours as the yard map and the state squares. */
export const BUS_STATE_MEANING: Readonly<Record<BusOpState, DepotMeaning>> = {
  in_service: 'inService',
  on_road: 'onRoad',
  standing: 'standing',
  dark: 'dark',
  off_road: 'offRoad',
};

/** The network overview's fleet band: the state each count is of. */
export const KPI_MEANING: Readonly<Partial<Record<keyof NetworkKpis, DepotMeaning>>> = {
  onRoad: 'onRoad',
  stationary: 'standing',
  noSignal: 'dark',
  underMaintenance: 'offRoad',
};

/**
 * A depot exception kind takes the state it measures (a high dark rate is about dark
 * buses), the power-off cluster its warning; a bus kind takes its one fixed severity.
 */
const DEPOT_KIND_MEANING: Readonly<Record<DepotExceptionKind, DepotMeaning>> = {
  dark_share_high: 'dark',
  off_road_high: 'offRoad',
  on_road_low: 'onRoad',
  power_cut_cluster: 'warning',
};

export function exceptionKindMeaning(kind: ExceptionKind): DepotMeaning {
  if (kind in DEPOT_KIND_MEANING) return DEPOT_KIND_MEANING[kind as DepotExceptionKind];
  return BUS_KIND_SEVERITY[kind as keyof typeof BUS_KIND_SEVERITY];
}

/**
 * The fleet distribution plan's figures: the empty running is modelled distance (teal),
 * the deficit met is the plan's outcome, where more is better (green).
 */
export const PLAN_FIGURE_MEANING: Readonly<Record<string, DepotMeaning>> = {
  empty: 'modelled',
  covered: 'better',
};

/**
 * A depot page's figures by key: fuel, its cost and economy, and fare revenue are modelled
 * money and energy (teal); a bus off the road is crimson, an overdue service a warning,
 * one due soon information. The cockpit's attention counts use the same keys, with the
 * bus exception severities (an emergency flag critical, power off and tamper information).
 */
export const DEPOT_FIGURE_MEANING: Readonly<Record<string, DepotMeaning>> = {
  fuel: 'modelled',
  cost: 'modelled',
  kmpl: 'modelled',
  revenue: 'modelled',
  earningsPerKm: 'modelled',
  off_road: 'offRoad',
  overdue: 'warning',
  due_soon: 'info',
  emergency: 'critical',
  power_off: 'info',
  dark: 'dark',
  not_heard: 'warning',
  tamper: 'info',
};

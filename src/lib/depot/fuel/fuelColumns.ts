import type { TableTier } from '../shell/tableTier';
import type { FuelFlaggedBus } from './api';
import { groupLabel } from './fuelPageModel';
import { BASIS_LABEL, routeDash } from './fuelStandOut';

/*
 * Column sets per width for the fuel page's tables. No
 * column is cut at 1440, 1280 or 1024; below 1024 a deliberate smaller set, the rest in
 * the row's `title`. Widths in px; their sums are pinned against each tier's frame.
 */

export type StandOutKey =
  'registration' | 'class' | 'route' | 'bus' | 'median' | 'variance' | 'basis';

export const STAND_OUT_WIDTHS: Readonly<Record<StandOutKey, number>> = {
  registration: 170,
  class: 110,
  route: 180,
  bus: 110,
  median: 180,
  variance: 100,
  basis: 130,
};

/**
 * Wide: every column. Medium (1024): CLASS and BASIS become a muted second line under the
 * registration. Narrow (800): registration, the bus, its peers and the variance.
 */
export function standOutColumnKeys(tier: TableTier, withRoute: boolean): readonly StandOutKey[] {
  if (tier === 'narrow') return ['registration', 'bus', 'median', 'variance'];
  const route: readonly StandOutKey[] = withRoute ? ['route'] : [];
  if (tier === 'medium') return ['registration', ...route, 'bus', 'median', 'variance'];
  return ['registration', 'class', ...route, 'bus', 'median', 'variance', 'basis'];
}

/** The muted second line under the registration at 1024: "Premium · class in depot". */
export function standOutSecondLine(bus: FuelFlaggedBus): string {
  return `${groupLabel(bus.serviceClass)} · ${BASIS_LABEL[bus.comparison]}`;
}

/** What the registration's `title` carries when columns are folded away. */
export function standOutRowTitle(bus: FuelFlaggedBus, tier: TableTier): string {
  if (tier === 'wide') return bus.registrationNumber;
  const route = tier === 'narrow' ? ` · route ${routeDash(bus.routeName)}` : '';
  return `${bus.registrationNumber} · ${standOutSecondLine(bus)}${route}`;
}

export type RouteKey = 'route' | 'buses' | 'distance' | 'cost' | 'kmpl' | 'cpk';

export const ROUTE_WIDTHS: Readonly<Record<RouteKey, number>> = {
  route: 220,
  buses: 90,
  distance: 130,
  cost: 140,
  kmpl: 130,
  cpk: 140,
};

/** Narrow drops FUEL COST ₹: distance times ₹/km gives it. */
export function routeColumnKeys(tier: TableTier): readonly RouteKey[] {
  return tier === 'narrow'
    ? ['route', 'buses', 'distance', 'kmpl', 'cpk']
    : ['route', 'buses', 'distance', 'cost', 'kmpl', 'cpk'];
}

/** The two rate headers, short at 800. */
export function routeRateHeaders(tier: TableTier): {
  readonly kmpl: { readonly header: string; readonly unit?: string };
  readonly cpk: { readonly header: string; readonly unit?: string };
} {
  return tier === 'narrow'
    ? { kmpl: { header: 'Km/L' }, cpk: { header: '₹/km' } }
    : { kmpl: { header: 'Km per litre' }, cpk: { header: 'Fuel cost', unit: '₹/km' } };
}

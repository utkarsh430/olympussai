import type { CrewRole } from '../crew/types';
import { compareText } from '../stats/order';
import {
  DEFAULT_MAX_BLOCK_MIN,
  DEFAULT_TARGET_LOAD,
  DEFAULT_TURNAROUND_MIN,
  MAX_OUT_OF_SERVICE,
  MAX_TURNAROUND_MIN,
  MIN_BLOCK_CAP_MIN,
  PIECE_GRID_MIN,
  SURGE_BOUNDS,
  TARGET_LOAD_BOUNDS,
} from './config';
import type { BusLock, ResolvedScheduleParams, RouteSurge, ScheduleParams } from './types';

export interface ParamContext {
  readonly routes: readonly string[];
  readonly buses: readonly string[];
  readonly available: Readonly<Record<CrewRole, number>>;
}

function clampWithNote(
  label: string,
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
  notes: string[],
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    notes.push(`${label} ${String(value)} is not a number; using ${fallback}`);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped !== value) notes.push(`${label} ${value} was outside ${min} to ${max}; using ${clamped}`);
  return clamped;
}

const toGrid = (minutes: number): number => Math.round(minutes / PIECE_GRID_MIN) * PIECE_GRID_MIN;

function cleanSurges(raw: readonly RouteSurge[] | undefined, routes: ReadonlySet<string>, notes: string[]): RouteSurge[] {
  const byRoute = new Map<string, number>();
  for (const surge of raw ?? []) {
    if (!routes.has(surge.routeName)) {
      notes.push(`Demand change for ${surge.routeName} ignored: not a route of this depot`);
      continue;
    }
    byRoute.set(surge.routeName, (byRoute.get(surge.routeName) ?? 0) + surge.percent);
  }
  return [...byRoute]
    .map(([routeName, percent]) => ({
      routeName,
      percent: clampWithNote(`Demand change for ${routeName}`, percent, SURGE_BOUNDS.min, SURGE_BOUNDS.max, 0, notes),
    }))
    .sort((a, b) => compareText(a.routeName, b.routeName));
}

function cleanOutOfService(raw: readonly string[] | undefined, buses: ReadonlySet<string>, notes: string[]): string[] {
  const kept = new Set<string>();
  for (const reg of raw ?? []) {
    const key = reg.trim();
    if (!buses.has(key)) notes.push(`Bus ${key} ignored: not in this depot`);
    else if (kept.size >= MAX_OUT_OF_SERVICE) notes.push(`Bus ${key} ignored: at most ${MAX_OUT_OF_SERVICE} buses out of service`);
    else kept.add(key);
  }
  return [...kept].sort(compareText);
}

function cleanLocks(raw: readonly BusLock[] | undefined, routes: ReadonlySet<string>, buses: ReadonlySet<string>, notes: string[]): BusLock[] {
  const byBus = new Map<string, string>();
  for (const lock of raw ?? []) {
    const reg = lock.registrationNumber.trim();
    if (!buses.has(reg)) notes.push(`Lock of ${reg} ignored: not in this depot`);
    else if (!routes.has(lock.routeName)) notes.push(`Lock of ${reg} to ${lock.routeName} ignored: not a route of this depot`);
    else {
      if (byBus.has(reg)) notes.push(`Lock of ${reg} to ${byBus.get(reg)} replaced by ${lock.routeName}`);
      byBus.set(reg, lock.routeName);
    }
  }
  return [...byBus].map(([registrationNumber, routeName]) => ({ registrationNumber, routeName })).sort((a, b) => compareText(a.registrationNumber, b.registrationNumber));
}

/** Clamps every what-if into its range and says what was clamped. Never throws. */
export function clampScheduleParams(
  raw: ScheduleParams,
  context: ParamContext,
): { readonly params: ResolvedScheduleParams; readonly notes: readonly string[] } {
  const notes: string[] = [];
  const routes = new Set(context.routes);
  const buses = new Set(context.buses);
  const unavailable = (role: CrewRole): number =>
    Math.round(clampWithNote(`${role === 'driver' ? 'Drivers' : 'Conductors'} unavailable`, raw.crewUnavailable?.[role], 0, context.available[role], 0, notes));
  const params: ResolvedScheduleParams = {
    demandSurgePercent: clampWithNote('Demand change', raw.demandSurgePercent, SURGE_BOUNDS.min, SURGE_BOUNDS.max, 0, notes),
    routeSurges: cleanSurges(raw.routeSurges, routes, notes),
    targetLoad: clampWithNote('Target load', raw.targetLoad, TARGET_LOAD_BOUNDS.min, TARGET_LOAD_BOUNDS.max, DEFAULT_TARGET_LOAD, notes),
    busesOutOfService: cleanOutOfService(raw.busesOutOfService, buses, notes),
    crewUnavailable: { driver: unavailable('driver'), conductor: unavailable('conductor') },
    maxBlockMinutes: toGrid(clampWithNote('Longest block', raw.maxBlockMinutes, MIN_BLOCK_CAP_MIN, DEFAULT_MAX_BLOCK_MIN, DEFAULT_MAX_BLOCK_MIN, notes)),
    minTurnaroundMinutes: toGrid(clampWithNote('Turnaround', raw.minTurnaroundMinutes, 0, MAX_TURNAROUND_MIN, DEFAULT_TURNAROUND_MIN, notes)),
    locks: cleanLocks(raw.locks, routes, buses, notes),
    holdForMaintenance: raw.holdForMaintenance ?? true,
  };
  return { params, notes };
}

/** A canonical key for the clamped parameters, so equal what-ifs share one plan. */
export function paramsKey(params: ResolvedScheduleParams): string {
  return JSON.stringify([
    params.demandSurgePercent,
    params.routeSurges.map((s) => [s.routeName, s.percent]),
    params.targetLoad,
    params.busesOutOfService,
    [params.crewUnavailable.driver, params.crewUnavailable.conductor],
    params.maxBlockMinutes,
    params.minTurnaroundMinutes,
    params.locks.map((l) => [l.registrationNumber, l.routeName]),
    params.holdForMaintenance,
  ]);
}

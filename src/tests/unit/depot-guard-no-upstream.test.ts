// @vitest-environment node
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { parseBusPageQuery } from '@/lib/depot/exceptions/busPage';
import { parseForecastQuery } from '@/lib/depot/live/forecastView';
import { parseHistoryQuery } from '@/lib/depot/live/historyView';
import { parseTrendsQuery } from '@/lib/depot/live/trendsView';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import { parseAllocationQuery, parseRoutesQuery } from '@/lib/depot/routes/routeQuery';
import { getRouteProfile } from '@/lib/depot/routes/routeCatalogue';
import { fetchUpstream } from '@/lib/upsrtc/client';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { filesUnder, parseFile, ROOT } from './depot-guard-source';
import { guardRouteHourlyQuery, guardServiceRepositories, guardView } from './depot-guard-fixtures';
import ts from 'typescript';

/*
 * A view is built from the snapshot it is handed and nothing else: building
 * one never reaches the corporation's servers (no fetch, no upstream client,
 * no route lookup, no fresh live snapshot). Every exported `build*` function
 * in src/lib/depot/live is found by parsing the folder and called with an
 * argument chosen by its declared parameter type, with every upstream path
 * stubbed to throw. A builder added later is called without editing this file;
 * one whose parameter type is not known below fails and names that type.
 * (The route handlers are held to the same rule in the API route table guard.)
 */

const { throwing } = vi.hoisted(() => ({
  throwing: (name: string) =>
    vi.fn(() => {
      throw new Error(`a view called ${name}`);
    }),
}));

vi.mock('@/lib/upsrtc/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/client')>()),
  fetchUpstream: throwing('fetchUpstream'),
}));
vi.mock('@/lib/upsrtc/scheduleService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/scheduleService')>()),
  fetchBusSchedule: throwing('fetchBusSchedule'),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/liveSnapshot')>()),
  getLiveSnapshot: throwing('getLiveSnapshot'),
}));
vi.mock('@/lib/depot/routes/routeCatalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/depot/routes/routeCatalogue')>()),
  getRouteProfile: throwing('getRouteProfile'),
}));

const LIVE_DIR = 'src/lib/depot/live';
const SOURCES = { revenue: modelledRevenueRepository, fuel: modelledFuelRepository };

function parsed<T>(result: { ok: true; query: T } | { ok: false }): T {
  if (!result.ok) throw new Error('the guard query no longer parses');
  return result.query;
}
const search = (query: string): URLSearchParams => new URLSearchParams(query);

/** An argument for each parameter type a view builder declares. */
const ARGUMENTS: Readonly<Record<string, () => unknown>> = {
  FleetSnapshotView: guardView,
  string: () => '1',
  CrewRepository: () => modelledCrewRepository,
  FuelRepository: () => modelledFuelRepository,
  RevenueSource: () => SOURCES,
  EconomicsSources: () => SOURCES,
  AllocationQuery: () => parsed(parseAllocationQuery(search(''))),
  RoutesQuery: () => parsed(parseRoutesQuery(search(''))),
  BusPageQuery: () => parsed(parseBusPageQuery(search(''))),
  TrendsQuery: () => parsed(parseTrendsQuery(search('metric=index'))),
  HistoryQuery: () => parsed(parseHistoryQuery(search('metric=index&scope=network'))),
  ForecastQuery: () => parsed(parseForecastQuery(search('metric=index&scope=network'))),
  RouteHourlyQuery: guardRouteHourlyQuery,
  ServiceRepositories: guardServiceRepositories,
};

interface Builder {
  readonly file: string;
  readonly name: string;
  /** Required parameters' declared types; optional ones are left to their defaults. */
  readonly types: readonly string[];
}

function buildersIn(file: string): Builder[] {
  const sf = parseFile(file);
  return sf.statements.flatMap((node) => {
    const exported = ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!ts.isFunctionDeclaration(node) || !exported || !node.name) return [];
    if (!node.name.text.startsWith('build')) return [];
    const types = node.parameters
      .filter((p) => !p.questionToken && !p.initializer)
      .map((p) => p.type?.getText(sf) ?? 'untyped');
    return [{ file, name: node.name.text, types }];
  });
}

const BUILDERS = filesUnder(LIVE_DIR, (n) => n.endsWith('.ts')).flatMap(buildersIn);

const fetchStub = throwing('fetch');

beforeEach(() => {
  resetAnalysisForTests();
  vi.stubGlobal('fetch', fetchStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('building a depot view makes no upstream call', () => {
  it('finds the view builders', () => {
    expect(BUILDERS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(BUILDERS.map((b) => [`${b.name} (${b.file.slice(LIVE_DIR.length + 1)})`, b] as const))(
    '%s',
    async (_name, b) => {
      const unknown = b.types.filter((t) => !(t in ARGUMENTS));
      expect(unknown, `no guard argument for these parameter types of ${b.name}`).toEqual([]);
      const mod = (await import(/* @vite-ignore */ join(ROOT, b.file))) as Record<string, unknown>;
      const build = mod[b.name] as (...args: unknown[]) => unknown;
      const args = b.types.map((t) => ARGUMENTS[t]?.());
      const result = await build(...args);
      expect(result).toBeTruthy();
      expect(fetchStub).not.toHaveBeenCalled();
      expect(fetchUpstream).not.toHaveBeenCalled();
      expect(fetchBusSchedule).not.toHaveBeenCalled();
      expect(getLiveSnapshot).not.toHaveBeenCalled();
      expect(getRouteProfile).not.toHaveBeenCalled();
    },
  );
});

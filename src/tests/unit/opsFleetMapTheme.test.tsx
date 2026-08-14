// @vitest-environment jsdom
//
// THE DEFECT: a light operations console over a black map.
//
// The Google basemap is a JavaScript style array handed to the Maps
// constructor, so no class, token or `prefers-color-scheme` rule reaches it.
// OpsFleetMap therefore takes the basemap as an OPT-IN prop, defaulting to
// dark, so one console moving does not move the others — see its own note.
//
// That contract only pays off if each surface actually opts in, and nothing
// about a prop that was never passed shows up in a render test of the map
// itself. What these tests hold is the wiring on each console's side: the
// console reads the resolved theme and hands it down through the panel, and it
// keeps doing so when the operator changes theme.
//
// The depot came first. The CONTROL ROOM is here because it shipped without
// the opt-in after two lanes had already flagged the problem — and it is the
// worst surface to get wrong, being the wall display, the largest map in the
// product. That every OTHER surface opts in too is asserted structurally over
// the source in mapBasemapThemeWiring.test.ts, because the failure mode is
// forgetting, and a behavioural test only ever covers the screens somebody
// remembered to write one for.
//
// The map's own restyle behaviour is the map lane's; this is each console
// proving its screen is connected to it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { DepotConsole } from '@/components/ops/depot/DepotConsole';
import { ControlRoomConsole } from '@/components/ops/control-room/console/ControlRoomConsole';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { THEME_STORAGE_KEY } from '@/lib/theme/theme';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';

/**
 * Stands in for the panel and records the basemap it was asked for. The real
 * panel forwards this prop straight to OpsFleetMap, and forwarding is asserted
 * separately by the map's own suite.
 */
vi.mock('@/components/ops/map/OpsFleetMapPanel', () => ({
  OpsFleetMapPanel: ({ basemapTheme }: { basemapTheme?: 'dark' | 'light' }) => (
    <div data-testid="fleet-map" data-basemap={basemapTheme ?? 'not-passed'} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ops/depot',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function stubPrefersDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: dark,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function consoleSnapshot(): DepotConsoleSnapshot {
  const corridors = [
    {
      routeDirectionId: 'rd-1',
      routeId: '1348',
      directionCode: 'OUT',
      isLoop: false,
      hasActivePolicy: true,
      depotVehicleCount: 3,
    },
  ];
  return {
    source: 'live',
    stale: false,
    error: null,
    fetchedAt: new Date().toISOString(),
    corridors,
    coverage: { running: 1, detecting: 1, observationOnly: 0, unknown: 0 },
    mappedCorridorCount: 759,
    selectedCorridor: corridors[0] ?? null,
    vehicles: [],
    headwayPairs: [],
    headwayRead: true,
    crossDepotPairCount: 0,
  };
}

function fleetSnapshot(): OpsFleetSnapshot {
  return {
    buses: [],
    source: 'live',
    stale: false,
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

function renderDepot() {
  return render(
    <ThemeProvider>
      <DepotConsole
        email="depot1@olympuss.us"
        depotLabel="Bareilly"
        fleet={fleetSnapshot()}
        console={consoleSnapshot()}
        mapVehicles={[]}
        incidents={[]}
        standby={[]}
        activeKillSwitches={[]}
        initialTab="running"
        rosterPanel={<div />}
        reportsPanel={<div />}
      />
    </ThemeProvider>,
  );
}

function basemap() {
  return screen.getByTestId('fleet-map').getAttribute('data-basemap');
}

describe('the depot map follows the depot console’s theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('asks for the LIGHT basemap when the operator is in light mode', () => {
    stubPrefersDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    renderDepot();

    // The whole point. Without this the depot renders a light console around a
    // black rectangle, which is what shipped before this lane.
    expect(basemap()).toBe('light');
  });

  it('asks for the DARK basemap on the night shift', () => {
    stubPrefersDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    renderDepot();

    expect(basemap()).toBe('dark');
  });

  it('follows the machine when the operator has expressed no preference', () => {
    stubPrefersDark(false);
    // No stored choice at all: "system", and this machine says light.
    renderDepot();

    expect(basemap()).toBe('light');
  });

  it('passes the prop at all, rather than leaving the map on its dark default', () => {
    // OpsFleetMap defaults `basemapTheme` to dark so that a console which has
    // not been moved yet is unchanged. That default is also exactly what a
    // forgotten wiring looks like, and it would look correct on every
    // night-shift screenshot — so this asserts the prop is genuinely being
    // handed down rather than merely happening to match.
    stubPrefersDark(true);
    renderDepot();

    expect(basemap()).not.toBe('not-passed');
  });
});

/**
 * Rendered inside `act` and awaited, so the console's mount-time poll has
 * settled before anything is asserted. Without that the refused fetch resolves
 * after the test body, which React reports as an unwrapped update.
 */
async function renderControlRoom(): Promise<void> {
  await act(async () => {
    render(
      <ThemeProvider>
        <ControlRoomConsole
          email="cr@olympuss.us"
          initialOverview={null}
          initialOverviewError={null}
          initialActiveKillSwitches={[]}
          initialTab="decisions"
          fleetPanel={<div />}
          reportsPanel={<div />}
        />
      </ThemeProvider>,
    );
  });
}

describe('the control room map follows the wall display’s theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The console polls on mount. Nothing here depends on what comes back —
    // the basemap prop is decided by the theme, not the feed — so the poll is
    // answered with a refusal rather than left to hit a real network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the LIGHT basemap when the operator is in light mode', async () => {
    stubPrefersDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    await renderControlRoom();

    // THE DEFECT. Without the opt-in this read 'dark': a light console
    // wrapped around a black rectangle, on the biggest screen in the room.
    expect(basemap()).toBe('light');
  });

  it('asks for the DARK basemap on the night shift', async () => {
    stubPrefersDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    await renderControlRoom();

    expect(basemap()).toBe('dark');
  });

  it('passes the prop at all, rather than leaving the map on its dark default', async () => {
    stubPrefersDark(true);
    await renderControlRoom();

    expect(basemap()).not.toBe('not-passed');
  });
});

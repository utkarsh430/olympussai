// @vitest-environment jsdom
//
// The depot console, driven the way a depot operator drives it.
//
// The pure rules behind it are asserted in depotCorridors.test.ts and the
// server-side narrowing in depotConsoleData.test.ts. What this file holds is
// the claims the SCREEN makes — specifically the ones that are wrong in a way
// an operator cannot detect:
//
//   • An empty bunching panel must say which kind of empty it is.
//   • The corridor picker must offer only corridors this depot runs, and mark
//     the ones that can never report before the click is spent.
//   • The console must not imply it can issue anything. A depot account's
//     every reachable endpoint is a GET.
//   • The schedule must not present one published time as two predictions.
//
// The map is mocked out: it is the one part of this screen with its own suite
// and the only part that needs a Google basemap, which no test process has.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { DepotConsole } from '@/components/ops/depot/DepotConsole';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import type { BunchingIncident } from '@/models/control';
import type { CanonicalLiveBus } from '@/models/canonical';

const replace = vi.fn();

vi.mock('@/components/ops/map/OpsFleetMapPanel', () => ({
  OpsFleetMapPanel: ({
    scopeLabel,
    routeDirectionId,
    vehicles,
  }: {
    scopeLabel: string;
    routeDirectionId?: string;
    vehicles: readonly unknown[] | null;
  }) => (
    <div data-testid="fleet-map">
      map:{scopeLabel}:{routeDirectionId ?? 'none'}:{vehicles === null ? 'unknown' : vehicles.length}
    </div>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ops/depot',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

function expectText(pattern: RegExp): void {
  expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
}

function corridor(overrides: Partial<DepotConsoleSnapshot['corridors'][number]> = {}) {
  return {
    routeDirectionId: 'rd-1',
    routeId: '1348',
    directionCode: 'OUT',
    isLoop: false,
    hasActivePolicy: true,
    depotVehicleCount: 3,
    ...overrides,
  };
}

function consoleSnapshot(overrides: Partial<DepotConsoleSnapshot> = {}): DepotConsoleSnapshot {
  const corridors = overrides.corridors ?? [corridor()];
  return {
    source: 'live',
    stale: false,
    error: null,
    fetchedAt: new Date().toISOString(),
    corridors,
    coverage: {
      running: corridors.length,
      detecting: corridors.filter((c) => c.hasActivePolicy === true).length,
      observationOnly: corridors.filter((c) => c.hasActivePolicy === false).length,
      unknown: corridors.filter((c) => c.hasActivePolicy === undefined).length,
    },
    mappedCorridorCount: 759,
    selectedCorridor: corridors[0] ?? null,
    vehicles: [],
    headwayPairs: [],
    headwayRead: true,
    crossDepotPairCount: 0,
    ...overrides,
  };
}

function fleetSnapshot(overrides: Partial<OpsFleetSnapshot> = {}): OpsFleetSnapshot {
  return {
    buses: [] as CanonicalLiveBus[],
    source: 'live',
    stale: false,
    fetchedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

function renderConsole(overrides: {
  console?: DepotConsoleSnapshot;
  fleet?: OpsFleetSnapshot;
  incidents?: BunchingIncident[];
  initialTab?: 'running' | 'bunching' | 'schedule' | 'standby' | 'roster' | 'reports';
} = {}) {
  return render(
    <DepotConsole
      email="depot1@olympuss.us"
      depotLabel="Bareilly"
      fleet={overrides.fleet ?? fleetSnapshot()}
      console={overrides.console ?? consoleSnapshot()}
      mapVehicles={[]}
      incidents={overrides.incidents ?? []}
      standby={[]}
      activeKillSwitches={[]}
      initialTab={overrides.initialTab ?? 'running'}
      rosterPanel={<div data-testid="roster-panel">roster</div>}
      reportsPanel={<div data-testid="reports-panel">reports</div>}
    />,
  );
}

beforeEach(() => {
  replace.mockReset();
});

describe('DepotConsole — the corridor picker', () => {
  it('offers only the corridors this depot is running, with its own bus count on each', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [
          corridor({ routeDirectionId: 'rd-1', routeId: '1348', depotVehicleCount: 4 }),
          corridor({ routeDirectionId: 'rd-2', routeId: '9000', depotVehicleCount: 1 }),
        ],
      }),
    });

    const picker = screen.getByLabelText(/corridor/i) as HTMLSelectElement;
    expect(picker.options).toHaveLength(2);
    expect(picker.options[0]!.textContent).toContain('1348 · OUT');
    expect(picker.options[0]!.textContent).toContain('4 buses');
    expect(picker.options[1]!.textContent).toContain('1 bus');
  });

  it('marks a corridor that can never report bunching BEFORE the click is spent', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [
          corridor({ routeDirectionId: 'rd-1', hasActivePolicy: true }),
          corridor({ routeDirectionId: 'rd-2', routeId: '9000', hasActivePolicy: false }),
        ],
      }),
    });

    const picker = screen.getByLabelText(/corridor/i) as HTMLSelectElement;
    expect(picker.options[0]!.textContent).not.toContain('no detection');
    expect(picker.options[1]!.textContent).toContain('no detection');
  });

  it('changes corridor through the server rather than filtering in the browser', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [corridor({ routeDirectionId: 'rd-1' }), corridor({ routeDirectionId: 'rd-2', routeId: '9000' })],
      }),
    });

    fireEvent.change(screen.getByLabelText(/corridor/i), { target: { value: 'rd-2' } });

    // The narrowing is server-side; a corridor change has to reach the server.
    expect(replace).toHaveBeenCalledWith('/ops/depot?routeDirectionId=rd-2', { scroll: false });
  });

  it('renders no picker at all when the depot is on no mapped corridor', () => {
    renderConsole({ console: consoleSnapshot({ corridors: [], selectedCorridor: null }) });
    expect(screen.queryByLabelText(/corridor/i)).not.toBeInTheDocument();
    expectText(/no mapped corridor in service/i);
  });
});

describe('DepotConsole — an empty bunching panel always says which empty it is', () => {
  it('says detection is OFF for an observation-only corridor, not that the corridor is clear', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: false })],
        headwayRead: false,
      }),
    });

    expectText(/no measured target headway/i);
    expectText(/not a failure to reach it/i);
    // The dangerous reading, explicitly absent.
    expect(screen.queryByText(/real all-clear/i)).not.toBeInTheDocument();
  });

  it('says a detecting corridor with no incident is a REAL all-clear', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({ corridors: [corridor({ hasActivePolicy: true })] }),
    });

    expectText(/real all-clear rather than an absence of detection/i);
  });

  it('says the reading is UNKNOWN, not clear, when the headway read failed', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({ corridors: [corridor({ hasActivePolicy: true })], headwayRead: false }),
    });

    expectText(/unknown —\s*\n?\s*not clear|unknown — not clear/i);
  });

  it('warns rather than informs when NONE of this depot’s corridors can detect', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: false }), corridor({ routeDirectionId: 'rd-2', hasActivePolicy: false })],
      }),
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((alert) => /observation-only/i.test(alert.textContent ?? ''))).toBe(true);
  });
});

describe('DepotConsole — what it does not claim to do', () => {
  it('states plainly that this console issues nothing, and offers no command control', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/this console observes; it does not issue/i);
    // Not a disabled button, not an enabled one that would 403 — no control.
    expect(screen.queryByRole('button', { name: /issue|hold|send/i })).not.toBeInTheDocument();
  });

  it('names the six instructions nothing generates, derived rather than hardcoded', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/instructions that exist but that nothing proposes/i);
    for (const label of ['Stop skip', 'Short turn', 'Deadhead', 'Boarding limit', 'Standby injection', 'Speed guidance']) {
      expectText(new RegExp(label, 'i'));
    }
    expectText(/changes no state beyond the record of having issued it/i);
  });

  it('says rerouting does not exist at all, and keeps the bay & crew gap visible', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/rerouting/i);
    expectText(/does not exist, in any form/i);
    expectText(/bay & crew conflicts|bay &amp; crew conflicts/i);
    expectText(/not available yet/i);
  });

  it('lists exactly the three hold types as what the engine can reason about', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/three hold types, and nothing else/i);
    expectText(/Terminal dispatch hold/i);
    expectText(/Two-way hold/i);
    expectText(/Self-equalizing hold/i);
  });
});

describe('DepotConsole — the schedule', () => {
  it('says arrival and departure are one published time, not two predictions', () => {
    renderConsole({ initialTab: 'schedule' });

    expectText(/one published time per stop/i);
    expectText(/they are the same value, not two separate predictions/i);
    expectText(/not an estimate of when the bus will actually get there/i);
  });
});

describe('DepotConsole — the shell', () => {
  it('mounts the map with this depot’s scope and its selected corridor', () => {
    renderConsole({ console: consoleSnapshot({ corridors: [corridor({ routeDirectionId: 'rd-7' })] }) });

    expect(screen.getByTestId('fleet-map')).toHaveTextContent('map:Bareilly:rd-7:0');
  });

  it('never says "all depots" anywhere on a depot surface', () => {
    renderConsole({ fleet: fleetSnapshot({ buses: [] }) });
    expect(screen.queryByText(/all depots/i)).not.toBeInTheDocument();
  });

  it('separates the depot’s whole fleet from the subset on a mapped corridor', () => {
    // The two are routinely far apart, and one presented as the other would
    // silently redefine "this depot's fleet" as the part the control service
    // happens to understand.
    const buses = Array.from({ length: 40 }, (_, index) => ({ id: `bus-${index}` }) as CanonicalLiveBus);
    renderConsole({
      fleet: fleetSnapshot({ buses }),
      console: consoleSnapshot({ corridors: [corridor({ depotVehicleCount: 6 })] }),
    });

    expectText(/on a mapped corridor/i);
    expectText(/34 on roads not yet surveyed/i);
  });

  it('keeps the roster and reports reachable, rendered by the server', () => {
    renderConsole({ initialTab: 'roster' });
    expect(screen.getByTestId('roster-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('depot-tab-reports'));
    expect(screen.getByTestId('reports-panel')).toBeInTheDocument();
  });

  it('badges the bunching tab with the number of open incidents on this depot', () => {
    renderConsole({
      incidents: [
        { id: 'i1', members: [], severity: 'bunched' } as unknown as BunchingIncident,
        { id: 'i2', members: [], severity: 'warning' } as unknown as BunchingIncident,
      ],
    });

    expect(within(screen.getByTestId('depot-tab-bunching')).getByText('2')).toBeInTheDocument();
  });
});

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
      map:{scopeLabel}:{routeDirectionId ?? 'none'}:
      {vehicles === null ? 'unknown' : vehicles.length}
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

function renderConsole(
  overrides: {
    console?: DepotConsoleSnapshot;
    fleet?: OpsFleetSnapshot;
    incidents?: BunchingIncident[];
    initialTab?: 'running' | 'bunching' | 'schedule' | 'standby' | 'roster' | 'reports';
  } = {},
) {
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

  it('marks a corridor that can never report buses closing up BEFORE the click is spent', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [
          corridor({ routeDirectionId: 'rd-1', hasActivePolicy: true }),
          corridor({ routeDirectionId: 'rd-2', routeId: '9000', hasActivePolicy: false }),
        ],
      }),
    });

    const picker = screen.getByLabelText(/corridor/i) as HTMLSelectElement;
    expect(picker.options[0]!.textContent).not.toContain('cannot report');
    expect(picker.options[1]!.textContent).toContain('cannot report buses closing up');
  });

  it('changes corridor through the server rather than filtering in the browser', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [
          corridor({ routeDirectionId: 'rd-1' }),
          corridor({ routeDirectionId: 'rd-2', routeId: '9000' }),
        ],
      }),
    });

    fireEvent.change(screen.getByLabelText(/corridor/i), { target: { value: 'rd-2' } });

    // The narrowing is server-side; a corridor change has to reach the server.
    expect(replace).toHaveBeenCalledWith('/ops/depot?routeDirectionId=rd-2', { scroll: false });
  });

  it('renders no picker at all when the depot is on no surveyed corridor', () => {
    renderConsole({ console: consoleSnapshot({ corridors: [], selectedCorridor: null }) });
    expect(screen.queryByLabelText(/corridor/i)).not.toBeInTheDocument();
    expectText(/no surveyed corridor in service/i);
  });
});

describe('DepotConsole — an empty bunching panel always says which empty it is', () => {
  it('says this corridor CANNOT BE CHECKED, rather than that it is clear', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: false })],
        headwayRead: false,
      }),
    });

    expectText(/no planned gap has been set for it/i);
    expectText(/not a failure to reach it/i);
    // The dangerous reading, explicitly absent.
    expect(screen.queryByText(/real all-clear/i)).not.toBeInTheDocument();
  });

  it('says a checkable corridor with nothing happening is a REAL all-clear', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({ corridors: [corridor({ hasActivePolicy: true })] }),
    });

    expectText(/real all-clear rather than a corridor that cannot be checked/i);
  });

  it('says the reading is UNKNOWN, not clear, when the gap read failed', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: true })],
        headwayRead: false,
      }),
    });

    expectText(/unknown —\s*\n?\s*not clear|unknown — not clear/i);
  });

  it('warns rather than informs when NONE of this depot’s corridors can be checked', () => {
    renderConsole({
      initialTab: 'bunching',
      console: consoleSnapshot({
        corridors: [
          corridor({ hasActivePolicy: false }),
          corridor({ routeDirectionId: 'rd-2', hasActivePolicy: false }),
        ],
      }),
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((alert) => /watch-only/i.test(alert.textContent ?? ''))).toBe(true);
  });
});

describe('DepotConsole — the pairs tile tells the two silences apart', () => {
  /**
   * THE DEFECT: one glyph doing two jobs, in the one place the whole
   * vocabulary exists to keep apart.
   *
   * The "pairs being watched" tile printed `—` for BOTH of these:
   *
   *   • this corridor has no planned gap, so there are no pairs to count —
   *     which is "nothing to report", and `—` is correct;
   *   • the gap reading was attempted and failed — which is "we could not
   *     see", and must be `n/a`.
   *
   * The second one wore the first one's glyph. During an outage an operator
   * read "nothing to report about pairs on this corridor" off a reading that
   * had never been taken, which is exactly the substitution `-` versus `n/a`
   * is in this product to prevent. Both branches also carried a `warn` tone,
   * colouring a reading nobody took as a measurement that was bad.
   */
  function pairsTile() {
    return screen.getByText('Pairs of buses being watched').parentElement!;
  }

  it('prints "-" when there is genuinely nothing to count', () => {
    renderConsole({
      console: consoleSnapshot({ corridors: [corridor({ hasActivePolicy: false })] }),
    });

    const tile = pairsTile();
    expect(tile.textContent).toContain('—');
    expect(tile.textContent).not.toContain('n/a');
    expect(tile.textContent).toMatch(/no planned gap set for this corridor/i);
    // A screen reader announces "-" as nothing at all, so the meaning is also
    // carried in words.
    expect(within(tile).getByText('nothing to report')).toBeInTheDocument();
  });

  it('prints "n/a" when the reading was attempted and could not be taken', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: true })],
        headwayRead: false,
      }),
    });

    const tile = pairsTile();
    expect(tile.textContent).toContain('n/a');
    expect(tile.textContent).not.toContain('—');
    expect(tile.textContent).toMatch(/could not be taken/i);
    expect(within(tile).getByText('unknown, could not be read')).toBeInTheDocument();
  });

  it('says the control service did not answer, rather than assuming no gap', () => {
    // hasActivePolicy undefined is "we did not hear", which is not "no". The
    // tile may not print the settled no-planned-gap sentence for it.
    renderConsole({
      console: consoleSnapshot({ corridors: [corridor({ hasActivePolicy: undefined })] }),
    });

    expect(pairsTile().textContent).toMatch(
      /does not say whether this corridor has a planned gap/i,
    );
  });

  it('counts the pairs when the reading really was taken', () => {
    renderConsole({
      console: consoleSnapshot({
        corridors: [corridor({ hasActivePolicy: true })],
        headwayRead: true,
      }),
    });

    const tile = pairsTile();
    expect(tile.textContent).toContain('0');
    // A measured zero is a fact an operator may act on, and must NOT be
    // dashed out. This is the other half of the same rule.
    expect(tile.textContent).not.toContain('n/a');
  });
});

describe('DepotConsole — what it does not claim to do', () => {
  it('states plainly that this console issues nothing, and offers no command control', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/this console watches; it does not send/i);
    // Not a disabled button, not an enabled one that would 403 — no control.
    expect(screen.queryByRole('button', { name: /issue|hold|send/i })).not.toBeInTheDocument();
  });

  it('names the instructions nothing generates, derived rather than hardcoded', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/instructions that exist, but that nothing suggests/i);
    for (const label of ['Stop skip', 'Short turn', 'Deadhead', 'Standby injection']) {
      expectText(new RegExp(label, 'i'));
    }
    expectText(/changes nothing except the record that it was sent/i);

    // "Drop off only" (boarding_limit) has MOVED between the two lists. The
    // engine learned to generate it - alighting-only, when the bus behind is
    // right there - so it left "nothing suggests these" and joined "what the
    // system can work out". No edit to this console made that happen: the
    // human-only list is derived by subtracting the engine's own vocabulary,
    // which is exactly the drift that design exists to survive.
    const nothingSuggests = screen
      .getByText(/instructions that exist, but that nothing suggests/i)
      .closest('section');
    expect(nothingSuggests).not.toBeNull();
    expect(within(nothingSuggests as HTMLElement).queryByText(/Drop off only/i)).toBeNull();

    const canWorkOut = screen
      .getByText(/what the system can actually work out for you/i)
      .closest('section');
    expect(within(canWorkOut as HTMLElement).getAllByText(/Drop off only/i).length).toBeGreaterThan(0);
  });

  // "Speed guidance" has moved too, and NOT into the engine list. This test
  // used to assert it sat under "nothing suggests" - which was false for as
  // long as pace guidance had been shipping, because the engine works out a
  // pace advisory on every solve and the control room renders it. But it does
  // not belong with the holds either: those are ranked, approved, sent and
  // shown on a driver's screen, and pace guidance is none of those. So it has
  // a section of its own that promises neither.
  it('puts speed guidance where it is true: worked out, with no way to reach a driver', () => {
    renderConsole({ initialTab: 'standby' });

    const nothingSuggests = screen
      .getByText(/instructions that exist, but that nothing suggests/i)
      .closest('section');
    expect(within(nothingSuggests as HTMLElement).queryByText(/Speed guidance/i)).toBeNull();

    const canWorkOut = screen
      .getByText(/what the system can actually work out for you/i)
      .closest('section');
    // Not here either: this section's copy promises delivery to a driver.
    expect(within(canWorkOut as HTMLElement).queryByText(/Speed guidance/i)).toBeNull();

    const advisory = screen
      .getByText(/worked out, but with no way to reach a driver/i)
      .closest('section');
    expect(advisory).not.toBeNull();
    expect(within(advisory as HTMLElement).getAllByText(/Speed guidance/i).length).toBeGreaterThan(
      0,
    );
    // The honest limit, said out loud rather than left for an operator to
    // discover: there is no in-cab display, so this travels by radio or not
    // at all.
    expectText(/no in-cab display/i);
  });

  it('says sending a bus another way does not exist, and keeps the bay & crew gap visible', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/sending a bus a different way/i);
    expectText(/does not exist, in any form/i);
    expectText(/bay and crew clashes/i);
    expectText(/not built yet/i);
    // The schema column name and the backlog reference are gone: an operator
    // could act on neither, and naming a database column on an admin screen
    // is the same defect as printing a shell command on one.
    expect(screen.queryByText(/crew_ref/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/follow-up work/i)).not.toBeInTheDocument();
  });

  it('lists exactly what the engine can reason about, holds and the one non-hold', () => {
    renderConsole({ initialTab: 'standby' });

    expectText(/the whole of what the recommendation engine can work out/i);
    expectText(/Terminal dispatch hold/i);
    expectText(/Two-way hold/i);
    expectText(/Self-equalizing hold/i);
    expectText(/Balanced hold/i);
    // The one that is not a hold, and the copy says so rather than letting a
    // reader assume every entry asks a bus to wait.
    expectText(/asks a bus to spend less time at a stop rather than more/i);
  });
});

describe('DepotConsole — the schedule', () => {
  it('says arrival and departure are one published time, not two predictions', () => {
    renderConsole({ initialTab: 'schedule' });

    expectText(/one published time per stop/i);
    expectText(/they are the same number, not two separate\s+predictions/i);
    expectText(/not an estimate of when the bus will actually get there/i);
  });
});

describe('DepotConsole — the shell', () => {
  it('mounts the map with this depot’s scope and its selected corridor', () => {
    renderConsole({
      console: consoleSnapshot({ corridors: [corridor({ routeDirectionId: 'rd-7' })] }),
    });

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
    const buses = Array.from(
      { length: 40 },
      (_, index) => ({ id: `bus-${index}` }) as CanonicalLiveBus,
    );
    renderConsole({
      fleet: fleetSnapshot({ buses }),
      console: consoleSnapshot({ corridors: [corridor({ depotVehicleCount: 6 })] }),
    });

    expectText(/on a surveyed corridor/i);
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

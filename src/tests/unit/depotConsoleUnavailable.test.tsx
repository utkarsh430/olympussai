// @vitest-environment jsdom
//
// The depot console on a COLD process whose first control-service read fails.
//
// ─── WHY THIS FILE EXISTS SEPARATELY FROM depotConsole.test.tsx ───────────
//
// That file hands the console hand-built snapshots. This one builds the
// snapshot the way the page does — the real `getDepotConsoleSnapshot`, with
// only the HTTP call mocked — and then renders the real console on it. The
// defect it exists to prevent lived exactly in the seam between those two:
// the data module returned `mappedCorridorCount: 0` and
// `coverage: {running: 0, ...}` when it had never successfully read anything,
// and the strip rendered those as ordinary measurements. An operator whose
// depot really had 62 of 195 buses on 34 corridors, 14 of them detecting, out
// of 759 mapped statewide, was shown:
//
//     On a mapped corridor  0 of 195   ·  195 on roads not yet surveyed
//     Corridors running     0
//     Can report bunching   0 of 0     ·  0 corridors mapped statewide
//
// Every one of those numbers was invented, and two of them actively
// misinform: "195 on roads not yet surveyed" is a claim about the route
// network, and "0 corridors mapped statewide" is a claim about the control
// database. Neither was measured, because nothing was read.
//
// ─── THE TWO CASES ARE NOT THE SAME CASE ─────────────────────────────────
//
// A failed refresh that still has a last-known-good is a different fact from a
// failed refresh with nothing behind it. The first has real readings that are
// merely old and must keep showing their real numbers with a stale badge; the
// second has no readings at all. Both are asserted here, because a fix that
// blanked the first would have removed working information from an operator's
// screen during an outage — the opposite mistake, and the more expensive one.
//
// The glyph distinction is this codebase's, from src/lib/ops/consoleReadings.ts:
// `—` means "nothing to report", `n/a` means "unknown". A failed read is `n/a`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { DepotConsole } from '@/components/ops/depot/DepotConsole';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import type { CanonicalLiveBus } from '@/models/canonical';

const fetchControlService = vi.fn();

vi.mock('@/lib/controlService/client', () => ({
  fetchControlService: (...args: unknown[]) => fetchControlService(...args),
  ControlServiceConfigError: class ControlServiceConfigError extends Error {},
}));

vi.mock('@/components/ops/map/OpsFleetMapPanel', () => ({
  OpsFleetMapPanel: () => <div data-testid="fleet-map" />,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ops/depot',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const BAREILLY = { kind: 'depot', depotCode: 'BAREILLY', depotName: 'Bareilly' } as const;
const clock = Date.UTC(2026, 7, 14);

/**
 * Re-imported per test: the data module holds its TTL caches at module scope
 * on purpose, and a shared instance would let one test's last-known-good
 * answer the next test's cold-start assertions.
 */
async function loadSnapshotReader() {
  vi.resetModules();
  return (await import('@/lib/controlService/depotConsoleData')).getDepotConsoleSnapshot;
}

/** The reported operator: 195 buses reporting on the live feed. */
const REPORTING_FLEET = Array.from({ length: 195 }, (_, i) => ({ id: `BAREILLY-${i}` }) as CanonicalLiveBus);

function fleetSnapshot(): OpsFleetSnapshot {
  return {
    buses: REPORTING_FLEET,
    // The live feed is a DIFFERENT upstream and is answering normally. That is
    // the whole shape of the reported defect: one source is up, the other was
    // never read, and the console has to keep them apart.
    source: 'live',
    stale: false,
    fetchedAt: new Date(clock).toISOString(),
    error: null,
  };
}

function renderConsole(snapshot: DepotConsoleSnapshot, initialTab: 'running' | 'bunching' = 'running') {
  return render(
    <DepotConsole
      email="depot1@olympuss.us"
      depotLabel="Bareilly"
      fleet={fleetSnapshot()}
      console={snapshot}
      mapVehicles={[]}
      incidents={[]}
      standby={[]}
      activeKillSwitches={[]}
      initialTab={initialTab}
      rosterPanel={<div />}
      reportsPanel={<div />}
    />,
  );
}

/** Everything the status strip and the panels put on screen, as one string. */
function screenText(): string {
  return document.body.textContent ?? '';
}

function routeDirection(id: string, hasActivePolicy: boolean) {
  return {
    routeDirectionId: id,
    routeId: id.toUpperCase(),
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 10_000,
    hasActivePolicy,
  };
}

function vehicleState(vehicleId: string, routeDirectionId: string) {
  return {
    vehicleId,
    tripId: null,
    routeDirectionId,
    position: null,
    distanceAlongRouteMeters: 0,
    speedKmph: null,
    headingDegrees: null,
    stopState: 'departed_stop',
    currentStopId: null,
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: null,
    observedAt: '2026-08-14T00:00:00.000Z',
  };
}

/** A control service answering normally, with 759 corridors mapped statewide. */
function healthyControlService() {
  const running = Array.from({ length: 34 }, (_, i) => routeDirection(`rd-${i}`, i < 14));
  const statewide = [
    ...running,
    ...Array.from({ length: 725 }, (_, i) => routeDirection(`other-${i}`, false)),
  ];
  // 62 of the depot's 195 buses placed on a mapped corridor.
  const states = Array.from({ length: 62 }, (_, i) => vehicleState(`BAREILLY-${i}`, `rd-${i % 34}`));

  fetchControlService.mockImplementation(async (path: string) => {
    if (path === '/v1/route-directions') return { routeDirections: statewide };
    if (path === '/v1/vehicle-states') return { vehicleStates: states };
    if (path.includes('/headway')) {
      return {
        routeDirectionId: 'rd-0',
        computedAt: '2026-08-14T00:00:00.000Z',
        pairs: [],
        aggregate: {
          routeDirectionId: 'rd-0',
          sampleCount: 0,
          meanHeadwaySeconds: null,
          stddevHeadwaySeconds: null,
          cv: null,
          ewtSeconds: null,
          targetHeadwaySeconds: 600,
        },
        incidents: [],
      };
    }
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  cleanup();
  fetchControlService.mockReset();
});

describe('the depot console when the control service was never read', () => {
  /**
   * The exact reported reproduction: a cold process whose very first depot
   * read fails, so there is no last-known-good anywhere.
   */
  async function coldFailedRead(): Promise<DepotConsoleSnapshot> {
    const getDepotConsoleSnapshot = await loadSnapshotReader();
    fetchControlService.mockRejectedValue(
      new Error('control service circuit open (27s remaining) after 3 consecutive failures'),
    );
    return getDepotConsoleSnapshot({ scope: BAREILLY, scopedFleet: REPORTING_FLEET, now: clock });
  }

  it('states no corridor count it never measured', async () => {
    renderConsole(await coldFailedRead());

    // "0 corridors mapped statewide" was a claim about the control database
    // made by a process that had not reached it. The real answer that shift
    // was 759. With the count unknown there is no honest denominator to
    // print, so the clause must not appear at all — asserted whole rather
    // than as "not zero", because any number here would be invented.
    expect(screenText()).not.toMatch(/corridors mapped statewide/);
  });

  it('does not claim the depot’s buses are on unsurveyed roads', async () => {
    renderConsole(await coldFailedRead());

    // The most misleading line of the four: it reports every reporting bus as
    // being on a road nobody has surveyed, which is a statement about the
    // route network. 62 of those 195 were on a mapped corridor.
    expect(screenText()).not.toMatch(/\b195 on roads not yet surveyed/);
    expect(screenText()).not.toMatch(/on roads not yet surveyed/);
  });

  it('prints n/a, not a zero, for every reading that was never taken', async () => {
    renderConsole(await coldFailedRead());

    for (const label of ['On a mapped corridor', 'Corridors running', 'Can report bunching', 'Observation-only']) {
      const tile = screen.getByText(label).parentElement;
      expect(tile, `no tile rendered for "${label}"`).not.toBeNull();
      // `n/a` = unknown. `—` would say "nothing to report", which is the
      // reading this console specifically may not invent.
      expect(tile!.textContent, `"${label}" did not print n/a`).toMatch(/n\/a/);
      expect(tile!.textContent, `"${label}" printed a fabricated number`).not.toMatch(/\d/);
    }
  });

  it('says the control service did not answer, in the words the other consoles use', async () => {
    renderConsole(await coldFailedRead());
    expect(screenText()).toMatch(/did not answer/i);
  });

  it('keeps the live feed’s own reading, which is a different upstream and answered', async () => {
    renderConsole(await coldFailedRead());

    // "Vehicles reporting 195" is measured, by a source that is up. An
    // outage on the control service must not blank it.
    const tile = screen.getByText('Vehicles reporting').parentElement;
    expect(tile!.textContent).toMatch(/195/);
  });

  it('does not tell the bunching panel that the route network has a gap here', async () => {
    renderConsole(await coldFailedRead(), 'bunching');

    // The `running === 0` branch of describeDepotDetectionCoverage says the
    // control service is "not placing any of Bareilly's vehicles on a mapped
    // corridor right now ... a gap in the mapped route network". True when
    // measured; a fabrication when nothing was read.
    expect(screenText()).not.toMatch(/gap in the mapped route network/i);
    expect(screenText()).toMatch(/did not answer/i);
  });

  it('does not tell the running-order panel the depot is on no mapped corridor', async () => {
    renderConsole(await coldFailedRead());

    // Same substitution one panel over: "is not placing any of this depot's
    // vehicles on a mapped corridor right now" is a reading, and it was not
    // taken. 34 corridors were running.
    expect(screenText()).not.toMatch(/not placing any of this depot's vehicles/i);
    expect(screenText()).not.toMatch(/has been surveyed into the control database/i);
    expect(screenText()).toMatch(/did not answer/i);
  });

  it('does not state in the shell subtitle that no corridor is in service', async () => {
    renderConsole(await coldFailedRead());
    expect(screenText()).not.toMatch(/no mapped corridor in service/i);
  });
});

describe('the depot console when a failed refresh still has a last-known-good', () => {
  /**
   * The rung above the bottom one, and it was already correct. These
   * assertions exist so a fix for the case above can never be made by
   * blanking this one — that would take real, recently-measured readings off
   * an operator's screen during an outage.
   */
  async function staleAfterGoodRead(): Promise<DepotConsoleSnapshot> {
    const getDepotConsoleSnapshot = await loadSnapshotReader();
    healthyControlService();
    const good = await getDepotConsoleSnapshot({ scope: BAREILLY, scopedFleet: REPORTING_FLEET, now: clock });
    expect(good.stale).toBe(false);
    expect(good.mappedCorridorCount).toBe(759);

    fetchControlService.mockRejectedValue(new Error('control service down'));
    // Past both TTLs, so the refresh is really attempted and really fails.
    return getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: REPORTING_FLEET,
      now: clock + 5 * 60 * 1000,
    });
  }

  it('keeps showing the real numbers it really observed', async () => {
    const snapshot = await staleAfterGoodRead();
    expect(snapshot.stale).toBe(true);
    renderConsole(snapshot);

    const text = screenText();
    expect(text).toMatch(/759 corridors mapped statewide/);
    expect(text).toMatch(/133 on roads not yet surveyed/); // 195 reporting - 62 placed
    expect(screen.getByText('Corridors running').parentElement!.textContent).toMatch(/34/);
    expect(screen.getByText('Can report bunching').parentElement!.textContent).toMatch(/14/);
  });

  it('labels them as stale rather than presenting them as current', async () => {
    renderConsole(await staleAfterGoodRead());
    expect(screenText()).toMatch(/corridors stale/i);
  });
});

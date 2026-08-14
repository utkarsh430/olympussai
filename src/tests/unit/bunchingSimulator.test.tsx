// @vitest-environment jsdom
//
// The rehearsal surface, driven the way a planner drives it.
//
// What this file holds is the honesty contract, because that is the whole
// justification for keeping this page rather than deleting it:
//
//   * it says it is a simulation, permanently and in the chrome, not in a
//     tooltip;
//   * it does not offer a corridor that has no measured target headway, and
//     when the service refuses one anyway it prints the reason;
//   * a result whose provenance manifest did not arrive is not drawn at all;
//   * nothing on it can issue an instruction.
//
// The map is mocked out: it is the one part with its own suite
// (rehearsalOverlays.test.ts, opsFleetMapPanel.test.tsx) and the only part
// that needs a Google basemap, which no test process has.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/bunching/RehearsalMap', () => ({
  RehearsalMap: ({ armLabel }: { armLabel: string }) => (
    <div data-testid="rehearsal-map">map:{armLabel}</div>
  ),
}));

import { BunchingSimulator } from '@/components/bunching/BunchingSimulator';
import type { RouteDirectionMeta } from '@/models/control';

const CALIBRATED = '11111111-1111-4111-8111-111111111111';
const UNCALIBRATED = '22222222-2222-4222-8222-222222222222';

function corridor(overrides: Partial<RouteDirectionMeta> = {}): RouteDirectionMeta {
  return {
    routeDirectionId: CALIBRATED,
    routeId: '1348',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 90_000,
    hasActivePolicy: true,
    ...overrides,
  };
}

const CORRIDORS: RouteDirectionMeta[] = [
  corridor(),
  corridor({ routeDirectionId: UNCALIBRATED, routeId: '9002', hasActivePolicy: false }),
];

function kpis() {
  return {
    meanHeadwaySeconds: 900,
    headwayCv: 0.4,
    bunchingIncidents: 2,
    excessWaitSeconds: 600,
    deniedBoardings: 40,
    strandedPassengers: 40,
    onTimeDispatchRate: 0.9,
    complianceRate: null,
    totalBoardings: 900,
  };
}

function result(patch: Record<string, unknown> = {}) {
  return {
    corridor: {
      routeDirectionId: CALIBRATED,
      routeId: '1348',
      routeName: 'Lucknow - Kanpur',
      directionCode: 'OUT',
      isLoop: false,
      totalDistanceMeters: 90_000,
      calibrationSource: 'timetable',
      stops: [],
      shape: [],
      controlPointCount: 5,
    },
    policy: {
      targetHeadwaySeconds: 900,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.6,
      kb: 0.3,
      selfEqualizingK: 0.5,
      maxHoldSeconds: 90,
      cooldownSeconds: 60,
      predictionHorizonControlPoints: 3,
      occupancyCapacity: null,
      occupancyStaleSeconds: null,
    },
    inputs: {
      cruiseSpeedKmph: 35,
      travelTimeVariation: 0.12,
      boardingRatePerMinute: 1.5,
      alightingFraction: 0.18,
      baseDwellSeconds: 20,
      secondsPerBoarding: 2.5,
      secondsPerAlighting: 1.5,
      vehicleCapacity: 52,
      vehicleCount: 6,
      seed: 1,
      disturbance: 'none',
    },
    provenance: [
      {
        field: 'Passenger demand',
        source: 'modelled',
        value: '1.5/min boarding',
        note: 'INVENTED. No boarding data is held anywhere in this system.',
      },
      {
        field: 'Target headway H*',
        source: 'measured',
        value: '15.0 min',
        note: 'Median gap between published departures.',
      },
    ],
    arms: {
      uncontrolled: { name: 'no-control', kpis: kpis(), frames: [], appliedHoldSeconds: 0, refusedHoldSeconds: 0 },
      controlled: {
        name: 'deployed-control-laws',
        kpis: { ...kpis(), bunchingIncidents: 1 },
        frames: [],
        appliedHoldSeconds: 90,
        refusedHoldSeconds: 0,
      },
    },
    decisions: [],
    occupancyContrast: {
      decisionsScored: 4,
      decisionsUsingFallbackToday: 4,
      meanOnboardCostAsDeployedToday: 28.8,
      meanOnboardCostWithModelledOccupancy: 38.3,
      rankingComparable: false,
    },
    disturbedVehicleId: null,
    notRehearsed: ['Terminal dispatch regulation is not exercised.'],
    horizonSeconds: 10_000,
    ...patch,
  };
}

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: () => Promise.resolve(response.body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSimulator(props: Partial<React.ComponentProps<typeof BunchingSimulator>> = {}) {
  return render(
    <BunchingSimulator
      email="planner@example.test"
      role="planner"
      corridors={CORRIDORS}
      corridorsError={null}
      {...props}
    />,
  );
}

describe('the rehearsal surface', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('it never reads as operations', () => {
    it('says it is a simulation in the page chrome, before any run', () => {
      renderSimulator();
      expect(screen.getAllByText(/simulation/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/every bus on this page is invented/i)).toBeInTheDocument();
    });

    it('states that nothing here can issue an instruction', () => {
      renderSimulator();
      expect(screen.getByText(/cannot issue an instruction|can issue an/i)).toBeInTheDocument();
    });
  });

  describe('the uncalibrated corridors', () => {
    // 561 of 759. Offering one and then being refused is a worse experience
    // than not offering it, and the reason has to be on the page either way.
    it('offers only corridors with a measured target headway', () => {
      renderSimulator();
      const picker = screen.getByLabelText('Corridor');
      const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent ?? '');
      expect(options).toHaveLength(1);
      expect(options[0]).toContain('1348');
      expect(options.join(' ')).not.toContain('9002');
    });

    it('says how many corridors it cannot simulate, and why', () => {
      renderSimulator();
      expect(screen.getByText(/observation-only/i)).toBeInTheDocument();
      expect(screen.getByText(/every bunching threshold is a ratio of that target/i)).toBeInTheDocument();
    });

    it('explains itself when every corridor in the network is observation-only', () => {
      renderSimulator({ corridors: [corridor({ hasActivePolicy: false })] });
      expect(
        screen.getByText(/no corridor in this network has a measured target headway/i),
      ).toBeInTheDocument();
    });

    // Belt and braces: the list is a convenience, the refusal is the
    // boundary, and the refusal's own words have to reach the operator.
    it('prints the service refusal verbatim when a run is refused anyway', async () => {
      mockFetch({
        ok: false,
        status: 404,
        body: {
          error: {
            code: 'UNCALIBRATED_CORRIDOR',
            message: 'Route-direction rd-1 has no measured target headway, so no simulation can be run on it.',
          },
        },
      });
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));
      await waitFor(() => {
        expect(screen.getByText(/no measured target headway/i)).toBeInTheDocument();
      });
    });
  });

  describe('a completed run', () => {
    it('shows both arms and lets the planner switch between them', async () => {
      mockFetch({ ok: true, body: result() });
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));

      await waitFor(() => expect(screen.getByTestId('rehearsal-map')).toHaveTextContent('controlled'));
      fireEvent.click(screen.getByRole('button', { name: /^no control$/i }));
      expect(screen.getByTestId('rehearsal-map')).toHaveTextContent('uncontrolled');
    });

    it('keeps the provenance manifest one click away and labels the invented inputs', async () => {
      mockFetch({ ok: true, body: result() });
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));
      await waitFor(() => expect(screen.getByTestId('rehearsal-map')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('tab', { name: /what is real/i }));
      expect(screen.getByText(/passenger demand/i)).toBeInTheDocument();
      expect(screen.getAllByText(/^modelled$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^measured$/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/no boarding data is held anywhere in this system/i)).toBeInTheDocument();
    });

    it('names what it does not rehearse rather than leaving it to be discovered', async () => {
      mockFetch({ ok: true, body: result() });
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));
      await waitFor(() => expect(screen.getByTestId('rehearsal-map')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('tab', { name: /what is real/i }));
      expect(screen.getByText(/terminal dispatch regulation is not exercised/i)).toBeInTheDocument();
    });

    it('reports the occupancy gap as a gap, not as a reading', async () => {
      mockFetch({ ok: true, body: result() });
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));
      await waitFor(() => expect(screen.getByTestId('rehearsal-map')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('tab', { name: /occupancy/i }));
      expect(screen.getAllByText(/never had a real load to weigh/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/assumes each bus is half full/i).length).toBeGreaterThan(0);
      // The contrast is sized, never presented as a measurement of any bus.
      expect(screen.getByText(/a load this simulator invented/i)).toBeInTheDocument();
    });

    it('sends the operator\'s modelled inputs with the run', async () => {
      const fetchMock = mockFetch({ ok: true, body: result() });
      renderSimulator();

      fireEvent.change(screen.getByLabelText(/buses on the corridor/i), { target: { value: '9' } });
      fireEvent.change(screen.getByLabelText(/scenario/i), { target: { value: 'gps_dropout' } });
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;
      expect(body).toMatchObject({ routeDirectionId: CALIBRATED, vehicleCount: 9, disturbance: 'gps_dropout' });
    });
  });

  describe('when the result cannot be described honestly', () => {
    // The labels are the only thing separating this page from a page of
    // fabricated operational numbers, so a payload without them is not drawn.
    it('refuses to draw a result whose provenance manifest is missing', async () => {
      const broken = result();
      delete (broken as Record<string, unknown>).provenance;
      mockFetch({ ok: true, body: broken });

      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));

      await waitFor(() => {
        expect(screen.getByText(/cannot describe honestly/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('rehearsal-map')).not.toBeInTheDocument();
    });

    it('says the service is unreachable rather than showing an empty run', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      renderSimulator();
      fireEvent.click(screen.getByRole('button', { name: /run the rehearsal/i }));

      await waitFor(() => {
        expect(screen.getByText(/could not be reached/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('rehearsal-map')).not.toBeInTheDocument();
    });

    it('explains an unreadable corridor list instead of showing an empty picker', () => {
      renderSimulator({ corridors: [], corridorsError: 'The corridor list could not be read.' });
      expect(screen.getByText(/corridor list could not be read/i)).toBeInTheDocument();
    });
  });
});

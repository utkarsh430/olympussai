// @vitest-environment jsdom
//
// The standing-proposal panel, read the way an operator reads it.
//
// ─── WHAT THIS PANEL IS ──────────────────────────────────────────────────
//
// control-service's decision cycle has solved every eligible corridor every
// 90 seconds since it landed and written a `recommendations` row each time,
// and nothing read that table: no route served it and no console fetched it.
// Every proposal a dispatcher ever saw came from the live solve taken when
// they opened a corridor themselves. This panel is the first thing that puts
// the automatic loop's output in front of a person.
//
// ─── THE THREE RULES ALL OF THIS PROTECTS ────────────────────────────────
//
//   1. AN EMPTY LIST IS NOT AN ALL-CLEAR, and here it collapses FOUR states
//      that must not render alike: the controller proposed nothing, the
//      controller has never run, the controller has stopped, and the feed
//      could not be read.
//   2. A STALE ROW MUST NOT READ AS A CURRENT ONE. Age is not decoration on
//      this surface; it is the difference between "said a moment ago" and
//      "said, and nothing has confirmed it since".
//   3. NOTHING HERE IS APPROVABLE. There is no issue affordance and there
//      cannot be one - the feed does not carry the objects an approval would
//      name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StandingProposalsPanel } from '@/components/ops/control-room/recommendations/StandingProposalsPanel';
import type {
  StandingRecommendation,
  StandingRecommendationFeed,
} from '@/models/recommendationFeed';

function recommendation(overrides: Partial<StandingRecommendation> = {}): StandingRecommendation {
  return {
    id: 'rec-1',
    routeDirectionId: 'rd-1',
    routeId: 'r-1',
    routePublicName: 'Lucknow – Kanpur',
    directionCode: 'UP',
    directionName: 'Towards Kanpur',
    incidentId: 'inc-1',
    status: 'proposed',
    selectedActionType: 'two_way_hold',
    selectedVehicleId: 'UP25FT4823',
    selectedHoldSeconds: 45,
    candidateActionCount: 2,
    objectiveCost: -1200,
    expectedRecoverySeconds: 300,
    controllerVersion: 'mpc-1',
    paceAdvisories: [],
    createdAt: '2026-09-06T09:00:00.000Z',
    ageSeconds: 40,
    freshness: 'fresh',
    ...overrides,
  };
}

function feed(overrides: Partial<StandingRecommendationFeed> = {}): StandingRecommendationFeed {
  return {
    recommendations: [recommendation()],
    windowSeconds: 900,
    freshWithinSeconds: 90,
    totalWithinWindow: 1,
    latestCreatedAt: '2026-09-06T09:00:00.000Z',
    generatedAt: '2026-09-06T09:00:40.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StandingProposalsPanel', () => {
  it('names the corridor, the action and the bus', () => {
    render(<StandingProposalsPanel initialFeed={feed()} />);

    expect(screen.getByText(/Lucknow – Kanpur · Towards Kanpur/)).toBeInTheDocument();
    expect(screen.getByText('Two-way hold')).toBeInTheDocument();
    expect(screen.getByText('UP25FT4823')).toBeInTheDocument();
  });

  // The panel's own framing. An operator must not read this list as a second
  // alert feed, because it answers a different question and an empty one means
  // something entirely different.
  it('describes itself as a record, not as an offer', () => {
    render(<StandingProposalsPanel initialFeed={feed()} />);
    expect(screen.getByText(/not an offer to act on/i)).toBeInTheDocument();
  });

  describe('a row that has not been confirmed since it was written', () => {
    it('is labelled differently from a recent one', () => {
      render(
        <StandingProposalsPanel
          initialFeed={feed({
            recommendations: [recommendation({ ageSeconds: 600, freshness: 'lapsed' })],
          })}
        />,
      );
      expect(screen.getByText('Not confirmed since')).toBeInTheDocument();
      expect(screen.queryByText('Just proposed')).not.toBeInTheDocument();
    });

    it('is still shown rather than hidden', () => {
      render(
        <StandingProposalsPanel
          initialFeed={feed({
            recommendations: [recommendation({ ageSeconds: 600, freshness: 'lapsed' })],
          })}
        />,
      );
      // Dropping it would leave the corridor looking untouched, which is a
      // worse lie than showing a labelled stale row.
      expect(screen.getByText(/Lucknow – Kanpur/)).toBeInTheDocument();
    });
  });

  describe('an empty list', () => {
    it('does not read as an all-clear when the controller has never written', () => {
      render(
        <StandingProposalsPanel
          initialFeed={feed({ recommendations: [], totalWithinWindow: 0, latestCreatedAt: null })}
        />,
      );
      expect(screen.getByText(/never recorded a proposal/i)).toBeInTheDocument();
      expect(screen.getByText(/not an all-clear/i)).toBeInTheDocument();
    });

    it('does not read as an all-clear when the controller has stopped', () => {
      render(
        <StandingProposalsPanel
          initialFeed={feed({
            recommendations: [],
            totalWithinWindow: 0,
            // Fixed timestamps, three hours apart: the copy is measured
            // against the feed's own clock, not the machine running the test.
            latestCreatedAt: '2026-09-06T06:00:00.000Z',
            generatedAt: '2026-09-06T09:00:00.000Z',
          })}
        />,
      );
      expect(screen.getByText(/Nothing standing, and nothing recent either/i)).toBeInTheDocument();
    });

    it('still refuses to claim the network is fine on the ordinary quiet case', () => {
      render(
        <StandingProposalsPanel
          initialFeed={feed({
            recommendations: [],
            totalWithinWindow: 0,
            latestCreatedAt: '2026-09-06T08:59:00.000Z',
            generatedAt: '2026-09-06T09:00:00.000Z',
          })}
        />,
      );
      expect(screen.getByText(/not a statement that nothing is wrong/i)).toBeInTheDocument();
    });

    // An unreadable feed is a fourth state and must not look like any of the
    // three above. This is the same rule the alert inbox learned.
    it('says unknown, not nothing, when the feed could not be read', () => {
      render(<StandingProposalsPanel initialFeed={null} initialError="upstream is down" />);
      expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
      expect(screen.queryByText(/never recorded a proposal/i)).not.toBeInTheDocument();
    });

    it('says a served list is not live when it came from the outage fallback', () => {
      render(<StandingProposalsPanel initialFeed={{ ...feed(), stale: true, ageMs: 45_000 }} />);
      expect(screen.getByText(/This list is not live/i)).toBeInTheDocument();
      expect(screen.getByText(/45s ago/)).toBeInTheDocument();
    });
  });

  // A row the decision cycle wrote because the only useful advice on the
  // corridor was "ease off". A hold-shaped row would lose it entirely.
  it('shows a pace-only row as advice rather than as an empty hold', () => {
    render(
      <StandingProposalsPanel
        initialFeed={feed({
          recommendations: [
            recommendation({
              selectedActionType: null,
              selectedVehicleId: null,
              selectedHoldSeconds: null,
              candidateActionCount: 0,
              paceAdvisories: [
                {
                  vehicleId: 'UP25FT1001',
                  routeDirectionId: 'rd-1',
                  action: 'reduce_pace',
                  currentSpeedKmph: 38,
                  targetSpeedKmph: 30,
                  scheduleSlackSeconds: 120,
                  rationale: 'Closing on the bus in front with slack in hand.',
                },
              ],
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('No hold selected')).toBeInTheDocument();
    expect(screen.getByText(/1 bus advised to ease off/)).toBeInTheDocument();
  });

  describe('opening a proposal', () => {
    it('says the stored row is unconfirmed before any solve is taken', async () => {
      render(<StandingProposalsPanel initialFeed={feed()} />);
      await userEvent.click(screen.getByRole('button', { name: /Lucknow – Kanpur/ }));

      expect(screen.getByText(/Not confirmed by a live solve/i)).toBeInTheDocument();
      expect(screen.getByText(/Do not act on the stored row/i)).toBeInTheDocument();
    });

    // THE ASSERTION THIS PANEL EXISTS TO SURVIVE. Showing a stored proposal
    // and a live one without saying which is which is the failure mode.
    it('names the live solve as the one to act on when the two agree', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          selectedAction: { actionType: 'two_way_hold', vehicleId: 'UP25FT4823', holdSeconds: 45 },
        }),
      } as unknown as Response);

      render(<StandingProposalsPanel initialFeed={feed()} />);
      await userEvent.click(screen.getByRole('button', { name: /Lucknow – Kanpur/ }));
      await userEvent.click(screen.getByRole('button', { name: /Solve this corridor now/ }));

      expect(await screen.findByText(/The live solve agrees/i)).toBeInTheDocument();
      expect(screen.getByText(/Act on the live solve/i)).toBeInTheDocument();
    });

    it('says the corridor moved on when the live solve names a different bus', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          selectedAction: { actionType: 'two_way_hold', vehicleId: 'UP25FT1001', holdSeconds: 30 },
        }),
      } as unknown as Response);

      render(<StandingProposalsPanel initialFeed={feed()} />);
      await userEvent.click(screen.getByRole('button', { name: /Lucknow – Kanpur/ }));
      await userEvent.click(screen.getByRole('button', { name: /Solve this corridor now/ }));

      expect(await screen.findByText(/proposes something else/i)).toBeInTheDocument();
      expect(screen.getByText(/Act on the live solve/i)).toBeInTheDocument();
    });

    it('keeps the stored row unconfirmed when the solve fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'CONTROL_SERVICE_UNAVAILABLE', message: 'down' } }),
      } as unknown as Response);

      render(<StandingProposalsPanel initialFeed={feed()} />);
      await userEvent.click(screen.getByRole('button', { name: /Lucknow – Kanpur/ }));
      await userEvent.click(screen.getByRole('button', { name: /Solve this corridor now/ }));

      // A failed solve is not agreement, and must not quietly leave the stored
      // row looking current.
      expect(await screen.findByText(/a failed solve is not agreement/i)).toBeInTheDocument();
      expect(screen.getByText(/Do not act on the stored row/i)).toBeInTheDocument();
    });

    // The boundary the whole task is not allowed to touch. This panel proposes
    // nothing to a bus; issuing stays behind the console's approval path.
    it('offers no way to issue anything', async () => {
      render(<StandingProposalsPanel initialFeed={feed()} />);
      await userEvent.click(screen.getByRole('button', { name: /Lucknow – Kanpur/ }));

      expect(screen.queryByRole('button', { name: /approve|issue|send/i })).toBeNull();
      // The only route to a bus is the console, and it is a link out, not an
      // action taken here.
      expect(
        screen.getByRole('link', { name: /Open this corridor in the console/i }),
      ).toHaveAttribute('href', expect.stringContaining('/ops/control-room?tab=decisions'));
    });
  });

  it('says what the page is a slice of when the list is truncated', () => {
    render(<StandingProposalsPanel initialFeed={feed({ totalWithinWindow: 37 })} />);
    expect(screen.getByText(/Showing 1 of 37 corridors/)).toBeInTheDocument();
  });
});

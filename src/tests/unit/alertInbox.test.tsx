// @vitest-environment jsdom
//
// The alert inbox, read the way an operator reads it.
//
// ─── THE RULE ALL OF THIS PROTECTS ───────────────────────────────────────
//
// On an alert surface, three states must never render alike:
//
//   nothing is wrong          an all-clear, and safe to act on
//   nothing has been read     the feed has not arrived yet
//   the feed could not be read  the network state is UNKNOWN
//
// Any UI that collapses the second or third into the first is telling a
// control room the network is fine at the exact moment it has stopped being
// able to tell. That is the failure this file exists to prevent, and it is why
// several assertions below are about words on screen rather than about state.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertInbox } from '@/components/ops/control-room/alerts/AlertInbox';
import { countdownLabel } from '@/components/ops/control-room/alerts/AlertRow';
import type { AlertFeed, BunchingAlert } from '@/models/control';

function alert(overrides: Partial<BunchingAlert> = {}): BunchingAlert {
  return {
    id: 'inc-1',
    routeDirectionId: 'rd-1',
    members: [
      { vehicleId: 'UP25FT1000', role: 'leader' },
      { vehicleId: 'UP25FT1001', role: 'follower' },
    ],
    severity: 'predicted',
    causeClass: 'endogenous',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-20T09:00:00.000Z',
    endedAt: null,
    evidence: {},
    routeId: 'r-1',
    routePublicName: 'Lucknow – Kanpur',
    directionCode: 'UP',
    directionName: 'Towards Kanpur',
    secondsToBunching: 900,
    riskScore: 0.5,
    ...overrides,
  };
}

function feed(overrides: Partial<AlertFeed> = {}): AlertFeed {
  return {
    alerts: [alert()],
    countsBySeverity: { predicted: 1 },
    totalOpenCount: 1,
    generatedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('countdownLabel', () => {
  it('says how long until this pair bunches', () => {
    expect(countdownLabel(900, 'predicted')).toBe('~15 min to bunching');
  });

  // THE LOAD-BEARING ONE. Null means the forecaster stopped having an opinion
  // - the samples went too sparse or too noisy to fit a trend. Rendering it as
  // "0 min" would claim an imminent bunch; rendering nothing would read as
  // safety. It is neither, so it says so.
  it('never turns an absent forecast into a number', () => {
    expect(countdownLabel(null, 'predicted')).toBe('No current countdown');
  });

  // A collapsed gap has nothing to count down to; it has already happened.
  it('says nothing at all for an incident that is already measured', () => {
    expect(countdownLabel(900, 'bunched')).toBeNull();
    expect(countdownLabel(null, 'warning')).toBeNull();
  });

  it('does not round a crossing that is seconds away up to a minute', () => {
    expect(countdownLabel(20, 'predicted')).toBe('Bunching now');
  });
});

describe('AlertInbox', () => {
  it('names the corridor on every row, because the reader has chosen none', () => {
    render(<AlertInbox initialFeed={feed()} />);
    expect(screen.getByText(/Lucknow – Kanpur/)).toBeTruthy();
    expect(screen.getByText(/~15 min to bunching/)).toBeTruthy();
  });

  // A predicted row makes a claim about two buses whose gap is demonstrably
  // still fine. Without the reason beside it, it reads as a malfunction.
  it('explains a predicted alert in the row itself', () => {
    render(<AlertInbox initialFeed={feed()} />);
    expect(screen.getByText(/closing fast enough to bunch soon/i)).toBeTruthy();
  });

  it('shows severity counts taken over the whole network, not the page', () => {
    render(
      <AlertInbox
        initialFeed={feed({ countsBySeverity: { predicted: 12, bunched: 3 }, totalOpenCount: 15 })}
      />,
    );
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
  });

  // ─── THE THREE STATES THAT MUST NOT LOOK ALIKE ─────────────────────────

  it('calls an empty list an all-clear only for the corridors that are checked', () => {
    render(<AlertInbox initialFeed={feed({ alerts: [], countsBySeverity: {}, totalOpenCount: 0 })} />);
    const empty = screen.getByText(/No bunching alerts are open/);
    expect(empty).toBeTruthy();
    // The qualifier is not decoration: corridors with no planned headway are
    // never checked at all, so silence about them is not an all-clear.
    expect(empty.textContent).toMatch(/without a planned headway are not checked/i);
  });

  it('says an unread feed is unread, and explicitly not an all-clear', () => {
    render(<AlertInbox initialFeed={null} />);
    const notice = screen.getByText(/has not been read yet/);
    expect(notice.textContent).toMatch(/not an all-clear/i);
  });

  it('says a stale feed is not live rather than quietly showing old rows', () => {
    render(<AlertInbox initialFeed={{ ...feed(), stale: true, ageMs: 45_000 }} />);
    expect(screen.getByText(/This list is not live/)).toBeTruthy();
    expect(screen.getByText(/45s ago/)).toBeTruthy();
    // The rows are still shown - emptying them would be the worse failure.
    expect(screen.getByText(/Lucknow – Kanpur/)).toBeTruthy();
  });

  it('puts a collapsed gap above a forecast one', () => {
    render(
      <AlertInbox
        initialFeed={feed({
          alerts: [
            alert({ id: 'p', severity: 'predicted', routePublicName: 'Predicted route' }),
            alert({ id: 'b', severity: 'bunched', routePublicName: 'Bunched route', secondsToBunching: null }),
          ],
          countsBySeverity: { predicted: 1, bunched: 1 },
          totalOpenCount: 2,
        })}
      />,
    );
    const rendered = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const bunchedAt = rendered.findIndex((t) => t.includes('Bunched route'));
    const predictedAt = rendered.findIndex((t) => t.includes('Predicted route'));
    expect(bunchedAt).toBeGreaterThanOrEqual(0);
    expect(bunchedAt).toBeLessThan(predictedAt);
  });
});

// ─── THE ALTERNATIVES THAT COST NO DELAY ─────────────────────────────────
//
// Both levers below fix bunching WITHOUT adding delay, which is the exact
// combination the operator asked for, and neither can be ranked against the
// holds on the engine's own scale. Alighting-only has an estimable cost and
// an unmeasurable benefit; easing off is not an instruction with a hold
// length at all. So they are presented, not chosen - and these tests hold the
// presentation honest about which numbers are measured and which are guesses.
describe('AlertSolutionPanel alternatives', () => {
  const solveResponse = (overrides: Record<string, unknown> = {}) => ({
    routeDirectionId: 'rd-1',
    solvedAt: new Date().toISOString(),
    controllerVersion: 'v1',
    engineActionTypes: ['two_way_hold'],
    selectedAction: null,
    selectionBasis: 'no_candidates',
    objectiveCost: null,
    expectedRecoverySeconds: null,
    candidateActions: [],
    safeCandidates: [],
    rejectedCandidates: [],
    predictiveAdvisory: { label: 'PREDICTIVE', horizonControlPoints: 3, candidates: [], controllerVersion: 'v1' },
    constraints: {},
    commandsBlockedBy: null,
    persistence: 'none',
    boardingLimitCandidates: [],
    paceAdvisories: [],
    ...overrides,
  });

  const boardingLimit = {
    actionType: 'boarding_limit',
    vehicleId: 'UP25FT1000',
    involvedVehicleIds: ['UP25FT1000', 'UP25FT1001'],
    holdSeconds: 0,
    objectiveCost: 240,
    clampResidualSeconds: 0,
    passengerCost: {
      waitPassengerSeconds: 240,
      onboardPassengerSeconds: 0,
      operatorPassengerSeconds: 0,
      latenessPassengerSeconds: 0,
      netPassengerSeconds: 240,
      loadEstimated: true,
      backwardEstimated: false,
      scheduleUnknown: true,
    },
    rationale: 'Let passengers off UP25FT1000 but take none on: UP25FT1001 is only 120s behind.',
    scheduleDeviationSeconds: null,
    routeDirectionId: 'rd-1',
    stateAsOf: new Date().toISOString(),
    headwayDeviationSeconds: -480,
    targetHeadwaySeconds: 600,
    estimate: {
      // Null, as it is on every corridor today: the arrival rate is still a
      // placeholder, so a passenger count here would be an artefact.
      leftBehindPassengers: null,
      leftBehindWaitSeconds: 120,
      imposedWaitPassengerSeconds: null,
      dwellSavingSeconds: null,
      lambdaIsProxy: true,
    },
  };

  async function renderWithSolve(response: Record<string, unknown>) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const user = userEvent.setup();
    render(<AlertInbox initialFeed={feed()} />);
    await user.click(screen.getByRole('button', { name: /Lucknow/ }));
    await user.click(screen.getByRole('button', { name: /Work out a solution/i }));
    return user;
  }

  it('offers alighting-only even when no hold was proposed', async () => {
    await renderWithSolve(solveResponse({ boardingLimitCandidates: [boardingLimit] }));

    expect(await screen.findByText(/Alternatives that cost no delay/i)).toBeTruthy();
    // The bus is named, and it is the LEADER of the pair - the one with
    // another right behind it - not the follower every hold names.
    expect(screen.getAllByText('UP25FT1000').length).toBeGreaterThan(0);
    expect(screen.getByText(/UP25FT1001 is only 120s behind/)).toBeTruthy();
  });

  // States the measured wait, and says plainly that the number of people
  // cannot be estimated — rather than rendering an artefact as a count.
  it('shows the measured wait and refuses to state a passenger count', async () => {
    await renderWithSolve(solveResponse({ boardingLimitCandidates: [boardingLimit] }));
    const line = await screen.findByText(/waits 120s for the bus behind/i);
    expect(line.textContent).toMatch(/cannot be estimated yet/i);
    expect(line.textContent).not.toMatch(/About \d+ passengers/i);
  });

  it('offers easing off, the lever that spends slack instead of adding delay', async () => {
    await renderWithSolve(
      solveResponse({
        paceAdvisories: [
          {
            vehicleId: 'UP25FT1001',
            routeDirectionId: 'rd-1',
            action: 'reduce_pace',
            currentSpeedKmph: 42,
            targetSpeedKmph: 33,
            scheduleSlackSeconds: -240,
            rationale: 'Running ahead of schedule and closing on the bus in front.',
          },
        ],
      }),
    );
    expect(await screen.findByText(/Ease/)).toBeTruthy();
    expect(screen.getByText(/33 km\/h/)).toBeTruthy();
  });

  // No alternatives is a legitimate state and must not render an empty
  // heading promising options that are not there.
  it('says nothing at all when there are no alternatives', async () => {
    await renderWithSolve(solveResponse());
    expect(await screen.findByText(/No hold would help here/i)).toBeTruthy();
    expect(screen.queryByText(/Alternatives that cost no delay/i)).toBeNull();
  });
});

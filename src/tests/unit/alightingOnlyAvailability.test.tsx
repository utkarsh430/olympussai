// @vitest-environment jsdom
//
// What the console says when the one instruction that visibly costs a
// passenger is NOT being offered.
//
// ─── WHY THIS NEEDS ITS OWN TESTS ────────────────────────────────────────
//
// Alighting-only ("let people off, take nobody on") is switched off on every
// corridor on this network. So on every solve its candidate list is empty, and
// an empty list is the same SHAPE for two facts that are nothing alike:
//
//   - the engine looked at this corridor and found nothing to propose, and
//   - the engine found something and is not allowed to offer it.
//
// The second is the state that a per-corridor switch and a refusal tripwire
// create, and it is the state an operator has to be able to see - both because
// a suppressed lever presented as a quiet one is a lie about the corridor, and
// because the number of proposals being withheld is exactly what somebody is
// being asked about when they are asked whether to switch this on.
//
// These tests also pin the thing the copy must never do: turn a count of
// INSTRUCTIONS into a count of PEOPLE. Nothing in this deployment counts the
// people a bus refuses, and a small confident number about refused passengers
// on this page is the most quotable wrong thing the console could carry - the
// same rule that keeps `leftBehindPassengers` null.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describeBoardingLimitAvailability } from '@/lib/ops/recommendationView';
import { mpcSolveResultSchema } from '@/models/control';
import { AlertInbox } from '@/components/ops/control-room/alerts/AlertInbox';
import type { AlertFeed, BunchingAlert } from '@/models/control';

describe('describeBoardingLimitAvailability', () => {
  const base = {
    offered: false as boolean,
    withheldReason: null as 'disabled_for_corridor' | 'refusal_tripwire' | null,
    refusalsInWindow: null as number | null,
    maxRefusals: 6,
    windowSeconds: 3600,
    remainingRefusals: null as number | null,
    withheldCandidateCount: 0,
  };

  it('says nothing at all when the control service predates the gate', () => {
    // An absent field must never be dressed as a known state. Rendering "not
    // offered" here would claim a corridor is switched off on the strength of
    // a field the service never sent.
    expect(describeBoardingLimitAvailability(null)).toBeNull();
    expect(describeBoardingLimitAvailability(undefined)).toBeNull();
  });

  it('stays silent on a switched-off corridor that had nothing to withhold', () => {
    // Every corridor is switched off, so an unconditional notice here would
    // appear on every solve of every corridor forever and become wallpaper -
    // sitting directly above the two states that must actually be read.
    expect(
      describeBoardingLimitAvailability({
        ...base,
        withheldReason: 'disabled_for_corridor',
        withheldCandidateCount: 0,
      }),
    ).toBeNull();
  });

  it('speaks up when a switched-off corridor DID withhold a proposal', () => {
    const copy = describeBoardingLimitAvailability({
      ...base,
      withheldReason: 'disabled_for_corridor',
      withheldCandidateCount: 2,
    });

    expect(copy).not.toBeNull();
    expect(copy?.headline).toMatch(/switched off for this corridor/i);
    // The number is stated, because it is the number the operator is being
    // asked about when they are asked whether to turn this on.
    expect(copy?.detail).toMatch(/2 of these instructions/i);
    // And the reason it is off is a service decision, not a verdict the engine
    // reached - the copy must not read as "the engine considered and rejected".
    expect(copy?.detail).toMatch(/service decision/i);
  });

  it('puts the refusal budget beside the proposal when the corridor is switched on', () => {
    const copy = describeBoardingLimitAvailability({
      ...base,
      offered: true,
      refusalsInWindow: 2,
      maxRefusals: 6,
      remainingRefusals: 4,
    });

    expect(copy?.tone).toBe('info');
    expect(copy?.headline).toMatch(/2 of 6 drop-off-only instructions used in the last 1 h/i);
    expect(copy?.detail).toMatch(/4 left/i);
    // The cost is stated in the unit that is MEASURED, and the unit that is
    // not is named as not measured. Six instructions is not six people.
    expect(copy?.detail).toMatch(/not the people refused/i);
  });

  it('warns, and says the corridor recovers on its own, when the tripwire has fired', () => {
    const copy = describeBoardingLimitAvailability({
      ...base,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow: 6,
      maxRefusals: 6,
      remainingRefusals: 0,
      withheldCandidateCount: 3,
    });

    expect(copy?.tone).toBe('warn');
    expect(copy?.headline).toMatch(/has stopped on this corridor/i);
    expect(copy?.headline).toMatch(/6 instructions in the last 1 h/i);
    expect(copy?.detail).toMatch(/3 proposals are being withheld/i);
    // A rolling window, so the wire stays armed rather than latching the law
    // off until somebody notices.
    expect(copy?.detail).toMatch(/age out of the window/i);
    expect(copy?.detail).toMatch(/not the people refused/i);
  });

  it('never presents an unreadable refusal count as a clean record', () => {
    const copy = describeBoardingLimitAvailability({
      ...base,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow: null,
      remainingRefusals: null,
    });

    expect(copy?.tone).toBe('warn');
    expect(copy?.headline).toMatch(/could not be checked/i);
    // Never "0 of 6". A count that was not read is not a count of zero.
    expect(copy?.headline).not.toMatch(/\b0 of\b/);
    // And it must say the rest of the recommendation still stands, because
    // this one law's meter failing is not the corridor losing control.
    expect(copy?.detail).toMatch(/Nothing else about this recommendation is affected/i);
  });

  it('renders the window in hours only when it is whole hours', () => {
    const halfHour = describeBoardingLimitAvailability({
      ...base,
      offered: true,
      refusalsInWindow: 0,
      remainingRefusals: 6,
      windowSeconds: 1800,
    });
    expect(halfHour?.headline).toMatch(/last 30 min/);
  });
});

describe('the solve schema carries the availability', () => {
  it('parses a response from a control service that predates the gate as "cannot say"', () => {
    // Not as "available", and not as zero refusals. During a rolling deploy the
    // old service still offers proposals and simply cannot describe why.
    const parsed = mpcSolveResultSchema.parse({
      routeDirectionId: 'rd-1',
      candidateActions: [],
      safeCandidates: [],
      selectedAction: null,
      selectedActionType: null,
      objectiveCost: null,
      expectedRecoverySeconds: null,
      constraints: {},
      controllerVersion: 'v1',
      rejectedCandidates: [],
      predictiveAdvisory: {
        label: 'PREDICTIVE',
        horizonControlPoints: 3,
        candidates: [],
        controllerVersion: 'v1',
      },
    });

    expect(parsed.boardingLimitAvailability).toBeNull();
  });
});

// ─── AND THE SAME THING ON THE PAGE ──────────────────────────────────────
//
// The copy above is only worth having if it reaches the operator. This drives
// the real panel, because the failure being guarded against is a withheld
// proposal that leaves no trace on screen.
describe('AlertSolutionPanel shows why alighting-only is absent', () => {
  afterEach(() => vi.restoreAllMocks());

  const alert = (): BunchingAlert => ({
    id: 'inc-1',
    routeDirectionId: 'rd-1',
    members: [
      { vehicleId: 'UP25FT1000', role: 'leader' },
      { vehicleId: 'UP25FT1001', role: 'follower' },
    ],
    severity: 'bunched',
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
    secondsToBunching: null,
    riskScore: 0.5,
  });

  const feed = (): AlertFeed => ({
    alerts: [alert()],
    countsBySeverity: { bunched: 1 },
    totalOpenCount: 1,
    generatedAt: '2026-08-20T09:00:00.000Z',
  });

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
    predictiveAdvisory: {
      label: 'PREDICTIVE',
      horizonControlPoints: 3,
      candidates: [],
      controllerVersion: 'v1',
    },
    constraints: {},
    commandsBlockedBy: null,
    persistence: 'none',
    boardingLimitCandidates: [],
    boardingLimitAvailability: null,
    paceAdvisories: [],
    ...overrides,
  });

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
  }

  it('tells the operator a proposal was withheld rather than showing an empty panel', async () => {
    await renderWithSolve(
      solveResponse({
        boardingLimitCandidates: [],
        boardingLimitAvailability: {
          offered: false,
          withheldReason: 'disabled_for_corridor',
          refusalsInWindow: null,
          maxRefusals: 6,
          windowSeconds: 3600,
          remainingRefusals: null,
          withheldCandidateCount: 1,
        },
      }),
    );

    expect(await screen.findByText(/switched off for this corridor/i)).toBeTruthy();
  });

  it('shows the tripwire when it has fired', async () => {
    await renderWithSolve(
      solveResponse({
        boardingLimitCandidates: [],
        boardingLimitAvailability: {
          offered: false,
          withheldReason: 'refusal_tripwire',
          refusalsInWindow: 6,
          maxRefusals: 6,
          windowSeconds: 3600,
          remainingRefusals: 0,
          withheldCandidateCount: 2,
        },
      }),
    );

    expect(await screen.findByText(/has stopped on this corridor/i)).toBeTruthy();
  });

  it('stays quiet on a switched-off corridor that had nothing to propose', async () => {
    // The common case, on every corridor, on every solve. Nothing was
    // suppressed, so there is nothing to report and the panel does not grow a
    // permanent notice.
    await renderWithSolve(
      solveResponse({
        boardingLimitAvailability: {
          offered: false,
          withheldReason: 'disabled_for_corridor',
          refusalsInWindow: null,
          maxRefusals: 6,
          windowSeconds: 3600,
          remainingRefusals: null,
          withheldCandidateCount: 0,
        },
      }),
    );

    // The solve DID render - so the absence below is the panel choosing to say
    // nothing, not the panel failing to appear.
    expect(await screen.findByRole('button', { name: /Work it out again/i })).toBeTruthy();
    expect(screen.queryByText(/switched off for this corridor/i)).toBeNull();
    expect(screen.queryByText(/Alternatives that cost no delay/i)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import {
  decisionEvent,
  undoEvent,
  type DecisionInput,
} from '@/lib/depot/rebalance/decisionEvents';
import {
  decisionTrail,
  decisionsFor,
  isRepeatDecision,
  rowDecisionsFor,
} from '@/lib/depot/rebalance/decisionReducers';
import {
  decisionAnnouncement,
  decisionStatusText,
  describeTrailItem,
  isDecisionCurrent,
} from '@/lib/depot/rebalance/decisionWording';

const DATE = '2026-10-06';
const KEY = '{"locked":["agra"]}';

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    transferId: 'agra>kanpur',
    fromDepotId: 'agra',
    fromDepotName: 'Agra',
    toDepotId: 'kanpur',
    toDepotName: 'Kanpur',
    buses: 5,
    operatingDate: DATE,
    scenario: null,
    scenarioLabel: null,
    note: '',
    decision: 'approved',
    ...overrides,
  };
}

let tick = 0;
function record(events: AuditEvent[], event: ReturnType<typeof decisionEvent>): AuditEvent[] {
  tick += 1;
  return appendAuditEvent(events, {
    ...event,
    at: new Date(Date.UTC(2026, 9, 6, 6, tick)).toISOString(),
  });
}

describe('replaced and undone decisions', () => {
  it('marks a decision a later one replaced, and undoing the later one restores it', () => {
    let events = record([], decisionEvent(input({ decision: 'approved' })));
    events = record(events, decisionEvent(input({ decision: 'rejected' })));
    const [rejected, approved] = decisionTrail(events, DATE).baseline;
    expect(rejected?.decision).toBe('rejected');
    expect(approved?.superseded).toBe(true);
    expect(rejected?.superseded).toBe(false);
    expect(describeTrailItem(approved!)).toContain('(replaced by a later decision)');

    events = record(events, undoEvent(rejected!));
    const book = decisionsFor(events, DATE);
    expect(rowDecisionsFor(book, null).get('agra>kanpur')).toEqual({ kind: 'approved', buses: 5 });
    const after = decisionTrail(events, DATE).baseline;
    const restored = after.find((e) => e.eventId === approved?.eventId);
    expect(restored?.superseded).toBe(false);
    expect(restored?.undoable).toBe(true);
    expect(describeTrailItem(restored!)).not.toContain('replaced');
  });

  it('keeps each scenario key apart and labels it with its sentence', () => {
    const scenario = input({ scenario: KEY, scenarioLabel: '1 depot locked: Agra.' });
    const events = record([], decisionEvent(scenario));
    const book = decisionsFor(events, DATE);
    expect(rowDecisionsFor(book, KEY).get('agra>kanpur')?.kind).toBe('approved');
    expect(rowDecisionsFor(book, null).size).toBe(0);
    expect(decisionTrail(events, DATE).scenario[0]?.scenarioLabel).toBe('1 depot locked: Agra.');
  });

});

describe('a decision is for a number of buses', () => {
  it('reads "Approved for 5 buses" while the plan still says 5', () => {
    expect(decisionStatusText({ kind: 'approved', buses: 5 }, 5)).toBe('Approved for 5 buses');
    expect(decisionStatusText({ kind: 'deferred', buses: 1 }, 1)).toBe('Deferred for 1 bus');
    expect(decisionStatusText(null, 5)).toBe('None yet');
    expect(isDecisionCurrent({ kind: 'approved', buses: 5 }, 'approved', 5)).toBe(true);
  });

  it('says what the plan recommends now when the figure moved, and offers the decision again', () => {
    const decision = { kind: 'approved', buses: 5 } as const;
    expect(decisionStatusText(decision, 9)).toBe('Approved for 5 buses; the plan now recommends 9');
    expect(isDecisionCurrent(decision, 'approved', 9)).toBe(false);
    expect(isRepeatDecision(decision, 'approved', 9)).toBe(false);
  });

  it('treats a click on the decision already in force as a repeat', () => {
    const decision = { kind: 'approved', buses: 5 } as const;
    expect(isRepeatDecision(decision, 'approved', 5)).toBe(true);
    expect(isRepeatDecision(decision, 'rejected', 5)).toBe(false);
    expect(isRepeatDecision(null, 'approved', 5)).toBe(false);
  });
});

describe('decisionAnnouncement', () => {
  it('says what was recorded and that nothing was dispatched', () => {
    expect(decisionAnnouncement('approved', 5, 'Agra', 'Kanpur')).toBe(
      'Approved 5 buses Agra to Kanpur. Recorded only; nothing dispatched.',
    );
    expect(decisionAnnouncement('rejected', 1, 'Agra', 'Kanpur')).toBe(
      'Rejected 1 bus Agra to Kanpur. Recorded only; nothing dispatched.',
    );
  });
});

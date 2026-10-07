import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import { decisionEvent } from '@/lib/depot/rebalance/decisionEvents';
import { describeTrailItem } from '@/lib/depot/rebalance/decisionWording';
import { decisionTrail } from '@/lib/depot/rebalance/decisionReducers';
import type { ProposalSubject } from '@/lib/depot/rebalance/decisionSubject';
import {
  parseProposalDecisionEvent,
  proposalDecisionEvent,
  proposalUndoEvent,
  type ProposalDecisionInput,
} from '@/lib/depot/rebalance/proposalDecisionEvents';
import {
  isRepeatProposalDecision,
  proposalDecisionCounts,
  proposalDecisionsFor,
  proposalTrail,
  proposalUndoableFor,
} from '@/lib/depot/rebalance/proposalDecisionReducers';
import {
  describeProposalTrailItem,
  isProposalDecisionCurrent,
  proposalDecisionAnnouncement,
  proposalStatusText,
  proposalUndoAnnouncement,
} from '@/lib/depot/rebalance/proposalDecisionWording';
import type { Proposal } from '@/lib/depot/service/types';

const DATE = '2026-10-06';

function subject(id: string, routeName = 'KANPUR-LUCKNOW', change = 3): ProposalSubject {
  return {
    kind: 'proposal',
    proposalId: id,
    routeName,
    proposalKind: change >= 0 ? 'add_buses' : 'hold_buses',
    band: { fromHour: 7, toHour: 10 },
    change,
    routes: [],
    depotName: null,
    count: null,
  };
}

function input(s: ProposalSubject, overrides: Partial<ProposalDecisionInput> = {}): ProposalDecisionInput {
  return { subject: s, operatingDate: DATE, note: '', decision: 'approved', ...overrides };
}

let tick = 0;
function record(events: readonly AuditEvent[], event: ReturnType<typeof proposalDecisionEvent>): AuditEvent[] {
  tick += 1;
  return appendAuditEvent([...events], {
    ...event,
    at: new Date(Date.UTC(2026, 9, 6, 6, tick)).toISOString(),
  });
}

function proposalOf(id: string, change = 3): Proposal {
  return { id, change } as unknown as Proposal;
}

describe('proposal decisions per proposal', () => {
  it('keeps the latest decision in force per proposal, apart from transfers', () => {
    let events = record([], proposalDecisionEvent(input(subject('a'))));
    events = record(events, proposalDecisionEvent(input(subject('a'), { decision: 'rejected' })));
    events = record(events, decisionEvent({
      transferId: 'a', fromDepotId: 'x', fromDepotName: 'X', toDepotId: 'y', toDepotName: 'Y',
      buses: 2, operatingDate: DATE, scenario: null, scenarioLabel: null, note: '', decision: 'approved',
    }));
    const book = proposalDecisionsFor(events, DATE);
    expect(book.size).toBe(1);
    expect(book.get('a')?.decision).toBe('rejected');
    expect(decisionTrail(events, DATE).baseline).toHaveLength(1);
  });

  it('ignores other dates', () => {
    const events = record([], proposalDecisionEvent(input(subject('a'), { operatingDate: '2026-10-05' })));
    expect(proposalDecisionsFor(events, DATE).size).toBe(0);
    expect(proposalTrail(events, DATE, null)).toHaveLength(0);
  });

  it('an undo of the top decision restores the one beneath and marks the lines', () => {
    let events = record([], proposalDecisionEvent(input(subject('a'))));
    events = record(events, proposalDecisionEvent(input(subject('a'), { decision: 'deferred' })));
    const top = parseProposalDecisionEvent(events[0]);
    events = record(events, proposalUndoEvent(top!));
    expect(proposalDecisionsFor(events, DATE).get('a')?.decision).toBe('approved');
    const [undo, deferred, approved] = proposalTrail(events, DATE, null);
    expect(undo?.undoes).toBe(deferred?.eventId);
    expect(deferred?.undone).toBe(true);
    expect(approved?.undoable).toBe(true);
    expect(approved?.superseded).toBe(false);
    expect(describeProposalTrailItem(deferred!)).toContain('(later undone)');
    expect(proposalUndoableFor(proposalTrail(events, DATE, null), 'a')?.eventId).toBe(approved?.eventId);
  });

  it('filters the trail by route, or keeps every route with null', () => {
    let events = record([], proposalDecisionEvent(input(subject('a'))));
    events = record(events, proposalDecisionEvent(input(subject('b', 'AGRA-DELHI'))));
    expect(proposalTrail(events, DATE, 'AGRA-DELHI').map((i) => i.subject.proposalId)).toEqual(['b']);
    expect(proposalTrail(events, DATE, null)).toHaveLength(2);
  });

  it('counts accepted, declined and still open among the proposals shown', () => {
    let events = record([], proposalDecisionEvent(input(subject('a'))));
    events = record(events, proposalDecisionEvent(input(subject('b'), { decision: 'rejected' })));
    events = record(events, proposalDecisionEvent(input(subject('c'), { decision: 'deferred' })));
    events = record(events, proposalDecisionEvent(input(subject('gone'))));
    const book = proposalDecisionsFor(events, DATE);
    const shown = ['a', 'b', 'c', 'd'].map((id) => proposalOf(id));
    expect(proposalDecisionCounts(shown, book)).toEqual({ accepted: 1, declined: 1, open: 2 });
  });

  it('a click on the decision in force for the same change records nothing', () => {
    const events = record([], proposalDecisionEvent(input(subject('a'))));
    const current = proposalDecisionsFor(events, DATE).get('a') ?? null;
    expect(isRepeatProposalDecision(current, 'approved', { change: 3, count: null })).toBe(true);
    expect(isRepeatProposalDecision(current, 'approved', { change: 4, count: null })).toBe(false);
    expect(isRepeatProposalDecision(current, 'rejected', { change: 3, count: null })).toBe(false);
    expect(isRepeatProposalDecision(null, 'approved', { change: 3, count: null })).toBe(false);
  });
});

describe('proposal decision wording', () => {
  const events = record([], proposalDecisionEvent(input(subject('a'))));
  const current = proposalDecisionsFor(events, DATE).get('a') ?? null;

  it('says the decision with the change it was made for', () => {
    expect(proposalStatusText(null, { change: 3, count: null })).toBe('None yet');
    expect(proposalStatusText(current, { change: 3, count: null })).toBe('Approved for Add 3');
    expect(proposalStatusText(current, { change: 5, count: null })).toBe('Approved for Add 3; the proposal now says Add 5');
    expect(isProposalDecisionCurrent(current, 'approved', { change: 3, count: null })).toBe(true);
    expect(isProposalDecisionCurrent(current, 'approved', { change: 5, count: null })).toBe(false);
  });

  it('a trail line names its subject, a proposal or a transfer', () => {
    const [item] = proposalTrail(events, DATE, null);
    expect(describeProposalTrailItem(item!)).toBe('Approved proposal: KANPUR-LUCKNOW 07:00–11:00, Add 3');
    const transfer = record([], decisionEvent({
      transferId: 't', fromDepotId: 'x', fromDepotName: 'Agra', toDepotId: 'y', toDepotName: 'Kanpur',
      buses: 5, operatingDate: DATE, scenario: null, scenarioLabel: null, note: '', decision: 'approved',
    }));
    const [line] = decisionTrail(transfer, DATE).baseline;
    expect(describeTrailItem(line!)).toBe('Approved transfer: 5 buses, Agra → Kanpur');
  });

  it('the status lines say nothing is dispatched', () => {
    const s = subject('a', 'KANPUR-LUCKNOW', -2);
    expect(proposalDecisionAnnouncement('deferred', s)).toBe(
      'Deferred KANPUR-LUCKNOW 07:00–11:00, Hold 2. Recorded only; nothing dispatched.',
    );
    expect(proposalUndoAnnouncement('rejected', s)).toBe(
      'Undid the rejection of KANPUR-LUCKNOW 07:00–11:00, Hold 2. Recorded only; nothing dispatched.',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import {
  decisionEvent,
  parseDecisionEvent,
  type DecisionInput,
} from '@/lib/depot/rebalance/decisionEvents';
import { decisionTrail } from '@/lib/depot/rebalance/decisionReducers';
import { readDecisionTrail, serialiseSlice } from '@/lib/depot/rebalance/decisionStore';
import type { ProposalSubject } from '@/lib/depot/rebalance/decisionSubject';
import {
  parseAnyDecisionEvent,
  parseProposalDecisionEvent,
  proposalDecisionEvent,
  proposalUndoEvent,
  type ProposalDecisionInput,
} from '@/lib/depot/rebalance/proposalDecisionEvents';

const DATE = '2026-10-06';

const SUBJECT: ProposalSubject = {
  kind: 'proposal',
  proposalId: 'p-add-07',
  routeName: 'KANPUR-LUCKNOW',
  proposalKind: 'add_buses',
  band: { fromHour: 7, toHour: 10 },
  change: 3,
};

function transfer(overrides: Partial<DecisionInput> = {}): DecisionInput {
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

function proposal(overrides: Partial<ProposalDecisionInput> = {}): ProposalDecisionInput {
  return { subject: SUBJECT, operatingDate: DATE, note: 'Morning peak', decision: 'approved', ...overrides };
}

function stored(event: ReturnType<typeof decisionEvent>, id = 'e1'): AuditEvent {
  return { ...event, id, at: '2026-10-06T06:00:00.000Z' };
}

/** A transfer event as the build before subjects wrote it: no `subject` in its payload. */
function legacyTransfer(): AuditEvent {
  const event = stored(decisionEvent(transfer()));
  const payload = JSON.parse(event.detail ?? '{}') as Record<string, unknown>;
  return { ...event, detail: JSON.stringify({ ...payload, subject: undefined }) };
}

describe('decision subjects', () => {
  it('reads a stored transfer payload without a subject as a transfer', () => {
    const entry = parseDecisionEvent(legacyTransfer());
    expect(entry?.subject).toEqual({ kind: 'transfer', transferId: 'agra>kanpur' });
    expect(parseAnyDecisionEvent(legacyTransfer())?.subject.kind).toBe('transfer');
  });

  it('writes a new transfer with its subject, and reads it back', () => {
    const event = stored(decisionEvent(transfer()));
    expect(JSON.parse(event.detail ?? '{}').subject).toEqual({
      kind: 'transfer',
      transferId: 'agra>kanpur',
    });
    expect(parseDecisionEvent(event)?.transferId).toBe('agra>kanpur');
  });

  it('refuses a transfer whose subject names another transfer or a proposal', () => {
    const event = stored(decisionEvent(transfer()));
    const payload = JSON.parse(event.detail ?? '{}') as Record<string, unknown>;
    const other = { ...payload, subject: { kind: 'transfer', transferId: 'x>y' } };
    const prop = { ...payload, subject: SUBJECT };
    expect(parseDecisionEvent({ ...event, detail: JSON.stringify(other) })).toBeNull();
    expect(parseDecisionEvent({ ...event, detail: JSON.stringify(prop) })).toBeNull();
  });

  it('round-trips a proposal decision, which is never read as a transfer', () => {
    const event = stored(proposalDecisionEvent(proposal()));
    expect(event.type).toBe('depot-proposal-approved');
    const entry = parseProposalDecisionEvent(event);
    expect(entry).toMatchObject({ subject: SUBJECT, decision: 'approved', note: 'Morning peak' });
    expect(entry?.undoes).toBeNull();
    expect(parseDecisionEvent(event)).toBeNull();
    expect(parseAnyDecisionEvent(event)?.subject.kind).toBe('proposal');
  });

  it('records an undo of a proposal as a further event naming the one it withdraws', () => {
    const first = parseProposalDecisionEvent(stored(proposalDecisionEvent(proposal())));
    const undo = stored(proposalUndoEvent(first!), 'e2');
    expect(undo.type).toBe('depot-proposal-approved');
    expect(undo.summary).toMatch(/^Undid approved proposal/);
    expect(parseProposalDecisionEvent(undo)?.undoes).toBe('e1');
  });

  it('refuses a proposal event without a subject or with a damaged one', () => {
    const event = stored(proposalDecisionEvent(proposal()));
    const payload = JSON.parse(event.detail ?? '{}') as Record<string, unknown>;
    const damaged = [
      { ...payload, subject: undefined },
      { ...payload, subject: { ...SUBJECT, band: { fromHour: 9, toHour: 7 } } },
      { ...payload, subject: { ...SUBJECT, band: { fromHour: 7, toHour: 24 } } },
      { ...payload, subject: { ...SUBJECT, change: 1.5 } },
      { ...payload, subject: { ...SUBJECT, proposalKind: 'teleport' } },
      { ...payload, subject: { ...SUBJECT, routeName: 'not a route!' } },
      { ...payload, subject: { ...SUBJECT, kind: 'transfer' } },
    ];
    for (const p of damaged) {
      expect(parseProposalDecisionEvent({ ...event, detail: JSON.stringify(p) })).toBeNull();
    }
  });

  it('a proposal summary names the route, the band and the change', () => {
    expect(proposalDecisionEvent(proposal()).summary).toBe(
      'Approved proposal KANPUR-LUCKNOW 07:00–11:00, Add 3 (modelled)',
    );
  });
});

describe('one trail for both subjects', () => {
  const events = [
    appendAuditEvent([], decisionEvent(transfer())),
    appendAuditEvent([], proposalDecisionEvent(proposal())),
  ].flat();

  it('keeps proposal decisions in the stored slice beside transfers', () => {
    const read = readDecisionTrail(serialiseSlice({ events, dropped: 0 }));
    expect(read.skipped).toBe(0);
    expect(read.slice.events).toHaveLength(2);
  });

  it('lists transfers only in the transfer trail', () => {
    const trail = decisionTrail(events, DATE);
    expect(trail.baseline).toHaveLength(1);
    expect(trail.baseline[0]?.subject.kind).toBe('transfer');
  });
});

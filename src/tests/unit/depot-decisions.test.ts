import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import {
  NOTE_MAX_CHARS,
  decisionEvent,
  parseDecisionEvent,
  undoEvent,
  validateNote,
  type DecisionInput,
} from '@/lib/depot/rebalance/decisionEvents';
import {
  decisionTrail,
  decisionsFor,
  rowDecisionsFor,
} from '@/lib/depot/rebalance/decisionReducers';

const DATE = '2026-10-06';

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    transferId: 'agra>kanpur',
    fromDepotId: 'agra',
    fromDepotName: 'AGRA',
    toDepotId: 'kanpur',
    toDepotName: 'KANPUR',
    buses: 8,
    operatingDate: DATE,
    scenario: null,
    scenarioLabel: null,
    note: '',
    decision: 'approved',
    ...overrides,
  };
}

let tick = 0;
/** Appends as the page does (newest first), with strictly increasing times. */
function record(events: AuditEvent[], event: ReturnType<typeof decisionEvent>): AuditEvent[] {
  tick += 1;
  return appendAuditEvent(events, {
    ...event,
    at: new Date(Date.UTC(2026, 9, 6, 6, tick)).toISOString(),
  });
}

describe('decisionEvent', () => {
  it('is a model-derived audit event of the matching type carrying the whole decision', () => {
    const event = decisionEvent(input({ decision: 'rejected', note: 'Kanpur yard full' }));
    expect(event.type).toBe('depot-transfer-rejected');
    expect(event.simulated).toBe(true);
    expect(event.summary).toContain('AGRA');
    const parsed = parseDecisionEvent({ ...event, id: 'e1', at: '2026-10-06T06:00:00.000Z' });
    expect(parsed).toMatchObject({
      ...input({ decision: 'rejected', note: 'Kanpur yard full' }),
      eventId: 'e1',
    });
    expect(parsed?.undoes).toBeNull();
  });
});

describe('decisionsFor', () => {
  it('keeps the latest decision per transfer for the operating date', () => {
    let events: AuditEvent[] = [];
    events = record(events, decisionEvent(input({ decision: 'deferred' })));
    events = record(events, decisionEvent(input({ decision: 'approved' })));
    events = record(
      events,
      decisionEvent(input({ operatingDate: '2026-10-05', decision: 'rejected' })),
    );
    const book = decisionsFor(events, DATE);
    expect(rowDecisionsFor(book, null).get('agra>kanpur')?.kind).toBe('approved');
    expect(rowDecisionsFor(decisionsFor(events, '2026-10-05'), null).get('agra>kanpur')?.kind).toBe(
      'rejected',
    );
  });

  it('keeps scenario decisions apart from baseline decisions', () => {
    let events: AuditEvent[] = [];
    events = record(events, decisionEvent(input({ decision: 'approved' })));
    events = record(
      events,
      decisionEvent(input({ decision: 'rejected', scenario: 'Spare ratio 10%.' })),
    );
    const book = decisionsFor(events, DATE);
    expect(rowDecisionsFor(book, null).get('agra>kanpur')?.kind).toBe('approved');
    expect(rowDecisionsFor(book, 'Spare ratio 10%.').get('agra>kanpur')?.kind).toBe('rejected');
    expect(rowDecisionsFor(book, 'Spare ratio 20%.').size).toBe(0);
    const trail = decisionTrail(events, DATE);
    expect(trail.baseline.map((e) => e.decision)).toEqual(['approved']);
    expect(trail.scenario.map((e) => e.decision)).toEqual(['rejected']);
  });

  it('undoes by recording a further event, never by deleting one', () => {
    let events: AuditEvent[] = [];
    events = record(events, decisionEvent(input({ decision: 'deferred' })));
    events = record(events, decisionEvent(input({ decision: 'approved', note: 'ok' })));
    const current = decisionTrail(events, DATE).baseline[0];
    expect(current?.undoable).toBe(true);
    events = record(events, undoEvent(current!));
    expect(events).toHaveLength(3);
    // Undoing the latest decision restores the one it replaced.
    expect(rowDecisionsFor(decisionsFor(events, DATE), null).get('agra>kanpur')?.kind).toBe(
      'deferred',
    );
    const trail = decisionTrail(events, DATE).baseline;
    expect(trail).toHaveLength(3);
    expect(trail[0]?.undoes).toBe(current?.eventId);
    expect(trail[1]?.undone).toBe(true);
    expect(trail.map((e) => e.undoable)).toEqual([false, false, true]);
    events = record(events, undoEvent(trail[2]!));
    expect(rowDecisionsFor(decisionsFor(events, DATE), null).has('agra>kanpur')).toBe(false);
  });

  it('ignores an undo that does not refer to the current decision', () => {
    let events: AuditEvent[] = [];
    events = record(events, decisionEvent(input({ decision: 'deferred' })));
    const old = decisionTrail(events, DATE).baseline[0]!;
    events = record(events, decisionEvent(input({ decision: 'approved' })));
    events = record(events, undoEvent(old));
    expect(rowDecisionsFor(decisionsFor(events, DATE), null).get('agra>kanpur')?.kind).toBe(
      'approved',
    );
  });

  it('ignores malformed stored events and other event types without throwing', () => {
    const good = record([], decisionEvent(input()));
    const junk = [
      { id: 'x1', type: 'depot-transfer-approved', at: 'now', summary: 's', simulated: true },
      {
        id: 'x2',
        type: 'depot-transfer-approved',
        at: 'now',
        summary: 's',
        simulated: true,
        detail: '{',
      },
      {
        id: 'x3',
        type: 'depot-transfer-deferred',
        at: 'now',
        summary: 's',
        simulated: true,
        detail: '{"v":1,"buses":"many"}',
      },
      {
        id: 'x4',
        type: 'bus-selected',
        at: 'now',
        summary: 's',
        simulated: false,
        detail: good[0]?.detail,
      },
      null,
      42,
    ] as unknown as AuditEvent[];
    const events = [...junk, ...good];
    expect(() => decisionsFor(events, DATE)).not.toThrow();
    expect(decisionTrail(events, DATE).baseline).toHaveLength(1);
    expect(parseDecisionEvent(null)).toBeNull();
  });

  it('does not mutate the events it reads', () => {
    const events = record(
      record([], decisionEvent(input())),
      decisionEvent(input({ decision: 'rejected' })),
    );
    const copy = structuredClone(events);
    decisionsFor(events, DATE);
    decisionTrail(events, DATE);
    expect(events).toEqual(copy);
  });
});

describe('validateNote', () => {
  it('trims and accepts up to the limit, and refuses longer notes with a sentence', () => {
    expect(validateNote('  yard full  ')).toEqual({ ok: true, value: 'yard full' });
    expect(validateNote('x'.repeat(NOTE_MAX_CHARS))).toMatchObject({ ok: true });
    const long = validateNote('x'.repeat(NOTE_MAX_CHARS + 1));
    expect(long.ok).toBe(false);
  });
});

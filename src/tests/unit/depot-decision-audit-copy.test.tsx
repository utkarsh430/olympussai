// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_STORAGE_KEY } from '@/lib/audit/auditLog';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import {
  decisionEvent,
  parseDecisionEvent,
  withoutNote,
  type DecisionInput,
} from '@/lib/depot/rebalance/decisionEvents';
import { TRAIL_CLEAR_CONFIRM, TRAIL_NOTE } from '@/lib/depot/rebalance/decisionWording';

/*
 * The trail says that clearing it removes every decision kept in this browser, notes
 * included. A decision is also copied to the shared audit log, which the trail's control
 * does not clear, so that copy must never hold the planner's note.
 */

const NOTE = 'Hold until the Kanpur workshop reports';

const input: DecisionInput = {
  transferId: 'a→b',
  fromDepotId: '101',
  fromDepotName: 'Alpha',
  toDepotId: '102',
  toDepotName: 'Beta',
  buses: 3,
  operatingDate: '2026-10-06',
  scenario: null,
  scenarioLabel: null,
  note: NOTE,
  decision: 'approved',
};

describe('the audit log copy of a transfer decision', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is the same decision with an empty note', () => {
    const event = { ...decisionEvent(input), id: 'e1', at: '2026-10-06T08:00:00.000Z' };
    const copy = withoutNote(event);
    expect(parseDecisionEvent(copy)).toEqual({ ...parseDecisionEvent(event), note: '' });
    expect(JSON.stringify(copy)).not.toContain(NOTE);
  });

  it('leaves an event it cannot read as it is', () => {
    const event = { id: 'e2', detail: 'not json' };
    expect(withoutNote(event)).toBe(event);
  });

  it('keeps the note in the trail and out of the shared audit log', () => {
    const { result } = renderHook(() => useDecisionLog());
    act(() => {
      expect(result.current.record(decisionEvent(input))).toBe('recorded');
    });
    const audit = window.localStorage.getItem(AUDIT_STORAGE_KEY) ?? '';
    expect(audit).toContain('depot-transfer-approved');
    expect(audit).not.toContain(NOTE);
    expect(JSON.stringify(result.current.slice)).toContain(NOTE);
  });

  it('leaves no note anywhere in this browser after the trail is cleared', () => {
    const { result } = renderHook(() => useDecisionLog());
    act(() => {
      result.current.record(decisionEvent(input));
    });
    act(() => {
      expect(result.current.clear()).toBe(true);
    });
    const everything = Object.keys(window.localStorage)
      .map((key) => window.localStorage.getItem(key) ?? '')
      .join('\n');
    expect(everything).not.toContain(NOTE);
  });

  it('says what the audit log keeps', () => {
    expect(TRAIL_CLEAR_CONFIRM).toContain('notes included');
    expect(TRAIL_NOTE).toContain('audit log in this browser keeps one line for each decision, without its note');
  });
});

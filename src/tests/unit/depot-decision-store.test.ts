import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import { decisionEvent, type DecisionInput } from '@/lib/depot/rebalance/decisionEvents';
import {
  EMPTY_SLICE,
  MAX_STORED_DECISIONS,
  appendToSlice,
  parseDecisionSlice,
  readStoredSlice,
  serialiseSlice,
  trailCapacityNote,
  writeStoredSlice,
  type StorageLike,
} from '@/lib/depot/rebalance/decisionStore';

const INPUT: DecisionInput = {
  transferId: 'agra>kanpur',
  fromDepotId: 'agra',
  fromDepotName: 'Agra',
  toDepotId: 'kanpur',
  toDepotName: 'Kanpur',
  buses: 5,
  operatingDate: '2026-10-06',
  scenario: null,
  scenarioLabel: null,
  note: '',
  decision: 'approved',
};

function stored(): AuditEvent {
  const [event] = appendAuditEvent([], decisionEvent(INPUT));
  if (!event) throw new Error('no event');
  return event;
}

function memoryStorage(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('decision slice', () => {
  it('keeps decisions newest first and round-trips through storage', () => {
    const a = stored();
    const b = stored();
    const slice = appendToSlice(appendToSlice(EMPTY_SLICE, a), b);
    expect(slice.events.map((e) => e.id)).toEqual([b.id, a.id]);
    const storage = memoryStorage();
    expect(writeStoredSlice(storage, slice)).toBe(true);
    expect(parseDecisionSlice(readStoredSlice(storage))).toEqual(slice);
    expect(trailCapacityNote(slice)).toBeNull();
  });

  it('drops the oldest past its cap, counts them, and says so', () => {
    let slice = EMPTY_SLICE;
    const events = [stored(), stored(), stored(), stored()];
    for (const e of events) slice = appendToSlice(slice, e, 3);
    expect(slice.events.map((e) => e.id)).toEqual(
      [events[3], events[2], events[1]].map((e) => e?.id),
    );
    expect(slice.dropped).toBe(1);
    expect(trailCapacityNote(slice)).toBe(
      'The decision record holds 3 entries across all dates; older ones are no longer listed.',
    );
    expect(MAX_STORED_DECISIONS).toBeGreaterThanOrEqual(250);
  });

  it('parses at most the cap, keeping the newest, from an oversized store', () => {
    const newest = stored();
    const rest = Array.from({ length: MAX_STORED_DECISIONS + 50 }, () => stored());
    const raw = JSON.stringify({ v: 1, dropped: 0, events: [newest, ...rest] });
    const slice = parseDecisionSlice(raw);
    expect(slice.events).toHaveLength(MAX_STORED_DECISIONS);
    expect(slice.events[0]?.id).toBe(newest.id);
  });

  it('reads malformed or foreign data as an empty slice and skips bad entries', () => {
    for (const raw of [null, '', 'not json', '[]', '{"events":"x"}', '{"v":9,"events":[]}']) {
      expect(parseDecisionSlice(raw)).toEqual(EMPTY_SLICE);
    }
    const good = stored();
    const raw = JSON.stringify({ v: 1, dropped: -4, events: [good, { id: 3 }, null, 'x'] });
    expect(parseDecisionSlice(raw)).toEqual({ events: [good], dropped: 0 });
    expect(parseDecisionSlice(serialiseSlice({ events: [good], dropped: 2 })).dropped).toBe(2);
  });

  it('survives storage that is missing or throws', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readStoredSlice(null)).toBeNull();
    expect(readStoredSlice(throwing)).toBeNull();
    expect(writeStoredSlice(throwing, EMPTY_SLICE)).toBe(false);
    expect(writeStoredSlice(null, EMPTY_SLICE)).toBe(false);
  });
});

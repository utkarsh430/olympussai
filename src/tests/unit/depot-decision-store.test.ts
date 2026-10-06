import { describe, expect, it } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import { decisionEvent, type DecisionInput } from '@/lib/depot/rebalance/decisionEvents';
import {
  DECISION_STORAGE_KEY,
  EMPTY_SLICE,
  MAX_STORED_DECISIONS,
  UNREADABLE_TRAIL_KEY,
  clearStoredTrail,
  readDecisionTrail,
  setAsideUnreadable,
  trailStateNote,
  appendToSlice,
  parseDecisionSlice,
  readStoredSlice,
  serialiseSlice,
  trailCapacityNote,
  writeStoredSlice,
  type ClearableStorage,
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

function memoryStorage(): ClearableStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
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

describe('a damaged stored trail', () => {
  it('is reported as unreadable, not as an empty trail', () => {
    for (const raw of ['not json', '[]', '{"events":"x"}', '{"v":9,"events":[]}']) {
      expect(readDecisionTrail(raw)).toEqual({ slice: EMPTY_SLICE, unreadable: true, skipped: 0 });
    }
    for (const raw of [null, '']) {
      expect(readDecisionTrail(raw)).toEqual({ slice: EMPTY_SLICE, unreadable: false, skipped: 0 });
    }
  });

  it('counts the entries that fail their checks', () => {
    const good = stored();
    const raw = JSON.stringify({ v: 1, dropped: 0, events: [good, { id: 3 }, null] });
    expect(readDecisionTrail(raw)).toEqual({
      slice: { events: [good], dropped: 0 },
      unreadable: false,
      skipped: 2,
    });
  });

  it('is kept aside, unchanged, under its own key; false when storage refuses', () => {
    const storage = memoryStorage();
    expect(setAsideUnreadable(storage, 'not json')).toBe(true);
    expect(storage.data.get(UNREADABLE_TRAIL_KEY)).toBe('not json');
    const refusing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(setAsideUnreadable(refusing, 'not json')).toBe(false);
    expect(setAsideUnreadable(null, 'not json')).toBe(false);
  });

  it('says in fixed words what is not listed and why', () => {
    const plain = { slice: EMPTY_SLICE, unreadable: false, skipped: 0 };
    expect(trailStateNote(plain, false)).toBeNull();
    expect(trailStateNote({ ...plain, unreadable: true }, false)).toBe(
      'The decision trail stored in this browser could not be read, so none is listed. It is not written over: the next decision keeps it aside, unchanged, and starts a new trail.',
    );
    expect(trailStateNote(plain, true)).toBe(
      'An earlier decision trail in this browser could not be read; it is kept aside, unchanged, and is not listed.',
    );
    expect(trailStateNote({ ...plain, skipped: 1 }, false)).toBe(
      '1 stored entry could not be read and is not listed.',
    );
    expect(trailStateNote({ ...plain, skipped: 3 }, true)).toBe(
      'An earlier decision trail in this browser could not be read; it is kept aside, unchanged, and is not listed. 3 stored entries could not be read and are not listed.',
    );
  });
});

describe('clearing the trail', () => {
  it('removes the trail and any trail kept aside; false when storage refuses', () => {
    const storage = memoryStorage();
    storage.data.set(DECISION_STORAGE_KEY, serialiseSlice(appendToSlice(EMPTY_SLICE, stored())));
    storage.data.set(UNREADABLE_TRAIL_KEY, 'not json');
    storage.data.set('olympuss-other', 'kept');
    expect(clearStoredTrail(storage)).toBe(true);
    expect([...storage.data.keys()]).toEqual(['olympuss-other']);
    const refusing: ClearableStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(clearStoredTrail(refusing)).toBe(false);
    expect(clearStoredTrail(null)).toBe(false);
  });
});

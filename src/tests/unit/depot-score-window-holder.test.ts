import { describe, expect, it } from 'vitest';
import {
  SCORE_WINDOW_MIN,
  countsOf,
  valuesOfCounts,
  windowedValues,
} from '@/lib/depot/score/window';
import {
  SCORE_WINDOW_MAX_DEPOTS,
  createScoreWindowStore,
  observeDepots,
  type ScoreWindowStore,
} from '@/lib/depot/score/windowStore';
import type { DepotSummary } from '@/lib/depot/types';
import { T0, feedTime, network, seeded, snapshotOf } from './depot-score-window.fixtures';

/*
 * The window's content depends only on WHICH snapshots arrived,
 * never on the order they arrived in; a fixture never touches it; a repeated
 * feed time with new rows replaces the stored sample. Stragglers and epochs
 * are pinned in depot-score-window-epoch.test.ts.
 */

const WINDOW_S = SCORE_WINDOW_MIN * 60;
const net = network(12, 7);

/** Snapshots at the given feed seconds, each drawn from its own seed so arrival order cannot change them. */
function snapshotsAt(seconds: readonly number[]): Map<number, DepotSummary[]> {
  return new Map(seconds.map((s) => [s, snapshotOf(net, seeded(1000 + s))]));
}

function feed(
  store: ScoreWindowStore,
  snaps: Map<number, DepotSummary[]>,
  order: readonly number[],
) {
  return order.map((s) => observeDepots(store, snaps.get(s) ?? [], feedTime(s)));
}

const contentOf = (store: ScoreWindowStore): string =>
  JSON.stringify([...store.byDepot].sort(([a], [b]) => (a < b ? -1 : 1)));

describe('score window holder: arrival order', () => {
  it('inserts a late sample inside the window and scores it only on samples up to its own time', () => {
    const snaps = snapshotsAt([0, 40, 100, 60]);
    const store = createScoreWindowStore();
    feed(store, snaps, [0, 40, 100]);
    const late = observeDepots(store, snaps.get(60) ?? [], feedTime(60));
    expect(store.lastFeedMs).toBe(T0 + 100_000);
    const held = store.byDepot.get('1') ?? [];
    expect(held.map((s) => s.feedMs - T0)).toEqual([0, 40_000, 60_000, 100_000]);
    expect(late.windows.get('1')).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: feedTime(0),
      samples: 3,
      coveredMin: 1,
    });
    expect(late.values.get('1')).toEqual(windowedValues(held.slice(0, 3)));
  });

  it('holds the same window, and scores the same, whatever order the snapshots arrive in', () => {
    const times = Array.from({ length: 40 }, (_, i) => i * 15);
    const snaps = snapshotsAt([...times, 615]);
    // Each pair swapped, and every fifth snapshot held back by a minute.
    const shuffled = times.map((_, i) => times[i % 2 === 0 ? i + 1 : i - 1] ?? 0);
    const late = shuffled.filter((_, i) => i % 5 === 0);
    const reordered = [...shuffled.filter((_, i) => i % 5 !== 0), ...late];
    const inOrder = createScoreWindowStore();
    const outOfOrder = createScoreWindowStore();
    feed(inOrder, snaps, times);
    feed(outOfOrder, snaps, reordered);
    expect(contentOf(outOfOrder)).toBe(contentOf(inOrder));
    const [a] = feed(inOrder, snaps, [615]);
    const [b] = feed(outOfOrder, snaps, [615]);
    expect([...(b?.values ?? [])]).toEqual([...(a?.values ?? [])]);
    expect([...(b?.windows ?? [])]).toEqual([...(a?.windows ?? [])]);
  });

  it('a fresh store equals one that also saw samples since aged out', () => {
    const times = Array.from({ length: 120 }, (_, i) => i * 15);
    const snaps = snapshotsAt(times);
    const last = times[times.length - 1] ?? 0;
    const longRun = createScoreWindowStore();
    const fresh = createScoreWindowStore();
    const longOut = feed(longRun, snaps, times);
    const freshOut = feed(
      fresh,
      snaps,
      times.filter((s) => last - s <= WINDOW_S),
    );
    expect(contentOf(fresh)).toBe(contentOf(longRun));
    expect([...(freshOut.at(-1)?.values ?? [])]).toEqual([...(longOut.at(-1)?.values ?? [])]);
  });
});

describe('score window holder: epochs, fixtures and repeats', () => {
  it('never lets a fixture snapshot touch the store, first or later', () => {
    const snaps = snapshotsAt([0, 40]);
    const empty = createScoreWindowStore();
    const first = observeDepots(empty, snaps.get(0) ?? [], feedTime(0), { fixture: true });
    expect(empty.byDepot.size).toBe(0);
    expect(empty.lastFeedMs).toBeNull();
    expect(first.window).toMatchObject({ samples: 1, coveredMin: 0 });

    const store = createScoreWindowStore();
    feed(store, snaps, [0]);
    const before = contentOf(store);
    const fixture = observeDepots(store, snaps.get(40) ?? [], feedTime(40), { fixture: true });
    expect(contentOf(store)).toBe(before);
    const own = snaps.get(40)?.[0] as DepotSummary;
    expect(fixture.values.get('1')).toEqual(valuesOfCounts(countsOf(own)));
    expect(fixture.window.samples).toBe(1);
  });

  it('replaces the stored sample when a feed time repeats with different rows', () => {
    const snaps = snapshotsAt([0, 40]);
    const store = createScoreWindowStore();
    feed(store, snaps, [0, 40]);
    const other = snapshotOf(net, seeded(99));
    const repeated = observeDepots(store, other, feedTime(40));
    const held = store.byDepot.get('1') ?? [];
    expect(held).toHaveLength(2);
    expect(held[1]?.counts.dark).toBe(other[0]?.states.dark);
    expect(repeated.values.get('1')).toEqual(windowedValues(held));
  });

  it('leaves the store alone for a snapshot with no feed time', () => {
    const store = createScoreWindowStore();
    feed(store, snapshotsAt([0]), [0]);
    const before = contentOf(store);
    const clockless = observeDepots(store, snapshotOf(net, seeded(5)), null);
    expect(clockless.window).toMatchObject({ since: null, samples: 1, coveredMin: 0 });
    expect(contentOf(store)).toBe(before);
  });
});

describe('score window holder: what it states and its bounds', () => {
  it('states the minutes actually covered beside the configured length', () => {
    const snaps = snapshotsAt([0, 300, 630]);
    const store = createScoreWindowStore();
    const [one, , three] = feed(store, snaps, [0, 300, 630]);
    expect(one?.window).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: feedTime(0),
      samples: 1,
      coveredMin: 0,
    });
    expect(three?.window).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: feedTime(0),
      samples: 3,
      coveredMin: 10,
    });
  });

  it('caps the number of depots, dropping the least recently seen', () => {
    const store = createScoreWindowStore();
    const base = snapshotOf(net, seeded(1))[0] as DepotSummary;
    const batch = 400;
    const rounds = Math.ceil(SCORE_WINDOW_MAX_DEPOTS / batch) + 2;
    for (let r = 0; r < rounds; r += 1) {
      const depots = Array.from({ length: batch }, (_, i) => ({ ...base, id: `G${r}-${i}` }));
      observeDepots(store, depots, feedTime(r));
    }
    expect(store.byDepot.size).toBe(SCORE_WINDOW_MAX_DEPOTS);
    expect(store.byDepot.has(`G${rounds - 1}-0`)).toBe(true);
    expect(store.byDepot.has('G0-0')).toBe(false);
  });
});

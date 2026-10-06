import { describe, expect, it, vi } from 'vitest';
import { scoreDepots } from '@/lib/depot/score/dei';
import {
  SCORE_WINDOW_MAX_SAMPLES,
  SCORE_WINDOW_MIN,
  insertSample,
  pruneSamples,
  windowOf,
  windowedValues,
  type DepotSample,
} from '@/lib/depot/score/window';
import { createScoreWindowStore, observeDepots } from '@/lib/depot/score/windowStore';
import {
  T0,
  feedTime,
  movementOf,
  network,
  seeded,
  snapshotOf,
} from './depot-score-window.fixtures';

const sample = (seconds: number, onRoad: number, fleet = 100): DepotSample => ({
  feedNow: feedTime(seconds),
  feedMs: T0 + seconds * 1000,
  counts: { fleet, onRoad, offRoad: 0, dark: 10, assigned: 50, deviceFaults: 0 },
});

describe('score window, pure', () => {
  it('is a ratio of sums, not a mean of ratios', () => {
    const values = windowedValues([sample(0, 10, 100), sample(40, 30, 300)]);
    expect(values.onRoad).toBeCloseTo(40 / 400, 12);
    expect(windowOf([sample(0, 1), sample(40, 1)])).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: feedTime(0),
      samples: 2,
      coveredMin: 0,
    });
  });

  it('inserts in feed-time order and replaces a repeated feed time', () => {
    const held = insertSample(insertSample([], sample(0, 10)), sample(40, 20));
    expect(insertSample(held, sample(40, 99)).map((s) => s.counts.onRoad)).toEqual([10, 99]);
    expect(insertSample(held, sample(20, 30)).map((s) => s.counts.onRoad)).toEqual([10, 30, 20]);
    expect(held.map((s) => s.counts.onRoad)).toEqual([10, 20]);
    // Pruned at the newest feed time held, not at the inserted one.
    const edge = SCORE_WINDOW_MIN * 60;
    expect(insertSample([sample(edge + 5, 1)], sample(2, 2)).map((s) => s.counts.onRoad)).toEqual([
      1,
    ]);
  });

  it('prunes by the feed time passed in, at exactly the window length', () => {
    const edge = SCORE_WINDOW_MIN * 60;
    const held = [sample(0, 1), sample(1, 2), sample(edge, 3)];
    expect(pruneSamples(held, T0 + edge * 1000)).toHaveLength(3);
    expect(pruneSamples(held, T0 + (edge + 1) * 1000).map((s) => s.counts.onRoad)).toEqual([2, 3]);
    // A later sample appended drops what has aged out, whatever the wall clock says.
    expect(insertSample(held, sample(edge + 2, 4)).map((s) => s.counts.onRoad)).toEqual([3, 4]);
  });

  it('never holds more than the sample bound', () => {
    let held: readonly DepotSample[] = [];
    for (let i = 0; i < SCORE_WINDOW_MAX_SAMPLES + 50; i += 1) {
      held = insertSample(held, sample(i, i));
    }
    expect(held).toHaveLength(SCORE_WINDOW_MAX_SAMPLES);
    expect(held[held.length - 1]?.counts.onRoad).toBe(SCORE_WINDOW_MAX_SAMPLES + 49);
  });
});

describe('score window, holder', () => {
  const net = network(30, 7);

  it('scores a fresh process on the one snapshot it has', () => {
    const depots = snapshotOf(net, seeded(1));
    const windowed = observeDepots(createScoreWindowStore(), depots, feedTime(0));
    expect(scoreDepots(depots, windowed.values)).toEqual(scoreDepots(depots));
    expect(windowed.window).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: feedTime(0),
      samples: 1,
      coveredMin: 0,
    });
  });

  it('replaces a repeated feed time, keeps a late one, and ignores a clockless one', () => {
    const store = createScoreWindowStore();
    const random = seeded(2);
    observeDepots(store, snapshotOf(net, random), feedTime(0));
    observeDepots(store, snapshotOf(net, random), feedTime(40));
    const other = snapshotOf(net, random);

    // A re-fetch with new rows at the same feed time replaces that sample.
    const repeated = observeDepots(store, other, feedTime(40));
    expect(repeated.window.samples).toBe(2);
    expect(scoreDepots(other, repeated.values)).not.toEqual(scoreDepots(other));
    // A late snapshot inside the window is inserted in feed-time order, not dropped, and
    // scored on the samples up to its own feed time.
    const older = observeDepots(store, other, feedTime(10));
    expect(older.window).toMatchObject({ since: feedTime(0), samples: 2 });
    expect(store.byDepot.get('1')).toHaveLength(3);
    const before = JSON.stringify([...store.byDepot]);
    expect(observeDepots(store, other, null).window.since).toBeNull();
    expect(JSON.stringify([...store.byDepot])).toBe(before);
    expect(store.lastFeedMs).toBe(T0 + 40_000);
  });

  it('stays bounded on an irregular cadence with repeats and steps back', () => {
    const store = createScoreWindowStore();
    const random = seeded(11);
    for (let i = 0; i < 200; i += 1) {
      const at = i * 15 + (i % 7 === 0 ? -30 : 0);
      const depots = snapshotOf(net, random).slice(0, i % 9 === 0 ? 20 : 30);
      observeDepots(store, depots, feedTime(at));
      for (const samples of store.byDepot.values()) {
        expect(samples.length).toBeLessThanOrEqual(SCORE_WINDOW_MAX_SAMPLES);
        const first = samples[0] as DepotSample;
        expect((store.lastFeedMs as number) - first.feedMs).toBeLessThanOrEqual(
          SCORE_WINDOW_MIN * 60_000,
        );
      }
    }
  });

  it('gives the same window whatever the wall clock says', () => {
    const run = (wall: string): string => {
      vi.useFakeTimers({ now: new Date(wall) });
      try {
        const store = createScoreWindowStore();
        const random = seeded(5);
        // Three snapshots over 25 minutes of feed time: the first must age out, by the feed.
        for (const seconds of [0, 600, 1500]) {
          observeDepots(store, snapshotOf(net, random), feedTime(seconds));
        }
        return JSON.stringify([...store.byDepot]);
      } finally {
        vi.useRealTimers();
      }
    };
    const duringTheFeed = run(feedTime(600));
    expect(duringTheFeed).toBe(run('2031-01-01T00:00:00.000Z'));
    expect(duringTheFeed).toBe(run('2001-01-01T00:00:00.000Z'));
    expect(JSON.parse(duringTheFeed)[0][1]).toHaveLength(2);
  });

  it('forgets a depot that has left the feed once its samples age out', () => {
    const store = createScoreWindowStore();
    const depots = snapshotOf(net, seeded(3));
    observeDepots(store, depots, feedTime(0));
    observeDepots(store, depots.slice(1), feedTime(SCORE_WINDOW_MIN * 60 + 1));
    expect(store.byDepot.has(depots[0]!.id)).toBe(false);
    expect(store.byDepot.size).toBe(depots.length - 1);
  });
});

describe('score window, acceptance on a seeded sequence', () => {
  it('moves the index a fraction as far as single snapshots do', () => {
    const big = network(118, 42);
    const random = seeded(4242);
    const store = createScoreWindowStore();
    const single: ReturnType<typeof scoreDepots>[] = [];
    const windowed: ReturnType<typeof scoreDepots>[] = [];
    // 37 snapshots 40 s apart; the last seven (240 s, as recorded live) are compared.
    for (let i = 0; i < 37; i += 1) {
      const depots = snapshotOf(big, random);
      single.push(scoreDepots(depots));
      windowed.push(scoreDepots(depots, observeDepots(store, depots, feedTime(i * 40)).values));
    }
    const before = movementOf(single.slice(-7));
    const after = movementOf(windowed.slice(-7));
    expect(after.indexMedian).toBeLessThan(before.indexMedian / 3);
    expect(after.indexMax).toBeLessThan(before.indexMax / 2);
    expect(after.rankMedian).toBeLessThan(before.rankMedian);
    expect({ before, after }).toMatchInlineSnapshot(`
      {
        "after": {
          "indexMax": 5.5,
          "indexMedian": 1.4,
          "rankMax": 10,
          "rankMedian": 2,
        },
        "before": {
          "indexMax": 32.6,
          "indexMedian": 11.1,
          "rankMax": 38,
          "rankMedian": 17,
        },
      }
    `);
  });
});

import { describe, expect, it } from 'vitest';
import { scoreDepots } from '@/lib/depot/score/dei';
import {
  SCORE_WINDOW_MAX_SAMPLES,
  SCORE_WINDOW_MIN,
  appendSample,
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
    });
  });

  it('adds nothing for a repeated or an older feed time', () => {
    const held = appendSample(appendSample([], sample(0, 10)), sample(40, 20));
    expect(appendSample(held, sample(40, 99))).toBe(held);
    expect(appendSample(held, sample(20, 99))).toBe(held);
    expect(held.map((s) => s.counts.onRoad)).toEqual([10, 20]);
  });

  it('prunes by the feed time passed in, at exactly the window length', () => {
    const edge = SCORE_WINDOW_MIN * 60;
    const held = [sample(0, 1), sample(1, 2), sample(edge, 3)];
    expect(pruneSamples(held, T0 + edge * 1000)).toHaveLength(3);
    expect(pruneSamples(held, T0 + (edge + 1) * 1000).map((s) => s.counts.onRoad)).toEqual([2, 3]);
    // A later sample appended drops what has aged out, whatever the wall clock says.
    expect(appendSample(held, sample(edge + 2, 4)).map((s) => s.counts.onRoad)).toEqual([3, 4]);
  });

  it('never holds more than the sample bound', () => {
    let held: readonly DepotSample[] = [];
    for (let i = 0; i < SCORE_WINDOW_MAX_SAMPLES + 50; i += 1) {
      held = appendSample(held, sample(i, i));
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
    });
  });

  it('is unchanged by a repeated, an older or a clockless snapshot', () => {
    const store = createScoreWindowStore();
    const random = seeded(2);
    observeDepots(store, snapshotOf(net, random), feedTime(0));
    const second = observeDepots(store, snapshotOf(net, random), feedTime(40));
    const before = JSON.stringify([...store.byDepot]);
    const other = snapshotOf(net, random);

    const repeated = observeDepots(store, other, feedTime(40));
    expect([...repeated.values]).toEqual([...second.values]);
    const older = observeDepots(store, other, feedTime(10));
    expect(older.window).toEqual({ lengthMin: SCORE_WINDOW_MIN, since: feedTime(10), samples: 1 });
    expect(scoreDepots(other, older.values)).toEqual(scoreDepots(other));
    expect(observeDepots(store, other, null).window.since).toBeNull();
    expect(JSON.stringify([...store.byDepot])).toBe(before);
    expect(store.lastFeedMs).toBe(T0 + 40_000);
  });

  it('gives the same results for the same sequence, and stays bounded', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const run = (): string => {
        const store = createScoreWindowStore();
        const random = seeded(seed);
        const out: unknown[] = [];
        for (let i = 0; i < 200; i += 1) {
          // Irregular cadence, with repeats and steps back mixed in.
          const at = i * 15 + (i % 7 === 0 ? -30 : 0);
          const depots = snapshotOf(net, random).slice(0, i % 9 === 0 ? 20 : 30);
          out.push(scoreDepots(depots, observeDepots(store, depots, feedTime(at)).values));
          for (const samples of store.byDepot.values()) {
            expect(samples.length).toBeLessThanOrEqual(SCORE_WINDOW_MAX_SAMPLES);
            const first = samples[0] as DepotSample;
            expect((store.lastFeedMs as number) - first.feedMs).toBeLessThanOrEqual(
              SCORE_WINDOW_MIN * 60_000,
            );
          }
        }
        return JSON.stringify(out);
      };
      expect(run()).toBe(run());
    }
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

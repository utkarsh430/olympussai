import { describe, expect, it } from 'vitest';
import { SCORE_WINDOW_MIN, countsOf, valuesOfCounts } from '@/lib/depot/score/window';
import {
  NEW_EPOCH_AFTER_BEHIND,
  createScoreWindowStore,
  observeDepots,
  type ScoreWindowStore,
} from '@/lib/depot/score/windowStore';
import type { DepotSummary } from '@/lib/depot/types';
import { T0, feedTime, network, seeded, snapshotOf } from './depot-score-window.fixtures';

/*
 * A sample more than one window behind the newest is scored on
 * its own and never touches the window. A new epoch starts only after
 * NEW_EPOCH_AFTER_BEHIND such samples in a row, with no in-window sample
 * between them, each later than the one before and spanning
 * EPOCH_RUN_MIN_SPAN_MS of feed time; the window then resets and accepts
 * the last of them.
 */

const WINDOW_S = SCORE_WINDOW_MIN * 60;
const STUCK_S = 25 * 60;
const net = network(12, 7);
const snapAt = (s: number): DepotSummary[] => snapshotOf(net, seeded(5000 + s));
const heldSeconds = (store: ScoreWindowStore): number[] =>
  (store.byDepot.get('1') ?? []).map((sample) => (sample.feedMs - T0) / 1000);

function expectScoredAlone(store: ScoreWindowStore, s: number, fixture = false): void {
  const before = JSON.stringify([...store.byDepot]);
  const lastBefore = store.lastFeedMs;
  const out = observeDepots(store, snapAt(s), feedTime(s), { fixture });
  expect(JSON.stringify([...store.byDepot])).toBe(before);
  expect(store.lastFeedMs).toBe(lastBefore);
  expect(out.window).toMatchObject({ since: feedTime(s), samples: 1, coveredMin: 0 });
  const own = snapAt(s)[0] as DepotSummary;
  expect(out.values.get(own.id)).toEqual(valuesOfCounts(countsOf(own)));
}

describe('score window epochs', () => {
  it('names three stragglers as the least run that starts an epoch', () => {
    expect(NEW_EPOCH_AFTER_BEHIND).toBe(3);
  });

  it('keeps the live window intact beside a backend stuck 25 minutes behind', () => {
    const store = createScoreWindowStore();
    const live: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const at = 3000 + i * 40;
      const out = observeDepots(store, snapAt(at), feedTime(at));
      live.push(at);
      expect(heldSeconds(store)).toEqual(live);
      expect(out.window.samples).toBe(live.length);
      expectScoredAlone(store, at - STUCK_S);
    }
  });

  it('keeps the newer epoch when an older one interleaves with it', () => {
    const store = createScoreWindowStore();
    for (const [i, at] of [3000, 3010, 3020].entries()) {
      observeDepots(store, snapAt(at), feedTime(at));
      expectScoredAlone(store, i * 40);
    }
    expect(heldSeconds(store)).toEqual([3000, 3010, 3020]);
  });

  it('starts a new epoch once the run of stragglers spans three minutes, and accepts it', () => {
    const store = createScoreWindowStore();
    for (const at of [WINDOW_S * 3, WINDOW_S * 3 + 40]) observeDepots(store, snapAt(at), feedTime(at));
    for (const at of [0, 60, 120]) expectScoredAlone(store, at);
    const last = observeDepots(store, snapAt(180), feedTime(180));
    expect(store.lastFeedMs).toBe(T0 + 180_000);
    expect(heldSeconds(store)).toEqual([180]);
    expect(last.window).toMatchObject({ since: feedTime(180), samples: 1 });
    observeDepots(store, snapAt(220), feedTime(220));
    expect(heldSeconds(store)).toEqual([180, 220]);
  });

  it('two stragglers then an in-window sample start no epoch', () => {
    const store = createScoreWindowStore();
    observeDepots(store, snapAt(3000), feedTime(3000));
    expectScoredAlone(store, 0);
    expectScoredAlone(store, 40);
    observeDepots(store, snapAt(3040), feedTime(3040));
    expectScoredAlone(store, 80);
    expectScoredAlone(store, 120);
    expect(heldSeconds(store)).toEqual([3000, 3040]);
  });

  it('never counts the fixture or a clockless snapshot towards the three', () => {
    const store = createScoreWindowStore();
    observeDepots(store, snapAt(3000), feedTime(3000));
    for (const at of [0, 40, 80, 120]) expectScoredAlone(store, at, true);
    for (let i = 0; i < 4; i += 1) observeDepots(store, snapAt(0), null);
    expect(heldSeconds(store)).toEqual([3000]);
    expectScoredAlone(store, 0);
    expectScoredAlone(store, 40);
  });

  it('holds the same window whatever the order, over a span longer than one window', () => {
    const times = Array.from({ length: 161 }, (_, i) => i * 15);
    // Pairs swapped, every fifth held back 90 s, and a few held back 25 minutes:
    // those arrive as single stragglers, are scored alone, and are long gone in order.
    const far = new Set(times.filter((t, i) => i % 17 === 3 && t <= 2400 - STUCK_S));
    const swapped = times.map((_, i) => times[i % 2 === 0 ? i + 1 : i - 1] ?? 2400);
    const order: number[] = [];
    const pending = new Map<number, number[]>();
    for (const t of swapped) {
      if (far.has(t)) pending.set(t + STUCK_S, [...(pending.get(t + STUCK_S) ?? []), t]);
      else if (times.indexOf(t) % 5 === 0) pending.set(t + 90, [...(pending.get(t + 90) ?? []), t]);
      else order.push(t);
      for (const [due, list] of [...pending]) {
        if (due > t) continue;
        order.push(...list);
        pending.delete(due);
      }
    }
    for (const list of pending.values()) order.push(...list);
    expect(new Set(order).size).toBe(times.length);

    const inOrder = createScoreWindowStore();
    const reordered = createScoreWindowStore();
    for (const t of times) observeDepots(inOrder, snapAt(t), feedTime(t));
    for (const t of order) observeDepots(reordered, snapAt(t), feedTime(t));
    expect(JSON.stringify([...reordered.byDepot].sort())).toBe(
      JSON.stringify([...inOrder.byDepot].sort()),
    );
    const a = observeDepots(inOrder, snapAt(2415), feedTime(2415));
    const b = observeDepots(reordered, snapAt(2415), feedTime(2415));
    expect([...b.values]).toEqual([...a.values]);
    expect([...b.windows]).toEqual([...a.windows]);
  });
});

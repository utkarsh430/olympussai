import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { EPOCH_RUN_MIN_SPAN_MS, NEW_EPOCH_AFTER_BEHIND } from '@/lib/depot/score/epoch';
import { createScoreWindowStore, observeDepots } from '@/lib/depot/score/windowStore';
import { inferYards } from '@/lib/depot/infer/yard';
import {
  applyYardContinuity,
  createYardMemoryStore,
  yardSnapshotsSeen,
} from '@/lib/depot/infer/yardMemory';
import { feedTime, network, seeded, snapshotOf } from './depot-score-window.fixtures';
import { blob } from './depot-yard.fixtures';

/*
 * The epoch run: a straggler counts toward a new epoch
 * only when it is later in feed time than the previous straggler of the run
 * and within one window of it, and an epoch starts only once the run holds at
 * least three stragglers spanning EPOCH_RUN_MIN_SPAN_MS of feed time. A stuck
 * cache never starts one; a clock that really stepped back and keeps advancing
 * is followed within a few minutes. Both holders keep the same counter.
 *
 * Times are seconds of feed time from T0. An epoch shows as the holder's
 * newest feed time going back.
 */

const BASE = 10_000;
const net = network(4, 7);
const snapAt = (s: number) => snapshotOf(net, seeded(5000 + s));
const rowsAt = (s: number): DepotBusRow[] =>
  blob('Y', 12, { x: 0, y: 0 }, 20, { depotId: '1' }).map((r) => ({
    ...r,
    gpsTimestamp: feedTime(s),
  }));

interface Replay {
  /** Indexes of the arrivals that started an epoch, per holder. */
  readonly windowEpochs: number[];
  readonly yardEpochs: number[];
  /** Per arrival: samples the window scored it on, and the yard count after it. */
  readonly samples: number[];
  readonly seen: number[];
}

function replay(times: readonly number[]): Replay {
  const win = createScoreWindowStore();
  const yard = createYardMemoryStore();
  const out: Replay = { windowEpochs: [], yardEpochs: [], samples: [], seen: [] };
  times.forEach((s, i) => {
    const winBefore = win.lastFeedMs;
    const yardBefore = yard.lastFeedMs;
    out.samples.push(observeDepots(win, snapAt(s), feedTime(s)).window.samples);
    const rows = rowsAt(s);
    applyYardContinuity(yard, rows, inferYards(rows), feedTime(s));
    out.seen.push(yardSnapshotsSeen(yard, '1'));
    if (winBefore !== null && (win.lastFeedMs ?? 0) < winBefore) out.windowEpochs.push(i);
    if (yardBefore !== null && (yard.lastFeedMs ?? 0) < yardBefore) out.yardEpochs.push(i);
  });
  return out;
}

const FETCH_S = 15;
const LAG_S = 25 * 60;

/** `count` fetches FETCH_S apart; each picks live or the lagging backend at random. */
function interleave(count: number, seed: number, stuck: boolean, liveShare = 0.5) {
  const random = seeded(seed);
  const live: boolean[] = [];
  const times = Array.from({ length: count }, (_, k) => {
    const isLive = random() < liveShare;
    live.push(isLive);
    if (isLive) return BASE + k * FETCH_S;
    return stuck ? BASE - LAG_S : BASE + k * FETCH_S - LAG_S;
  });
  return { times, live };
}

describe('the epoch run', () => {
  it('names the run: three stragglers spanning three minutes of feed time', () => {
    expect(NEW_EPOCH_AFTER_BEHIND).toBe(3);
    expect(EPOCH_RUN_MIN_SPAN_MS).toBe(3 * 60_000);
  });

  it('never starts an epoch for a cache that answers the same old snapshot ten times', () => {
    const live = [0, 40, 80, 120, 160].map((s) => BASE + s);
    const r = replay([...live, ...Array<number>(10).fill(BASE - LAG_S), BASE + 200, BASE + 240]);
    expect(r.windowEpochs).toEqual([]);
    expect(r.yardEpochs).toEqual([]);
    expect(r.samples).toEqual([1, 2, 3, 4, 5, ...Array<number>(10).fill(1), 6, 7]);
    expect(r.seen).toEqual([1, 2, 3, 4, 5, ...Array<number>(10).fill(5), 6, 7]);
  });

  it('starts at most one epoch in a 50/50 interleave over 400 fetches', () => {
    const advancing = replay(interleave(400, 42, false).times);
    expect(advancing.windowEpochs.length).toBeLessThanOrEqual(1);
    expect(advancing.yardEpochs).toEqual(advancing.windowEpochs);
    expect(replay(interleave(400, 42, true).times).windowEpochs).toEqual([]);
  });

  it('follows a clock that steps back 30 minutes and keeps advancing, three minutes later', () => {
    const before = Array.from({ length: 40 }, (_, k) => BASE + k * FETCH_S);
    const after = Array.from({ length: 30 }, (_, k) => BASE + 40 * FETCH_S - 30 * 60 + k * FETCH_S);
    const r = replay([...before, ...after]);
    // The 13th straggler is the first whose run spans 12 x 15 s = 3 minutes.
    expect(r.windowEpochs).toEqual([40 + 12]);
    expect(r.yardEpochs).toEqual([40 + 12]);
    expect(r.samples.slice(40, 52)).toEqual(Array<number>(12).fill(1));
    expect(r.samples.slice(52, 56)).toEqual([1, 2, 3, 4]);
    expect(r.seen.slice(51, 54)).toEqual([40, 1, 2]);
  });

  it('starts no epoch on three stragglers from unrelated old times', () => {
    // The sequence: -3600 precedes -1500, so the run restarts there and holds two.
    const r = replay([BASE, BASE - 1500, BASE - 3600, BASE - 2400]);
    expect(r.windowEpochs).toEqual([]);
  });

  it('lets a repeated straggler neither count nor break the run', () => {
    const step = BASE - LAG_S;
    const run = [0, 60, 60, 60, 120, 120, 180].map((s) => step + s);
    expect(replay([BASE, ...run]).windowEpochs).toEqual([7]);
  });

  it('restarts the run at a straggler earlier than the previous one', () => {
    const step = BASE - LAG_S;
    const run = [0, 60, 120, 30, 90, 150, 210].map((s) => step + s);
    expect(replay([BASE, ...run]).windowEpochs).toEqual([7]);
  });

  // The stored samples are order-free within an epoch; the straggler run is not.
  it('stores the same samples whatever the order, while the straggler run depends on it', () => {
    const [a, b, c] = [BASE, BASE + 15 * 60, BASE - 6 * 60];
    const abc = createScoreWindowStore();
    const acb = createScoreWindowStore();
    for (const s of [a, b, c]) observeDepots(abc, snapAt(s), feedTime(s));
    for (const s of [a, c, b]) observeDepots(acb, snapAt(s), feedTime(s));
    expect(JSON.stringify([...acb.byDepot])).toBe(JSON.stringify([...abc.byDepot]));
    expect(abc.behindRun?.count).toBe(1);
    expect(acb.behindRun).toBeNull();
  });

  it('holds over random interleaves (property)', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = seeded(seed * 7919);
      const stuck = random() < 0.5;
      const share = 0.2 + random() * 0.6;
      const { times, live } = interleave(300, seed, stuck, share);
      const r = replay(times);
      expect(r.yardEpochs).toEqual(r.windowEpochs);
      if (stuck) expect(r.windowEpochs).toEqual([]);
      for (const at of r.windowEpochs) {
        // Every epoch closes a run of lagging answers, with no live one between,
        // that spans at least the named span of feed time.
        let first = at;
        while (first > 0 && live[first - 1] === false) first -= 1;
        expect(live.slice(first, at + 1).every((l) => !l)).toBe(true);
        const span = ((times[at] ?? 0) - (times[first] ?? 0)) * 1000;
        expect(span).toBeGreaterThanOrEqual(EPOCH_RUN_MIN_SPAN_MS);
      }
      const liveSingles = r.samples.filter((n, i) => live[i] && n === 1).length;
      expect(liveSingles).toBeLessThanOrEqual(1 + 2 * r.windowEpochs.length);
    }
  });
});

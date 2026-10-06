// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SnapshotAnalysis } from '@/lib/depot/live/analysis';
import { MAX_QUERY_BODIES_PER_SNAPSHOT, queryMemo } from '@/lib/depot/live/queryMemo';

const snapshot = (): SnapshotAnalysis => ({}) as SnapshotAnalysis;

describe('queryMemo', () => {
  it('holds at most 64 bodies per snapshot', () => {
    expect(MAX_QUERY_BODIES_PER_SNAPSHOT).toBe(64);
  });

  it('keeps the size at the bound when more distinct keys arrive, dropping the oldest', async () => {
    const memo = queryMemo<number>({ limit: 3 });
    const analysis = snapshot();
    let builds = 0;
    const build = (value: number) => async (): Promise<number> => {
      builds += 1;
      return value;
    };
    for (const n of [1, 2, 3, 4, 5]) await memo.hold(analysis, `k${n}`, build(n));
    expect(memo.size(analysis)).toBe(3);
    expect(builds).toBe(5);
    // The newest are still held; the oldest is built again.
    expect(await memo.hold(analysis, 'k5', build(50))).toBe(5);
    expect(builds).toBe(5);
    expect(await memo.hold(analysis, 'k1', build(10))).toBe(10);
    expect(builds).toBe(6);
    expect(memo.size(analysis)).toBe(3);
  });

  it('bounds each snapshot on its own', async () => {
    const memo = queryMemo<number>({ limit: 2 });
    const one = snapshot();
    const two = snapshot();
    await memo.hold(one, 'a', async () => 1);
    await memo.hold(two, 'a', async () => 2);
    expect([memo.size(one), memo.size(two)]).toEqual([1, 1]);
    expect(await memo.hold(two, 'a', async () => 3)).toBe(2);
  });

  it('shares one build between concurrent first requests', async () => {
    const memo = queryMemo<number>();
    const analysis = snapshot();
    let builds = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const build = async (): Promise<number> => {
      builds += 1;
      await gate;
      return 7;
    };
    const first = memo.hold(analysis, 'k', build);
    const second = memo.hold(analysis, 'k', build);
    release();
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(builds).toBe(1);
  });

  it('drops a failed build and a refused value so the next request tries again', async () => {
    const memo = queryMemo<number | null>({ keep: (value) => value !== null });
    const analysis = snapshot();
    await expect(
      memo.hold(analysis, 'bad', async () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await memo.hold(analysis, 'none', async () => null)).toBeNull();
    expect(memo.size(analysis)).toBe(0);
    expect(await memo.hold(analysis, 'bad', async () => 1)).toBe(1);
    expect(memo.size(analysis)).toBe(1);
  });
});

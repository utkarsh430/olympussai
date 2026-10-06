import { describe, expect, it } from 'vitest';
import {
  INITIAL_PROGRESS,
  loadButtonLabel,
  PROFILE_LOAD_CAP,
  progressSentence,
  routesToLoad,
  runProfileLoader,
  type LoaderProgress,
  type LookupOutcome,
} from '@/lib/depot/routes/profileLoader';

function harness(outcomes: Record<string, LookupOutcome[]>) {
  const calls: string[] = [];
  const waits: number[] = [];
  const seen: LoaderProgress[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const deps = {
    lookup: async (name: string): Promise<LookupOutcome> => {
      calls.push(name);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return outcomes[name]?.shift() ?? { kind: 'loaded' };
    },
    wait: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
    onProgress: (p: LoaderProgress) => seen.push(p),
  };
  return { deps, calls, waits, seen, maxInFlight: () => maxInFlight };
}

describe('profile loader', () => {
  it('looks routes up one at a time, in order, and counts what had no stops', async () => {
    const h = harness({ b: [{ kind: 'empty' }], c: [{ kind: 'failed' }] });
    const done = await runProfileLoader(['a', 'b', 'c'], h.deps, new AbortController().signal);
    expect(h.calls).toEqual(['a', 'b', 'c']);
    expect(h.maxInFlight()).toBe(1);
    expect(done).toMatchObject({ phase: 'done', total: 3, looked: 3, empty: 1, failed: 1 });
    expect(progressSentence(done)).toBe(
      'Done: 3 of 3 loaded, 1 had no stops in the feed, 1 could not be read. The plan will include the new profiles within half a minute.',
    );
  });

  it('pauses on a 429 for the Retry-After time, counting down, then retries the same route', async () => {
    const h = harness({ b: [{ kind: 'limited', retryAfterSeconds: 3 }] });
    await runProfileLoader(['a', 'b'], h.deps, new AbortController().signal);
    expect(h.calls).toEqual(['a', 'b', 'b']);
    expect(h.waits).toEqual([1000, 1000, 1000]);
    const paused = h.seen.filter((p) => p.phase === 'paused').map((p) => p.pausedSeconds);
    expect(paused).toEqual([3, 2, 1]);
    expect(progressSentence(h.seen.find((p) => p.phase === 'paused') as LoaderProgress)).toBe(
      'Paused: too many lookups; resuming in 3 seconds. 1 of 2 loaded.',
    );
  });

  it('stops when cancelled and says how far it got', async () => {
    const controller = new AbortController();
    const h = harness({});
    const deps = {
      ...h.deps,
      lookup: async (name: string): Promise<LookupOutcome> => {
        if (name === 'b') controller.abort();
        return h.deps.lookup(name);
      },
    };
    const done = await runProfileLoader(['a', 'b', 'c'], deps, controller.signal);
    expect(h.calls).toEqual(['a', 'b']);
    expect(done.phase).toBe('cancelled');
    expect(progressSentence(done)).toBe('Cancelled: 2 of 3 loaded.');
  });

  it('reports progress in words while running', () => {
    const p: LoaderProgress = { ...INITIAL_PROGRESS, phase: 'running', total: 23, looked: 7, empty: 2 };
    expect(progressSentence(p)).toBe('7 of 23 loaded, 2 had no stops in the feed.');
  });
});

describe('what a press loads', () => {
  const route = (routeName: string, profiled: boolean) => ({ routeName, profiled });

  it('takes the routes without a profile, at most the named cap', () => {
    expect(PROFILE_LOAD_CAP).toBe(40);
    const many = Array.from({ length: 50 }, (_, i) => route(`r${i}`, false));
    expect(routesToLoad([route('x', true), ...many])).toHaveLength(40);
    expect(routesToLoad([route('x', true), route('y', false)])).toEqual(['y']);
  });

  it('names the depot and the count on the button', () => {
    expect(loadButtonLabel(23)).toBe('Load route details: 23 lookups');
    expect(loadButtonLabel(1)).toBe('Load route details: 1 lookup');
  });
});

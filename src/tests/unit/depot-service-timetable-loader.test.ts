import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  busesToLoad,
  loadTimetableButtonLabel,
  lookupBusDay,
  runTimetableLoader,
  TIMETABLE_LOAD_CAP,
  timetableProgressSentence,
  timetableRemainingLine,
} from '@/lib/depot/service/timetableLoader';
import { INITIAL_PROGRESS, type LoaderProgress, type LookupOutcome } from '@/lib/depot/routes/profileLoader';

const ROUTE = 'AGRA_EXP_1';
const buses = (n: number): string[] => Array.from({ length: n }, (_, i) => `UP78AB${1000 + i}`);

afterEach(() => vi.unstubAllGlobals());

describe('the buses one press loads', () => {
  it('skips buses with a recorded day and buses answered this visit, at most 20', () => {
    const all = buses(30);
    const pick = busesToLoad(all, all.slice(0, 3), new Set([all[3] ?? '']));
    expect(TIMETABLE_LOAD_CAP).toBe(20);
    expect(pick).toHaveLength(20);
    expect(pick[0]).toBe(all[4]);
    expect(busesToLoad(all.slice(0, 2), all.slice(0, 2), new Set())).toEqual([]);
  });
});

function deps(outcomes: (bus: string, call: number) => LookupOutcome) {
  const calls: string[] = [];
  const progress: LoaderProgress[] = [];
  const wait = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => undefined);
  return {
    calls,
    progress,
    wait,
    deps: {
      lookup: async (bus: string): Promise<LookupOutcome> => {
        calls.push(bus);
        return outcomes(bus, calls.filter((c) => c === bus).length);
      },
      wait,
      onProgress: (p: LoaderProgress) => progress.push(p),
    },
  };
}

describe('the timetable loader run', () => {
  it('looks up one bus at a time, in order, and never more than the cap', async () => {
    const run = deps(() => ({ kind: 'loaded' }));
    const end = await runTimetableLoader(buses(25), run.deps, new AbortController().signal);
    expect(run.calls).toEqual(buses(20));
    expect(end).toMatchObject({ phase: 'done', total: 20, looked: 20 });
  });

  it('waits out a 429 a second at a time and asks the same bus again', async () => {
    const run = deps((_bus, call) => (call === 1 ? { kind: 'limited', retryAfterSeconds: 3 } : { kind: 'loaded' }));
    const end = await runTimetableLoader(buses(2), run.deps, new AbortController().signal);
    expect(run.calls).toEqual([buses(2)[0], buses(2)[0], buses(2)[1], buses(2)[1]]);
    expect(run.wait).toHaveBeenCalledTimes(6);
    expect(run.wait.mock.calls.every(([ms]) => ms === 1000)).toBe(true);
    expect(run.progress.some((p) => p.phase === 'paused' && p.pausedSeconds === 3)).toBe(true);
    expect(end.looked).toBe(2);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const run = deps(() => {
      controller.abort();
      return { kind: 'loaded' };
    });
    const end = await runTimetableLoader(buses(5), run.deps, controller.signal);
    expect(run.calls).toHaveLength(1);
    expect(end.phase).toBe('cancelled');
  });
});

describe('the loader in words', () => {
  const at = (over: Partial<LoaderProgress>): LoaderProgress => ({ ...INITIAL_PROGRESS, ...over });

  it('says the progress, the pause and the end', () => {
    expect(timetableProgressSentence(at({}))).toBe('');
    expect(timetableProgressSentence(at({ phase: 'running', total: 20, looked: 7 }))).toBe(
      '7 of 20 loaded · 13 remain',
    );
    expect(timetableProgressSentence(at({ phase: 'paused', total: 20, looked: 7, pausedSeconds: 41 }))).toBe(
      'Paused at the lookup limit; resuming in 41 seconds · 7 of 20 loaded · 13 remain',
    );
    expect(
      timetableProgressSentence(at({ phase: 'done', total: 20, looked: 20, empty: 2, failed: 1 })),
    ).toBe('Done: 17 of 20 loaded · 2 had no timetable · 1 could not be read. The chart updates on its next refresh.');
    expect(timetableProgressSentence(at({ phase: 'cancelled', total: 20, looked: 4 }))).toBe(
      'Cancelled: 4 of 20 loaded.',
    );
  });

  it('labels the button with its cost and says what is left', () => {
    expect(loadTimetableButtonLabel()).toBe('Load this route’s full timetable');
    expect(timetableRemainingLine(0, 12)).toBe('Every bus seen on this route has its timetable loaded.');
    expect(timetableRemainingLine(0, 0)).toBeNull();
    expect(timetableRemainingLine(26, 30)).toBe('26 of 30 buses still to load; a press loads up to 20.');
  });
});

describe('one bus day lookup', () => {
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
  const signal = new AbortController().signal;

  it('reads a recorded day, no timetable, a refusal and a failure', async () => {
    answer(200, { status: 'ok', trips: [{}], tripsOnRoute: 1 });
    expect(await lookupBusDay(ROUTE, 'UP78AB1000', signal)).toEqual({ kind: 'loaded' });
    answer(200, { status: 'unavailable', reason: 'no_schedule' });
    expect(await lookupBusDay(ROUTE, 'UP78AB1000', signal)).toEqual({ kind: 'empty' });
    answer(200, { status: 'unavailable', reason: 'upstream_error' });
    expect(await lookupBusDay(ROUTE, 'UP78AB1000', signal)).toEqual({ kind: 'failed' });
    answer(429, { error: 'Too many requests', retryAfterSeconds: 12 }, { 'Retry-After': '12' });
    expect(await lookupBusDay(ROUTE, 'UP78AB1000', signal)).toEqual({ kind: 'limited', retryAfterSeconds: 12 });
    answer(503, { error: 'Schedule data unavailable' });
    expect(await lookupBusDay(ROUTE, 'UP78AB1000', signal)).toEqual({ kind: 'failed' });
  });

  it('asks the schedule-day endpoint for the bus and the route, never for a malformed one', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await lookupBusDay(ROUTE, 'UP78AB1000', signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/upsrtc/depot/schedule-day/UP78AB1000?route=AGRA_EXP_1');
    expect(await lookupBusDay(ROUTE, '../x', signal)).toEqual({ kind: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

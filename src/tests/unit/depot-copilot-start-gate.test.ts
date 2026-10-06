// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import type { BinaryFs } from '@/lib/depot/copilot/providers/binary';
import { createClaudeCliProvider } from '@/lib/depot/copilot/providers/claudeCli';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import { IDENTITY_CLAUDE_CALLS_PER_HOUR } from '@/lib/depot/copilot/service/constants';
import { answerCopilot, type AnswerCall } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest } from '@/lib/depot/copilot/service/prepare';
import { buildCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';

/**
 * The time floor is asked twice: when the request plans its call, and again in
 * the core, after any wait in the queue, just before the slot is taken. No
 * process runs: `spawn` returns event emitters and the group kill is a fake.
 */

const rows = normalizeDepotRows(liveFixture).rows;
const VIEW = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live' as const,
  stale: false,
  recordCount: rows.length,
};

function prepared(depotIndex: number) {
  const scope =
    depotIndex < 0
      ? { kind: 'network' }
      : { kind: 'depot', depotId: rows[depotIndex]?.depotId ?? 'none' };
  const body = parseCopilotBody(JSON.stringify({ task: 'briefing', scope }));
  const result = body ? prepareCopilotRequest(body, VIEW) : null;
  if (!result?.ok) throw new Error('fixture must prepare');
  return result;
}

const SAFE_FS: BinaryFs = {
  realpath: (path) => path,
  stat: (path) => ({ isFile: path.endsWith('/claude'), mode: 0o755, uid: 0 }),
};
const MIN_CLAUDE_MS = 10_000;
const DEADLINE_MS = 20_000;

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetAnalysisForTests();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe('the time floor re-checked before the slot', () => {
  it('a waiter left with too little time makes no call, spends no budget, and is refunded', async () => {
    let clock = 1_000_000;
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawn = vi.fn(() => {
      const child = fakeChild();
      // Only the first call holds its slot; any later one (which must not happen) ends at once.
      if (children.length > 0) queueMicrotask(() => child.emit('close', 1));
      children.push(child);
      return child;
    });
    const tryAcquire = vi.fn(() => true);
    const cli = createClaudeCliProvider({
      spawn,
      bin: '/opt/claude/claude',
      model: 'sonnet',
      home: '/tmp/copilot-home',
      cwd: () => '/tmp/copilot-cwd',
      env: {},
      fs: SAFE_FS,
      repoRoot: '/srv/app',
      semaphore: createSemaphore(1, 2),
      limiter: { tryAcquire },
      killGroup: () => undefined,
    });
    const runtime = buildCopilotRuntime({
      setting: 'auto',
      cli,
      minClaudeMs: MIN_CLAUDE_MS,
      now: () => clock,
    });
    const call = (identity: string): AnswerCall => ({
      deadlineAt: clock + DEADLINE_MS,
      signal: new AbortController().signal,
      identity,
    });

    const first = answerCopilot(runtime, prepared(0), call('first'));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const waiter = answerCopilot(runtime, prepared(-1), call('waiter'));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The first call holds the only slot until the waiter has too little time left.
    clock += DEADLINE_MS - MIN_CLAUDE_MS + 1;
    children[0]?.emit('close', 1);
    await first;
    const answer = await waiter;

    expect(answer.provider).toBe('scripted');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(tryAcquire).toHaveBeenCalledTimes(1);
    // Refunded: the waiter still has its whole hourly allowance.
    for (let i = 0; i < IDENTITY_CLAUDE_CALLS_PER_HOUR; i += 1) {
      expect(runtime.claudeAllowance.take('waiter').limited).toBe(false);
    }
    expect(runtime.claudeAllowance.take('waiter').limited).toBe(true);
  });
});

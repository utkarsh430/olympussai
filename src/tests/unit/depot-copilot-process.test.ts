// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLI_CLOSE_GRACE_MS,
  runCli,
  type RunCliInput,
} from '@/lib/depot/copilot/cli/run';
import {
  ANCESTOR_WRITABLE,
  assertUsableBinary,
  type BinaryFs,
} from '@/lib/depot/copilot/providers/binary';
import { createLiveCalls } from '@/lib/depot/copilot/cli/liveCalls';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import { createCliProvider, type CliFactoryDeps } from '@/lib/depot/copilot/service/cliFactory';
import type { CopilotRequest } from '@/lib/depot/copilot/types';

/**
 * Process control on every exit path. Nothing here sends a real signal: the
 * group kill is an injected fake, and every child is an event emitter.
 */
vi.mock('@/lib/serverLog', () => ({ logDepotError: vi.fn() }));

/** Above every OS pid limit, so a signal that reached the real kill could only fail. */
const PID = 2 ** 30;
const ESRCH = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: PID,
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

const INPUT: RunCliInput = {
  bin: '/opt/claude/claude',
  args: ['-p'],
  env: { PATH: '/usr/bin' },
  cwd: '/tmp/empty',
  stdin: 'prompt',
  timeoutMs: 1_000,
  maxOutputBytes: 100,
};

describe('runCli process control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('kills the group after a clean exit, ignoring a group that is already gone', async () => {
    const child = fakeChild();
    const killGroup = vi.fn(() => {
      throw ESRCH;
    });
    const promise = runCli(INPUT, () => child, killGroup);
    child.stdout.emit('data', 'ok');
    child.emit('close', 0);
    await expect(promise).resolves.toEqual({ ok: true, stdout: 'ok' });
    expect(killGroup).toHaveBeenCalledWith(PID);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills the group after a failing exit too', async () => {
    const child = fakeChild();
    const killGroup = vi.fn();
    const promise = runCli(INPUT, () => child, killGroup);
    child.emit('close', 1);
    await expect(promise).resolves.toMatchObject({ ok: false });
    expect(killGroup).toHaveBeenCalledWith(PID);
  });

  it('kills the group on the error event and resolves only once the child has closed', async () => {
    const child = fakeChild();
    const killGroup = vi.fn();
    let resolved = false;
    const promise = runCli(INPUT, () => child, killGroup).then((r) => {
      resolved = true;
      return r;
    });
    child.emit('error', new Error('EPIPE'));
    expect(killGroup).toHaveBeenCalledWith(PID);
    await vi.advanceTimersByTimeAsync(CLI_CLOSE_GRACE_MS - 1);
    expect(resolved).toBe(false);
    child.emit('close', null);
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'error' });
  });

  it('waits for close after the timeout kill, not for the kill signal', async () => {
    const child = fakeChild();
    const killGroup = vi.fn();
    let resolved = false;
    const promise = runCli(INPUT, () => child, killGroup).then((r) => {
      resolved = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(INPUT.timeoutMs);
    expect(killGroup).toHaveBeenCalledWith(PID);
    expect(resolved).toBe(false);
    child.emit('close', null);
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('resolves after the grace period when close never comes, and says so', async () => {
    const child = fakeChild();
    const promise = runCli(INPUT, () => child, vi.fn());
    await vi.advanceTimersByTimeAsync(INPUT.timeoutMs + CLI_CLOSE_GRACE_MS);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(result.ok ? '' : result.detail).toMatch(/not closed within the grace period/);
  });

  it('falls back to killing the child itself when the group cannot be signalled', async () => {
    const child = fakeChild();
    const killGroup = vi.fn(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    });
    const promise = runCli(INPUT, () => child, killGroup);
    child.emit('close', 0);
    await promise;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

const ROOT_UID = 0;
const SAFE_DIR = { isFile: false, mode: 0o40755, uid: ROOT_UID };
const fsWith = (modes: Readonly<Record<string, number>>): BinaryFs => ({
  realpath: (path) => path,
  stat: (path) =>
    path.endsWith('/claude')
      ? { isFile: true, mode: 0o100755, uid: ROOT_UID }
      : { ...SAFE_DIR, mode: modes[path] ?? SAFE_DIR.mode },
});

describe('binary ancestry', () => {
  it('accepts a binary whose every ancestor only its owner can write', () => {
    expect(assertUsableBinary('/opt/tools/bin/claude', fsWith({}), ROOT_UID)).toBe(
      '/opt/tools/bin/claude',
    );
  });

  it.each([
    ['a group-writable grandparent', '/opt/tools', 0o40775],
    ['a world-writable ancestor', '/opt', 0o40757],
    ['a sticky world-writable ancestor such as the temp directory', '/opt', 0o41777],
    ['a writable filesystem root', '/', 0o40777],
  ] as const)('refuses %s with the fixed message', (_name, dir, mode) => {
    expect(() => assertUsableBinary('/opt/tools/bin/claude', fsWith({ [dir]: mode }), 0)).toThrow(
      ANCESTOR_WRITABLE,
    );
  });
});

const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'the network',
  facts: [{ id: 'a', label: 'A', text: '12', provenance: 'live' }],
  guidance: 'g',
  scriptedDraft: { headline: 'H', paragraphs: ['{{fact:a}}'] },
};

describe('per-call directories', () => {
  it('are removed only after the child has closed, not when the kill is sent', async () => {
    const child = fakeChild();
    const events: string[] = [];
    const deps: CliFactoryDeps = {
      env: { CLAUDE_BIN: '/usr/local/bin/claude', DEPOT_COPILOT_PROVIDER: 'auto' },
      spawn: () => child,
      fs: fsWith({}),
      tempRoot: '/tmp',
      makeDir: async (prefix: string) => `/tmp/${prefix}1`,
      removeDir: async (path: string) => {
        events.push(`remove ${path}`);
      },
      semaphore: createSemaphore(1, 1),
      limiter: { tryAcquire: () => true },
      killGroup: () => {
        events.push('kill');
      },
    };
    const controller = new AbortController();
    const provider = createCliProvider(deps);
    const drafted = provider!.draft(REQUEST, controller.signal).catch(() => 'refused');
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalled());
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['kill']);
    events.push('close');
    child.emit('close', null);
    await drafted;
    expect(events.slice(0, 2)).toEqual(['kill', 'close']);
    expect(events.slice(2).every((e) => e.startsWith('remove '))).toBe(true);
    expect(events).toHaveLength(4);
  });

  it('are known to the shutdown handler from creation until removed (review L4)', async () => {
    const child = fakeChild();
    const calls = createLiveCalls();
    const provider = createCliProvider({
      env: { CLAUDE_BIN: '/usr/local/bin/claude', DEPOT_COPILOT_PROVIDER: 'auto' },
      spawn: () => child,
      fs: fsWith({}),
      tempRoot: '/tmp',
      makeDir: async (prefix: string) => `/tmp/${prefix}1`,
      removeDir: async () => undefined,
      semaphore: createSemaphore(1, 1),
      limiter: { tryAcquire: () => true },
      killGroup: () => undefined,
      liveCalls: calls,
    });
    const drafted = provider!.draft(REQUEST).catch(() => 'refused');
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalled());
    expect([...calls.snapshot().dirs].sort()).toEqual([
      '/tmp/depot-copilot-cwd-1',
      '/tmp/depot-copilot-home-1',
    ]);
    child.emit('close', 1);
    await drafted;
    expect(calls.snapshot().dirs).toEqual([]);
  });
});

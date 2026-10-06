// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createLiveCalls } from '@/lib/depot/copilot/cli/liveCalls';
import { runCli, type RunCliInput } from '@/lib/depot/copilot/cli/run';
import {
  installShutdownCleanup,
  type ShutdownSignal,
  type SignalSource,
} from '@/lib/depot/copilot/service/shutdown';

/**
 * Review L4. On SIGTERM or SIGINT the service kills the process groups it started
 * that are still alive and removes their folders, then lets the signal take its
 * course. No test here sends a real signal: the kill, the removal and the signal
 * source are fakes, and every pid is above every OS pid limit, so the global
 * kill guard (src/tests/setup/signalGuard.ts) would fail any test that reached
 * the real `process.kill` with one.
 */
vi.mock('@/lib/serverLog', () => ({ logDepotError: vi.fn() }));

const PID = 2 ** 30;

function fakeSignals(otherListeners = 0) {
  const handlers = new Map<ShutdownSignal, (() => void)[]>();
  const raised: ShutdownSignal[] = [];
  const source: SignalSource = {
    once: (signal, handler) => {
      handlers.set(signal, [...(handlers.get(signal) ?? []), handler]);
    },
    listenerCount: () => otherListeners,
    raise: (signal) => {
      raised.push(signal);
    },
  };
  const fire = (signal: ShutdownSignal): void => {
    const list = handlers.get(signal) ?? [];
    handlers.set(signal, []);
    for (const handler of list) handler();
  };
  return { source, handlers, raised, fire };
}

function setup(otherListeners = 0) {
  const calls = createLiveCalls();
  const signals = fakeSignals(otherListeners);
  const killGroup = vi.fn<(pid: number) => void>();
  const removeDirSync = vi.fn<(dir: string) => void>();
  const holder: Record<symbol, unknown> = {};
  const install = (): boolean =>
    installShutdownCleanup({ calls, killGroup, removeDirSync, signals: signals.source }, holder);
  return { calls, signals, killGroup, removeDirSync, install };
}

describe('shutdown cleanup (review L4)', () => {
  it('registers once for SIGTERM and SIGINT, however often it is installed', () => {
    const t = setup();
    expect(t.install()).toBe(true);
    expect(t.install()).toBe(false);
    expect(t.install()).toBe(false);
    expect(t.signals.handlers.get('SIGTERM')).toHaveLength(1);
    expect(t.signals.handlers.get('SIGINT')).toHaveLength(1);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'on %s kills each live group, removes each folder, then lets the signal proceed',
    (signal) => {
      const t = setup();
      t.install();
      t.calls.addPid(PID);
      t.calls.addPid(PID + 1);
      t.calls.addDir('/tmp/depot-copilot-home-a');
      t.calls.addDir('/tmp/depot-copilot-cwd-a');
      t.signals.fire(signal);
      expect(t.killGroup.mock.calls.map(([pid]) => pid).sort()).toEqual([PID, PID + 1]);
      expect(t.removeDirSync.mock.calls.map(([dir]) => dir).sort()).toEqual([
        '/tmp/depot-copilot-cwd-a',
        '/tmp/depot-copilot-home-a',
      ]);
      expect(t.signals.raised).toEqual([signal]);
    },
  );

  it('never targets a pid already seen to exit, nor a folder already removed', () => {
    const t = setup();
    t.install();
    t.calls.addPid(PID);
    t.calls.addPid(PID + 1);
    t.calls.dropPid(PID + 1);
    t.calls.addDir('/tmp/a');
    t.calls.dropDir('/tmp/a');
    t.signals.fire('SIGTERM');
    expect(t.killGroup.mock.calls).toEqual([[PID]]);
    expect(t.removeDirSync).not.toHaveBeenCalled();
  });

  it('leaves the exit to another listener when the process has one', () => {
    const t = setup(1);
    t.install();
    t.calls.addPid(PID);
    t.signals.fire('SIGINT');
    expect(t.killGroup).toHaveBeenCalledOnce();
    expect(t.signals.raised).toEqual([]);
  });

  it('a failing kill or removal neither stops the rest nor keeps the process alive', () => {
    const t = setup();
    t.killGroup.mockImplementation(() => {
      throw new Error('kill EPERM');
    });
    t.removeDirSync.mockImplementation(() => {
      throw new Error('rm EBUSY');
    });
    t.install();
    t.calls.addPid(PID);
    t.calls.addPid(PID + 1);
    t.calls.addDir('/tmp/a');
    t.calls.addDir('/tmp/b');
    expect(() => t.signals.fire('SIGTERM')).not.toThrow();
    expect(t.killGroup).toHaveBeenCalledTimes(2);
    expect(t.removeDirSync).toHaveBeenCalledTimes(2);
    expect(t.signals.raised).toEqual(['SIGTERM']);
  });
});

const INPUT: RunCliInput = {
  bin: '/opt/claude/claude',
  args: ['-p'],
  env: { PATH: '/usr/bin' },
  cwd: '/tmp/empty',
  stdin: 'prompt',
  timeoutMs: 1_000,
  maxOutputBytes: 100,
};

function fakeChild(pid?: number) {
  return Object.assign(new EventEmitter(), {
    ...(pid === undefined ? {} : { pid }),
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

describe('the live-call registry is kept by the code that spawns and reaps', () => {
  it('runCli registers the child it started and drops it once it is seen to exit', async () => {
    const calls = createLiveCalls();
    const child = fakeChild(PID);
    const promise = runCli(INPUT, () => child, vi.fn(), calls);
    expect(calls.snapshot().pids).toEqual([PID]);
    child.emit('exit', 0, null);
    expect(calls.snapshot().pids).toEqual([]);
    child.emit('close', 0);
    await promise;
    expect(calls.snapshot().pids).toEqual([]);
  });

  it('a child with no pid is never registered', async () => {
    const calls = createLiveCalls();
    const child = fakeChild();
    const promise = runCli(INPUT, () => child, vi.fn(), calls);
    expect(calls.snapshot().pids).toEqual([]);
    child.emit('close', 0);
    await promise;
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildLike, SpawnLike } from '@/lib/depot/copilot/cli/run';
import type { BinaryFs } from '@/lib/depot/copilot/providers/binary';
import { createClaudeCliProvider } from '@/lib/depot/copilot/providers/claudeCli';
import { createCopilotEngine } from '@/lib/depot/copilot/resolve';
import { createScriptedProvider } from '@/lib/depot/copilot/providers/scripted';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import { CopilotFailure, type CopilotRequest } from '@/lib/depot/copilot/types';

/**
 * Cancellation in the core: an abort is its own reason, never a sign of CLI
 * health. Nothing here runs a real process; `spawn` returns a child that never exits.
 */

const ROOT_UID = 0;
const fs: BinaryFs = {
  realpath: (path) => path,
  stat: (path) => ({ isFile: path.endsWith('claude'), mode: 0o755, uid: ROOT_UID }),
};
const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'the network',
  facts: [{ id: 'a', label: 'A', text: '12 buses', provenance: 'live' }],
  guidance: 'g',
  scriptedDraft: { headline: 'Network', paragraphs: ['The fleet is {{fact:a}}.'] },
};

function silentChild(): ChildLike & { readonly kill: ReturnType<typeof vi.fn> } {
  const stream = { on: () => undefined };
  return {
    stdin: { write: () => true, end: () => undefined, on: () => undefined },
    stdout: stream,
    stderr: stream,
    on: () => undefined,
    kill: vi.fn(),
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe('semaphore cancellation', () => {
  it('lets a queued waiter leave on abort without running its task', async () => {
    const semaphore = createSemaphore(1, 1);
    let releaseFirst: () => void = () => undefined;
    const first = semaphore.run(() => new Promise<void>((r) => (releaseFirst = r)));
    const controller = new AbortController();
    const task = vi.fn(async () => 'ran');
    const queued = semaphore.run(task, controller.signal);
    controller.abort();
    await expect(queued).rejects.toEqual(new CopilotFailure('aborted', 'left the queue'));
    // The queue place is free again: a new waiter is accepted, not refused as busy.
    const next = semaphore.run(async () => 'next');
    releaseFirst();
    await first;
    await expect(next).resolves.toBe('next');
    expect(task).not.toHaveBeenCalled();
  });

  it('refuses an already aborted signal without taking a slot', async () => {
    const semaphore = createSemaphore(1, 0);
    const controller = new AbortController();
    controller.abort();
    await expect(semaphore.run(async () => 1, controller.signal)).rejects.toMatchObject({
      reason: 'aborted',
    });
    await expect(semaphore.run(async () => 2)).resolves.toBe(2);
  });
});

describe('Claude CLI provider cancellation', () => {
  function provider(spawn: SpawnLike, tryAcquire: () => boolean, limit = 1) {
    return createClaudeCliProvider({
      spawn,
      bin: '/usr/local/bin/claude',
      model: 'sonnet',
      home: '/tmp/depot-copilot-home-test',
      cwd: () => '/tmp/depot-copilot-cwd-test',
      env: {},
      nodeDir: '/usr/local/bin',
      semaphore: createSemaphore(limit, 1),
      limiter: { tryAcquire },
      fs,
    });
  }

  it('reports aborted and kills the child when the signal aborts mid-run', async () => {
    const child = silentChild();
    const cli = provider(vi.fn<SpawnLike>(() => child), () => true);
    const controller = new AbortController();
    const pending = cli.draft(REQUEST, controller.signal);
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    expect(child.kill).toHaveBeenCalled();
  });

  it('spends no budget for a waiter that leaves the queue', async () => {
    const tryAcquire = vi.fn(() => true);
    const cli = provider(vi.fn<SpawnLike>(() => silentChild()), tryAcquire);
    const holder = new AbortController();
    const running = cli.draft(REQUEST, holder.signal);
    const waiter = new AbortController();
    const queued = cli.draft(REQUEST, waiter.signal);
    await new Promise((r) => setTimeout(r, 0));
    waiter.abort();
    await expect(queued).rejects.toMatchObject({ reason: 'aborted' });
    expect(tryAcquire).toHaveBeenCalledTimes(1);
    holder.abort();
    await expect(running).rejects.toMatchObject({ reason: 'aborted' });
  });
});

describe('engine and aborts', () => {
  it('never opens the breaker on aborts and logs nothing for them', async () => {
    const draft = vi.fn(async () => {
      throw new CopilotFailure('aborted', 'gone');
    });
    const engine = createCopilotEngine({
      setting: 'auto',
      cli: { id: 'claude-cli', draft },
      scripted: createScriptedProvider(),
      now: () => 0,
      cooldownMs: 600_000,
    });
    for (let i = 0; i < 6; i += 1) {
      const text = await engine.generate(REQUEST, AbortSignal.abort());
      expect(text.fallbackReason).toBe('aborted');
    }
    expect(draft).toHaveBeenCalledTimes(6);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

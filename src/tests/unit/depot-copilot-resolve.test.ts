import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  CLI_CONCURRENCY,
  CLI_COOLDOWN_MS,
  CLI_MAX_OUTPUT_BYTES,
  CLI_QUEUE,
  CLI_TIMEOUT_MS,
  readProviderSetting,
} from '@/lib/depot/copilot/config';
import type { ChildLike, SpawnLike } from '@/lib/depot/copilot/cli/run';
import { createClaudeCliProvider } from '@/lib/depot/copilot/providers/claudeCli';
import { createScriptedProvider } from '@/lib/depot/copilot/providers/scripted';
import { createCopilotEngine } from '@/lib/depot/copilot/resolve';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
  type FallbackReason,
} from '@/lib/depot/copilot/types';

const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'Network',
  facts: [{ id: 'buses', label: 'Buses', text: '1,204', provenance: 'live' }],
  guidance: 'Be brief.',
  scriptedDraft: { headline: 'Network briefing', paragraphs: ['Fleet is {{fact:buses}}.'] },
};

const GOOD_DRAFT: CopilotDraft = {
  headline: 'Claude headline',
  paragraphs: ['Claude says {{fact:buses}}.'],
};

const cliThatReturns = (draft: CopilotDraft): CopilotProvider => ({
  id: 'claude-cli',
  draft: vi.fn(async () => draft),
});
const cliThatFails = (reason: FallbackReason): CopilotProvider => ({
  id: 'claude-cli',
  draft: vi.fn(async () => {
    throw new CopilotFailure(reason, 'detail');
  }),
});

function engine(cli: CopilotProvider | null, setting: 'auto' | 'claude-cli' | 'scripted' = 'auto') {
  let clock = 1_000_000;
  const instance = createCopilotEngine({
    setting,
    cli,
    scripted: createScriptedProvider(),
    now: () => clock,
    cooldownMs: 1000,
  });
  return {
    instance,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

describe('config', () => {
  it('exposes the documented limits', () => {
    expect([
      CLI_CONCURRENCY,
      CLI_QUEUE,
      CLI_TIMEOUT_MS,
      CLI_MAX_OUTPUT_BYTES,
      CLI_COOLDOWN_MS,
    ]).toEqual([2, 2, 45_000, 1_048_576, 600_000]);
  });

  it.each([
    [{}, 'auto'],
    [{ DEPOT_COPILOT_PROVIDER: 'auto' }, 'auto'],
    [{ DEPOT_COPILOT_PROVIDER: 'claude-cli' }, 'claude-cli'],
    [{ DEPOT_COPILOT_PROVIDER: 'scripted' }, 'scripted'],
    [{ DEPOT_COPILOT_PROVIDER: 'gpt' }, 'auto'],
    [{ DEPOT_COPILOT_PROVIDER: '' }, 'auto'],
    [{ DEPOT_COPILOT_PROVIDER: 'SCRIPTED' }, 'auto'],
  ] as const)('reads %j as %s', (env, expected) => {
    expect(readProviderSetting(env)).toBe(expected);
  });
});

describe('scripted provider', () => {
  it('returns the request draft and is the scripted id', async () => {
    const provider = createScriptedProvider();
    expect(provider.id).toBe('scripted');
    await expect(provider.draft(REQUEST)).resolves.toEqual(REQUEST.scriptedDraft);
  });
});

describe('createCopilotEngine', () => {
  it('uses scripted with not_selected when the setting is scripted, never touching the CLI', async () => {
    const cli = cliThatReturns(GOOD_DRAFT);
    const { instance } = engine(cli, 'scripted');
    const out = await instance.generate(REQUEST);
    expect(out).toMatchObject({
      provider: 'scripted',
      fellBack: false,
      fallbackReason: 'not_selected',
      headline: 'Network briefing',
      paragraphs: ['Fleet is 1,204.'],
      usedFactIds: ['buses'],
    });
    expect(cli.draft).not.toHaveBeenCalled();
  });

  it('uses scripted with not_selected when no CLI provider exists', async () => {
    const out = await engine(null).instance.generate(REQUEST);
    expect(out).toMatchObject({
      provider: 'scripted',
      fellBack: false,
      fallbackReason: 'not_selected',
    });
  });

  it('returns the rendered CLI draft when it validates', async () => {
    const out = await engine(cliThatReturns(GOOD_DRAFT)).instance.generate(REQUEST);
    expect(out).toMatchObject({
      provider: 'claude-cli',
      fellBack: false,
      fallbackReason: null,
      headline: 'Claude headline',
      paragraphs: ['Claude says 1,204.'],
      usedFactIds: ['buses'],
    });
    expect(Number.isNaN(Date.parse(out.generatedAt))).toBe(false);
  });

  it('stamps generatedAt from the injected clock', async () => {
    const out = await engine(null).instance.generate(REQUEST);
    expect(out.generatedAt).toBe(new Date(1_000_000).toISOString());
  });

  it.each([
    'not_installed',
    'not_authenticated',
    'usage_limit',
    'timeout',
    'invalid_output',
    'error',
  ] as const)('falls back to scripted on %s and starts the cool-down', async (reason) => {
    const cli = cliThatFails(reason);
    const { instance } = engine(cli);
    const first = await instance.generate(REQUEST);
    expect(first).toMatchObject({ provider: 'scripted', fellBack: true, fallbackReason: reason });
    const second = await instance.generate(REQUEST);
    expect(second).toMatchObject({
      provider: 'scripted',
      fellBack: true,
      fallbackReason: 'cooling_down',
    });
    expect(cli.draft).toHaveBeenCalledTimes(1);
  });

  it('retries the CLI once the cool-down has expired', async () => {
    const cli = cliThatFails('timeout');
    const { instance, advance } = engine(cli);
    await instance.generate(REQUEST);
    advance(999);
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('cooling_down');
    advance(1);
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('timeout');
    expect(cli.draft).toHaveBeenCalledTimes(2);
  });

  it('does not start a cool-down for busy', async () => {
    const cli = cliThatFails('busy');
    const { instance } = engine(cli);
    expect(await instance.generate(REQUEST)).toMatchObject({
      fellBack: true,
      fallbackReason: 'busy',
    });
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('busy');
    expect(cli.draft).toHaveBeenCalledTimes(2);
  });

  it('treats an unexpected thrown error as error and cools down', async () => {
    const cli: CopilotProvider = {
      id: 'claude-cli',
      draft: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const { instance } = engine(cli);
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('error');
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('cooling_down');
  });

  it.each([
    ['a digit', { headline: 'Head', paragraphs: ['About 5 buses.'] }],
    ['a quantity word', { headline: 'Head', paragraphs: ['About a third late.'] }],
    ['an unknown fact', { headline: 'Head', paragraphs: ['{{fact:nope}}'] }],
    ['markup', { headline: 'Head', paragraphs: ['<b>x</b>'] }],
  ])('rejects a CLI draft with %s, uses scripted, and does not cool down', async (_n, draft) => {
    const cli = cliThatReturns(draft);
    const { instance } = engine(cli);
    const first = await instance.generate(REQUEST);
    expect(first).toMatchObject({
      provider: 'scripted',
      fellBack: true,
      fallbackReason: 'rejected_draft',
      paragraphs: ['Fleet is 1,204.'],
    });
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('rejected_draft');
    expect(cli.draft).toHaveBeenCalledTimes(2);
  });

  it('throws, naming the task, when the scripted draft itself fails to render', async () => {
    const bad: CopilotRequest = {
      ...REQUEST,
      task: 'rationale',
      scriptedDraft: { headline: 'Head', paragraphs: ['Has 7 digits'] },
    };
    await expect(engine(null).instance.generate(bad)).rejects.toThrow(/rationale/);
    await expect(engine(cliThatFails('timeout')).instance.generate(bad)).rejects.toThrow(
      /rationale/,
    );
  });
});

describe('createSemaphore', () => {
  it('never runs more than the limit and rejects with busy when the queue is full', async () => {
    const semaphore = createSemaphore(2, 2);
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const task = (): Promise<string> =>
      semaphore.run(
        () =>
          new Promise<string>((resolve) => {
            running += 1;
            peak = Math.max(peak, running);
            release.push(() => {
              running -= 1;
              resolve('done');
            });
          }),
      );

    const results = Array.from({ length: 20 }, () =>
      task().then(
        (v) => v,
        (e: unknown) => (e instanceof CopilotFailure ? e.reason : 'other'),
      ),
    );
    await Promise.resolve();
    expect(running).toBe(2);
    while (release.length > 0) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    const settled = await Promise.all(results);
    expect(peak).toBe(2);
    expect(settled.filter((r) => r === 'done')).toHaveLength(4);
    expect(settled.filter((r) => r === 'busy')).toHaveLength(16);
  });

  it('frees the slot when a task throws', async () => {
    const semaphore = createSemaphore(1, 0);
    await expect(semaphore.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});

function fakeSpawn(
  script: (child: EventEmitter, stdout: EventEmitter, stderr: EventEmitter) => void,
): SpawnLike {
  return () => {
    const emitter = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = {
      stdin: { write: () => true, end: () => undefined, on: () => undefined },
      stdout: { on: (_e: 'data', l: (c: string) => void) => stdout.on('data', l) },
      stderr: { on: (_e: 'data', l: (c: string) => void) => stderr.on('data', l) },
      on: (event: string, l: (...a: never[]) => void) => emitter.on(event, l as () => void),
      kill: () => true,
    } as unknown as ChildLike;
    queueMicrotask(() => script(emitter, stdout, stderr));
    return child;
  };
}

const providerWith = (spawn: SpawnLike, env: Record<string, string | undefined> = {}) =>
  createClaudeCliProvider({
    spawn,
    bin: 'claude',
    model: 'sonnet',
    home: '/tmp/home',
    cwd: () => '/tmp/empty',
    env,
  });

describe('createClaudeCliProvider', () => {
  it('returns the validated draft from the CLI envelope', async () => {
    const spawn = fakeSpawn((child, stdout) => {
      stdout.emit('data', JSON.stringify({ is_error: false, structured_output: GOOD_DRAFT }));
      child.emit('close', 0);
    });
    await expect(providerWith(spawn).draft(REQUEST)).resolves.toEqual(GOOD_DRAFT);
  });

  it('passes an allowlisted environment, never the API key', async () => {
    const spawn = vi.fn<SpawnLike>(
      fakeSpawn((child, stdout) => {
        stdout.emit('data', JSON.stringify({ structured_output: GOOD_DRAFT }));
        child.emit('close', 0);
      }),
    );
    await providerWith(spawn, { PATH: '/bin', ANTHROPIC_API_KEY: 'sk', SESSION_SECRET: 's' }).draft(
      REQUEST,
    );
    const options = spawn.mock.calls[0]?.[2];
    expect(options?.env).toEqual({ PATH: '/bin', HOME: '/tmp/home' });
    expect(options?.cwd).toBe('/tmp/empty');
  });

  it('throws CopilotFailure(invalid_output) for a malformed envelope', async () => {
    const spawn = fakeSpawn((child, stdout) => {
      stdout.emit('data', 'not json');
      child.emit('close', 0);
    });
    await expect(providerWith(spawn).draft(REQUEST)).rejects.toMatchObject({
      name: 'CopilotFailure',
      reason: 'invalid_output',
    });
  });

  it('reads an error envelope on a clean exit as the failure it describes', async () => {
    const spawn = fakeSpawn((child, stdout) => {
      stdout.emit('data', JSON.stringify({ is_error: true, result: 'Claude usage limit reached' }));
      child.emit('close', 0);
    });
    await expect(providerWith(spawn).draft(REQUEST)).rejects.toMatchObject({
      reason: 'usage_limit',
    });
  });

  it('throws CopilotFailure with the runner reason (not_installed)', async () => {
    const spawn = fakeSpawn((child) => {
      child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }));
    });
    await expect(providerWith(spawn).draft(REQUEST)).rejects.toMatchObject({
      reason: 'not_installed',
    });
  });

  it('runs at most two processes for twenty simultaneous requests', async () => {
    let live = 0;
    let peak = 0;
    let spawned = 0;
    const finishers: Array<() => void> = [];
    const spawn: SpawnLike = (...args) => {
      spawned += 1;
      live += 1;
      peak = Math.max(peak, live);
      return fakeSpawn((child, stdout) => {
        finishers.push(() => {
          live -= 1;
          stdout.emit('data', JSON.stringify({ structured_output: GOOD_DRAFT }));
          child.emit('close', 0);
        });
      })(...args);
    };
    const provider = providerWith(spawn);
    const calls = Array.from({ length: 20 }, () =>
      provider.draft(REQUEST).then(
        () => 'ok',
        (e: unknown) => (e instanceof CopilotFailure ? e.reason : 'other'),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    while (finishers.length > 0) {
      finishers.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    const settled = await Promise.all(calls);
    expect(peak).toBeLessThanOrEqual(2);
    expect(spawned).toBe(4);
    expect(settled.filter((r) => r === 'busy')).toHaveLength(16);
  });
});

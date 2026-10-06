import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  CLI_CONCURRENCY,
  CLI_COOLDOWN_MS,
  CLI_WINDOW_FAILURES as CLI_FAILURE_THRESHOLD,
  CLI_MAX_CALLS_PER_HOUR,
  CLI_WINDOW,
  CLI_MAX_OUTPUT_BYTES,
  CLI_QUEUE,
  CLI_TIMEOUT_MS,
  readProviderSetting,
} from '@/lib/depot/copilot/config';
import type { ChildLike, SpawnLike } from '@/lib/depot/copilot/cli/run';
import {
  assertUsableBinary,
  binaryProblem,
  type BinaryFs,
  type StatLike,
} from '@/lib/depot/copilot/providers/binary';
import {
  createClaudeCliProvider,
  isAbsoluteBinary,
  type ClaudeCliDeps,
} from '@/lib/depot/copilot/providers/claudeCli';
import { createScriptedProvider } from '@/lib/depot/copilot/providers/scripted';
import {
  createCopilotEngine,
  UNAVAILABLE_DRAFT,
  type CopilotEngine,
} from '@/lib/depot/copilot/resolve';
import { createCallLimiter } from '@/lib/depot/copilot/limiter';
import { renderDraft } from '@/lib/depot/copilot/render';
import { logDepotError } from '@/lib/depot/log';

vi.mock('@/lib/depot/log', () => ({ logDepotError: vi.fn() }));
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

  it.each(['not_installed', 'not_authenticated', 'usage_limit', 'error'] as const)(
    'falls back to scripted on %s and starts the cool-down at once',
    async (reason) => {
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
    },
  );

  describe.each(['timeout', 'invalid_output'] as const)('repeated %s', (reason) => {
    it('falls back each time but cools down only after the threshold of consecutive failures', async () => {
      const cli = cliThatFails(reason);
      const { instance } = engine(cli);
      for (let i = 0; i < CLI_FAILURE_THRESHOLD; i += 1) {
        expect(await instance.generate(REQUEST)).toMatchObject({
          fellBack: true,
          fallbackReason: reason,
        });
      }
      expect((await instance.generate(REQUEST)).fallbackReason).toBe('cooling_down');
      expect(cli.draft).toHaveBeenCalledTimes(CLI_FAILURE_THRESHOLD);
    });
  });

  it('retries the CLI once the cool-down has expired', async () => {
    const cli = cliThatFails('usage_limit');
    const { instance, advance } = engine(cli);
    await instance.generate(REQUEST);
    advance(999);
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('cooling_down');
    advance(1);
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('usage_limit');
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

  it('logs every CLI fallback with its reason only, never the detail or the error text', async () => {
    const log = vi.mocked(logDepotError);
    const cases: ReadonlyArray<[CopilotProvider, string]> = [
      [cliThatFails('timeout'), 'claude-cli fell back: timeout'],
      [cliThatFails('busy'), 'claude-cli fell back: busy'],
      [
        {
          id: 'claude-cli',
          draft: vi.fn(async () => {
            throw new Error('secret /Users/x/.claude token=abc');
          }),
        },
        'claude-cli fell back: error',
      ],
      [
        cliThatReturns({ headline: 'H', paragraphs: ['About 5 buses.'] }),
        'claude-cli fell back: rejected_draft',
      ],
    ];
    for (const [cli, line] of cases) {
      log.mockClear();
      await engine(cli).instance.generate(REQUEST);
      expect(log.mock.calls).toEqual([['copilot', line]]);
    }
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
});

describe('rolling breaker, budget and fixed fallback', () => {
  const rejectedDraft: CopilotDraft = { headline: 'Head', paragraphs: ['About 5 buses.'] };

  it('counts rejected drafts as failures and cools down at the window threshold', async () => {
    const cli = cliThatReturns(rejectedDraft);
    const { instance } = engine(cli);
    for (let i = 0; i < CLI_FAILURE_THRESHOLD; i += 1) {
      expect((await instance.generate(REQUEST)).fallbackReason).toBe('rejected_draft');
    }
    expect((await instance.generate(REQUEST)).fallbackReason).toBe('cooling_down');
    expect(cli.draft).toHaveBeenCalledTimes(CLI_FAILURE_THRESHOLD);
  });

  /** A CLI that fails (F) or succeeds (S) in the given order, one letter per call. */
  const scriptedCli = (sequence: string): CopilotProvider => {
    let call = 0;
    return {
      id: 'claude-cli',
      draft: vi.fn(async () => (sequence[call++] === 'F' ? rejectedDraft : GOOD_DRAFT)),
    };
  };
  const outcomes = async (instance: CopilotEngine, calls: number): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < calls; i += 1) {
      out.push((await instance.generate(REQUEST)).fallbackReason ?? 'ok');
    }
    return out;
  };

  it('is not reset by an interleaved success', async () => {
    expect([CLI_WINDOW, CLI_FAILURE_THRESHOLD]).toEqual([10, 5]);
    const cli = scriptedCli('FSFFFF');
    const { instance } = engine(cli);
    expect(await outcomes(instance, 7)).toEqual([
      'rejected_draft',
      'ok',
      'rejected_draft',
      'rejected_draft',
      'rejected_draft',
      'rejected_draft', // fifth failure in the last ten attempts: the cool-down starts
      'cooling_down',
    ]);
    expect(cli.draft).toHaveBeenCalledTimes(6);
  });

  it('forgets an attempt once it is more than ten attempts old', async () => {
    // F F F F, then seven successes: the first F leaves the window, so the next
    // failure makes four in the window, not five, and the next call still runs.
    const cli = scriptedCli('FFFFSSSSSSSFS');
    const { instance } = engine(cli);
    const out = await outcomes(instance, 13);
    expect(out).not.toContain('cooling_down');
    expect(out.slice(-2)).toEqual(['rejected_draft', 'ok']);
    expect(cli.draft).toHaveBeenCalledTimes(13);
  });

  it('clears the window when a cool-down starts', async () => {
    const cli = scriptedCli('FFFFF' + 'FFFF' + 'F');
    const { instance, advance } = engine(cli);
    await outcomes(instance, 5);
    advance(1000);
    // Four failures after the cool-down do not start another: the window was cleared.
    expect(await outcomes(instance, 4)).toEqual(Array(4).fill('rejected_draft'));
    expect(await outcomes(instance, 2)).toEqual(['rejected_draft', 'cooling_down']);
  });

  it.each(['budget_exhausted', 'request_rejected'] as const)(
    '%s falls back without a cool-down or counting as an attempt',
    async (reason) => {
      const cli = cliThatFails(reason);
      const { instance } = engine(cli);
      for (let i = 0; i < CLI_WINDOW * 2; i += 1) {
        expect((await instance.generate(REQUEST)).fallbackReason).toBe(reason);
      }
      expect(cli.draft).toHaveBeenCalledTimes(CLI_WINDOW * 2);
    },
  );

  it('returns the fixed text, logging the reason, when the scripted draft cannot render', async () => {
    const bad: CopilotRequest = {
      ...REQUEST,
      task: 'rationale',
      scriptedDraft: { headline: 'Head', paragraphs: ['Has 7 digits'] },
    };
    const out = await engine(null).instance.generate(bad);
    expect(out).toMatchObject({
      headline: UNAVAILABLE_DRAFT.headline,
      provider: 'scripted',
      fellBack: false,
      fallbackReason: 'scripted_unavailable',
    });
    expect(logDepotError).toHaveBeenCalledWith('copilot', expect.stringContaining('rationale'));
    const viaCli = await engine(cliThatFails('timeout')).instance.generate(bad);
    expect(viaCli).toMatchObject({ fellBack: true, fallbackReason: 'scripted_unavailable' });
    expect(renderDraft(UNAVAILABLE_DRAFT, [])).toMatchObject({ ok: true });
  });

  it('limits calls per hour and per day on a sliding window', () => {
    let clock = 0;
    const limiter = createCallLimiter({ now: () => clock, perHour: 2, perDay: 3 });
    expect(limiter.tryAcquire()).toBe(true); // t=0
    clock = 10;
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // hour full
    clock = 3_600_000 - 1;
    expect(limiter.tryAcquire()).toBe(false);
    clock = 3_600_000; // the t=0 call ages out exactly now
    expect(limiter.tryAcquire()).toBe(true);
    clock = 7_300_000;
    expect(limiter.tryAcquire()).toBe(false); // daily cap of three reached
    clock = 86_400_000;
    expect(limiter.tryAcquire()).toBe(true);
    expect(CLI_MAX_CALLS_PER_HOUR).toBe(30);
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
      stdout: { on: (e: string, l: (c: string) => void) => stdout.on(e, l) },
      stderr: { on: (e: string, l: (c: string) => void) => stderr.on(e, l) },
      on: (event: string, l: (...a: never[]) => void) => emitter.on(event, l as () => void),
      kill: () => true,
    } as unknown as ChildLike;
    queueMicrotask(() => script(emitter, stdout, stderr));
    return child;
  };
}

const SAFE_FILE: StatLike = { isFile: true, mode: 0o100755 };
const SAFE_DIR: StatLike = { isFile: false, mode: 0o40755 };

/** A file system with one link, one binary and its directory; every call is recorded. */
function fakeFs(file: StatLike = SAFE_FILE, dir: StatLike = SAFE_DIR) {
  const calls: string[] = [];
  const fs: BinaryFs = {
    realpath: (path) => {
      calls.push(`realpath ${path}`);
      if (path === '/usr/local/bin/claude') return '/opt/claude/2.1/claude';
      if (path === '/opt/claude/2.1/claude') return path;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
    stat: (path) => {
      calls.push(`stat ${path}`);
      if (path === '/opt/claude/2.1/claude') return file;
      if (path === '/opt/claude/2.1') return dir;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
  };
  return { fs, calls };
}

const providerWith = (
  spawn: SpawnLike,
  env: Record<string, string | undefined> = {},
  extra: Partial<ClaudeCliDeps> = {},
) =>
  createClaudeCliProvider({
    spawn,
    bin: '/usr/local/bin/claude',
    model: 'sonnet',
    home: '/tmp/home',
    cwd: () => '/tmp/empty',
    env,
    nodeDir: '/opt/node/bin',
    fs: fakeFs().fs,
    ...extra,
  });

describe('binaryProblem', () => {
  it('accepts an executable file in a directory only its owner can write', () => {
    expect(binaryProblem(SAFE_FILE, SAFE_DIR)).toBeNull();
  });

  it.each([
    ['a directory', { isFile: false, mode: 0o40755 }, SAFE_DIR],
    ['a file nobody can execute', { isFile: true, mode: 0o100644 }, SAFE_DIR],
    ['a group-writable file', { isFile: true, mode: 0o100775 }, SAFE_DIR],
    ['a world-writable file', { isFile: true, mode: 0o100757 }, SAFE_DIR],
    ['a group-writable directory', SAFE_FILE, { isFile: false, mode: 0o40775 }],
    ['a world-writable sticky directory', SAFE_FILE, { isFile: false, mode: 0o41777 }],
  ] as const)('rejects %s', (_name, file, dir) => {
    expect(binaryProblem(file, dir)).toEqual(expect.any(String));
  });
});

describe('assertUsableBinary', () => {
  it('resolves the real path and checks the target and its directory, not the link', () => {
    const { fs, calls } = fakeFs();
    expect(assertUsableBinary('/usr/local/bin/claude', fs)).toBe('/opt/claude/2.1/claude');
    expect(calls).toEqual([
      'realpath /usr/local/bin/claude',
      'stat /opt/claude/2.1/claude',
      'stat /opt/claude/2.1',
    ]);
  });

  it('rejects a relative path without touching the file system', () => {
    const { fs, calls } = fakeFs();
    for (const bin of ['claude', './claude', '', 'bin/claude', '/usr/bin/cl\0aude']) {
      expect(() => assertUsableBinary(bin, fs)).toThrow(/absolute/i);
    }
    expect(calls).toEqual([]);
  });

  it('rejects an unsafe target and a missing file', () => {
    const writable = fakeFs(SAFE_FILE, { isFile: false, mode: 0o40777 }).fs;
    expect(() => assertUsableBinary('/usr/local/bin/claude', writable)).toThrow(/writable/i);
    const notFile = fakeFs({ isFile: false, mode: 0o40755 }).fs;
    expect(() => assertUsableBinary('/usr/local/bin/claude', notFile)).toThrow(/not a file/i);
    expect(() => assertUsableBinary('/nowhere/claude', fakeFs().fs)).toThrow(/ENOENT/);
  });
});

describe('createClaudeCliProvider', () => {
  it('verifies the binary at construction and spawns its real path', async () => {
    const spawn = vi.fn<SpawnLike>(
      fakeSpawn((child, stdout) => {
        stdout.emit('data', JSON.stringify({ structured_output: GOOD_DRAFT }));
        child.emit('close', 0);
      }),
    );
    await providerWith(spawn).draft(REQUEST);
    expect(spawn.mock.calls[0]?.[0]).toBe('/opt/claude/2.1/claude');
    const unsafe = fakeFs({ isFile: true, mode: 0o100777 }).fs;
    expect(() => providerWith(spawn, {}, { fs: unsafe })).toThrow(/writable/i);
  });

  it('spends no budget and spawns nothing for a request over the prompt cap', async () => {
    const spawn = vi.fn<SpawnLike>(fakeSpawn(() => undefined));
    const tryAcquire = vi.fn(() => true);
    const wide = '\u{1F68C}'.repeat(200);
    const facts = Array.from({ length: 60 }, (_, i) => ({
      id: `f${i}`,
      label: wide,
      text: wide,
      provenance: 'live' as const,
    }));
    const provider = providerWith(spawn, {}, { limiter: { tryAcquire } });
    await expect(provider.draft({ ...REQUEST, facts })).rejects.toMatchObject({
      reason: 'request_rejected',
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(tryAcquire).not.toHaveBeenCalled();
  });

  it('rejects an unknown task as request_rejected, spending nothing', async () => {
    const spawn = vi.fn<SpawnLike>(fakeSpawn(() => undefined));
    const tryAcquire = vi.fn(() => true);
    const provider = providerWith(spawn, {}, { limiter: { tryAcquire } });
    const bogus = { ...REQUEST, task: 'bogus' } as unknown as CopilotRequest;
    await expect(provider.draft(bogus)).rejects.toMatchObject({ reason: 'request_rejected' });
    expect(spawn).not.toHaveBeenCalled();
    expect(tryAcquire).not.toHaveBeenCalled();
    expect(CLI_MAX_BUDGET_USD).toBe(0.25);
  });

  it('reports budget_exhausted without spawning when the call budget is used', async () => {
    const spawn = vi.fn<SpawnLike>(fakeSpawn(() => undefined));
    const provider = providerWith(spawn, {}, { limiter: { tryAcquire: () => false } });
    await expect(provider.draft(REQUEST)).rejects.toMatchObject({ reason: 'budget_exhausted' });
    expect(spawn).not.toHaveBeenCalled();
  });

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
    expect(options?.env).toEqual({ PATH: '/usr/bin:/bin:/opt/node/bin', HOME: '/tmp/home' });
    expect(options?.cwd).toBe('/tmp/empty');
  });

  it('rejects a relative or empty binary path at construction', () => {
    const spawn = fakeSpawn(() => undefined);
    for (const bin of ['claude', './claude', '', 'bin/claude']) {
      expect(() =>
        createClaudeCliProvider({
          spawn,
          bin,
          model: 'sonnet',
          home: '/h',
          cwd: () => '/c',
          env: {},
          nodeDir: '/n',
        }),
      ).toThrow(/absolute/i);
    }
    expect(isAbsoluteBinary('/usr/bin/claude')).toBe(true);
    expect(isAbsoluteBinary('claude')).toBe(false);
  });

  it('rejects an invalid model name at construction', () => {
    expect(() =>
      createClaudeCliProvider({
        spawn: fakeSpawn(() => undefined),
        bin: '/usr/bin/claude',
        model: '--evil',
        home: '/h',
        cwd: () => '/c',
        env: {},
        nodeDir: '/n',
      }),
    ).toThrow(RangeError);
  });

  it('reports invalid_output, not a limit or auth failure, when model text says so', async () => {
    const spawn = fakeSpawn((child, stdout) => {
      stdout.emit(
        'data',
        JSON.stringify({
          is_error: false,
          result: 'quota exceeded, please log in',
          structured_output: { headline: 1 },
        }),
      );
      child.emit('close', 0);
    });
    await expect(providerWith(spawn).draft(REQUEST)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
    const raw = fakeSpawn((child, stdout) => {
      stdout.emit('data', 'quota exceeded, please log in');
      child.emit('close', 0);
    });
    await expect(providerWith(raw).draft(REQUEST)).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('fails with error, without spawning, when the request has too many facts', async () => {
    const spawn = vi.fn<SpawnLike>(fakeSpawn(() => undefined));
    const facts = Array.from({ length: 61 }, (_, i) => ({
      id: `f${i}`,
      label: 'l',
      text: 't',
      provenance: 'live' as const,
    }));
    await expect(providerWith(spawn).draft({ ...REQUEST, facts })).rejects.toMatchObject({
      reason: 'request_rejected',
    });
    expect(spawn).not.toHaveBeenCalled();
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

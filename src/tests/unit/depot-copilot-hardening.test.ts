import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  runCli,
  type ChildLike,
  type RunCliInput,
  type SpawnLike,
} from '@/lib/depot/copilot/cli/run';
import { createCallLimiter } from '@/lib/depot/copilot/limiter';
import { MAX_COMBINING_MARKS } from '@/lib/depot/copilot/limits';
import { assertUsableBinary, type BinaryFs } from '@/lib/depot/copilot/providers/binary';
import {
  createClaudeCliProvider,
  type ClaudeCliDeps,
} from '@/lib/depot/copilot/providers/claudeCli';
import { sanitizeFactText } from '@/lib/depot/copilot/render';
import { createCopilotEngine, UNAVAILABLE_DRAFT } from '@/lib/depot/copilot/resolve';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotProvider,
  type CopilotRequest,
} from '@/lib/depot/copilot/types';

vi.mock('@/lib/depot/log', () => ({ logDepotError: vi.fn() }));

const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'Network',
  facts: [{ id: 'buses', label: 'Buses', text: '1,204', provenance: 'live' }],
  guidance: 'Be brief.',
  scriptedDraft: { headline: 'Network briefing', paragraphs: ['Fleet is {{fact:buses}}.'] },
};
const OUTPUT = JSON.stringify({
  structured_output: { headline: 'Fleet headline', paragraphs: ['The fleet is {{fact:buses}}.'] },
});

function fakeChild(pid: number | undefined = 4242) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  return child as typeof child & ChildLike;
}
const INPUT: RunCliInput = {
  bin: '/opt/claude/claude',
  args: ['-p'],
  env: { PATH: '/usr/bin' },
  cwd: '/tmp/empty',
  stdin: 'prompt',
  timeoutMs: 50,
  maxOutputBytes: 10,
};

describe('fact text', () => {
  it('strips default-ignorable characters and caps combining marks', () => {
    expect(sanitizeFactText('A\u{E0100}\u{E0101}B')).toBe('AB');
    expect(sanitizeFactText('Aᅟ᠋᠌᠍᠏B')).toBe('AB');
    const stacked = Array.from(sanitizeFactText(`a${'́'.repeat(30)}`));
    expect(stacked.length).toBeLessThanOrEqual(1 + MAX_COMBINING_MARKS);
  });
});

describe('process control', () => {
  it('spawns detached and kills the whole group on timeout', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child) as unknown as SpawnLike;
    const killGroup = vi.fn();
    const result = await runCli(INPUT, spawn, killGroup);
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({ detached: true, shell: false });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(killGroup).toHaveBeenCalledWith(4242);
  });

  it('kills the group when output exceeds the cap', async () => {
    const child = fakeChild();
    const killGroup = vi.fn();
    const promise = runCli({ ...INPUT, timeoutMs: 5000 }, () => child, killGroup);
    child.stdout.emit('data', Buffer.alloc(11));
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'invalid_output' });
    expect(killGroup).toHaveBeenCalledWith(4242);
  });

  it('kills the group on abort, and never spawns for an already aborted signal', async () => {
    const child = fakeChild();
    const killGroup = vi.fn();
    const controller = new AbortController();
    const promise = runCli(
      { ...INPUT, timeoutMs: 5000, signal: controller.signal },
      () => child,
      killGroup,
    );
    controller.abort();
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'request_rejected' });
    expect(killGroup).toHaveBeenCalledWith(4242);
    const spawn = vi.fn(() => fakeChild());
    await runCli({ ...INPUT, signal: controller.signal }, spawn, killGroup);
    expect(spawn).not.toHaveBeenCalled();
  });
});

const SAFE: BinaryFs = {
  realpath: (path) => path,
  stat: (path) =>
    path.endsWith('claude')
      ? { isFile: true, mode: 0o100755, uid: 0 }
      : { isFile: false, mode: 0o40755, uid: 0 },
};
const deps = (extra: Partial<ClaudeCliDeps> = {}): ClaudeCliDeps => ({
  spawn: () => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(OUTPUT));
      child.emit('close', 0);
    });
    return child;
  },
  bin: '/opt/claude/claude',
  model: 'sonnet',
  home: '/tmp/copilot-home',
  cwd: () => '/tmp/copilot-empty',
  env: {},
  nodeDir: '/opt/node/bin',
  fs: SAFE,
  repoRoot: '/srv/app',
  semaphore: createSemaphore(1, 1),
  limiter: createCallLimiter({ now: () => 0, perHour: 5, perDay: 5 }),
  ...extra,
});

describe('provider factory', () => {
  it('requires a shared semaphore and limiter', () => {
    const rest = { ...deps(), semaphore: undefined, limiter: undefined } as unknown;
    expect(() => createClaudeCliProvider(rest as ClaudeCliDeps)).toThrow(/semaphore and limiter/);
  });

  it('refuses a HOME or working directory that is relative or inside the repository', async () => {
    expect(() => createClaudeCliProvider(deps({ home: 'home' }))).toThrow(/HOME/);
    expect(() => createClaudeCliProvider(deps({ home: '/srv/app/tmp' }))).toThrow(/HOME/);
    const provider = createClaudeCliProvider(deps({ cwd: () => '/srv/app/work' }));
    await expect(provider.draft(REQUEST)).rejects.toMatchObject({ reason: 'error' });
  });

  it('re-verifies the binary on every call, so a replaced file is picked up', async () => {
    let real = '/opt/claude/v1/claude';
    const fs: BinaryFs = { realpath: () => real, stat: SAFE.stat };
    const spawned: string[] = [];
    const base = deps();
    const provider = createClaudeCliProvider({
      ...base,
      fs,
      spawn: (bin, args, options) => {
        spawned.push(bin);
        return base.spawn(bin, args, options);
      },
    });
    await provider.draft(REQUEST);
    real = '/opt/claude/v2/claude';
    await provider.draft(REQUEST);
    expect(spawned).toEqual(['/opt/claude/v1/claude', '/opt/claude/v2/claude']);
  });

  it('reports a fixed message with no path, and refuses a foreign owner', () => {
    const missing: BinaryFs = {
      realpath: () => {
        throw new Error("ENOENT: no such file or directory, lstat '/secret/claude'");
      },
      stat: SAFE.stat,
    };
    expect(() => assertUsableBinary('/secret/claude', missing)).toThrow(
      /^The Claude binary is missing/,
    );
    expect(() => assertUsableBinary('/secret/claude', missing)).not.toThrow(/secret|ENOENT/);
    const foreign: BinaryFs = { ...SAFE, stat: (p) => ({ ...SAFE.stat(p), uid: 777 }) };
    expect(() => assertUsableBinary('/opt/claude/claude', foreign, 501)).toThrow(/owner/);
    expect(assertUsableBinary('/opt/claude/claude', foreign, 777)).toBe('/opt/claude/claude');
  });
});

describe('engine', () => {
  const failing = (reason: 'error' | 'usage_limit'): CopilotProvider => ({
    id: 'claude-cli',
    draft: vi.fn(async () => {
      throw new CopilotFailure(reason);
    }),
  });
  const build = (cli: CopilotProvider, scripted?: CopilotProvider) => {
    const clock = { wall: 1_000_000, mono: 0 };
    const engine = createCopilotEngine({
      setting: 'auto',
      cli,
      scripted: scripted ?? { id: 'scripted', draft: async (r) => r.scriptedDraft },
      now: () => clock.wall,
      monotonicNow: () => clock.mono,
      cooldownMs: 1000,
    });
    return { engine, clock };
  };

  it('counts an unclassified error in the window instead of cooling down at once', async () => {
    const cli = failing('error');
    const { engine } = build(cli);
    await engine.generate(REQUEST);
    expect((await engine.generate(REQUEST)).fallbackReason).toBe('error');
    expect(cli.draft).toHaveBeenCalledTimes(2);
  });

  it('cools down on the monotonic clock, whatever the wall clock does', async () => {
    const cli = failing('usage_limit');
    const { engine, clock } = build(cli);
    await engine.generate(REQUEST);
    clock.wall += 10_000_000; // a wall-clock jump must not end the cool-down
    expect((await engine.generate(REQUEST)).fallbackReason).toBe('cooling_down');
    clock.mono += 1001;
    expect((await engine.generate(REQUEST)).fallbackReason).toBe('usage_limit');
  });

  it('passes the abort signal to the provider', async () => {
    const draft = vi.fn(async () => REQUEST.scriptedDraft);
    const { engine } = build({ id: 'claude-cli', draft });
    const { signal } = new AbortController();
    await engine.generate(REQUEST, signal);
    expect(draft).toHaveBeenCalledWith(REQUEST, signal);
  });

  it('returns the fixed unavailable draft when the scripted path throws', async () => {
    const thrower: CopilotProvider = {
      id: 'scripted',
      draft: async () => {
        throw new Error('boom');
      },
    };
    const text = await build(failing('error'), thrower).engine.generate(REQUEST);
    expect(text).toMatchObject({
      headline: UNAVAILABLE_DRAFT.headline,
      fallbackReason: 'scripted_unavailable',
    });
    const broken = {
      ...REQUEST,
      facts: [{ ...REQUEST.facts[0], text: undefined }],
    } as unknown as CopilotRequest;
    await expect(build(failing('error')).engine.generate(broken)).resolves.toMatchObject({
      fallbackReason: 'scripted_unavailable',
    });
  });

  it('runs the limiter on a monotonic clock by default', () => {
    const wall = vi.spyOn(Date, 'now').mockReturnValue(0);
    const limiter = createCallLimiter({ perHour: 1, perDay: 5 });
    expect(limiter.tryAcquire()).toBe(true);
    wall.mockReturnValue(86_400_000 * 2); // a wall-clock jump forward refills nothing
    expect(limiter.tryAcquire()).toBe(false);
    wall.mockRestore();
  });
});

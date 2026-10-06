// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BinaryFs } from '@/lib/depot/copilot/providers/binary';
import type { SpawnLike } from '@/lib/depot/copilot/cli/run';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import { CopilotFailure, type CopilotRequest } from '@/lib/depot/copilot/types';
import { createCliProvider, type CliFactoryDeps } from '@/lib/depot/copilot/service/cliFactory';

/**
 * The CLI provider is built once, at engine construction. Nothing here runs the
 * real `claude` command: the file system and `spawn` are fakes that record calls.
 */

const okFs: BinaryFs = {
  realpath: (path) => path,
  stat: (path) => ({ isFile: path.endsWith('claude'), mode: 0o755 }),
};
const throwingFs: BinaryFs = {
  realpath: () => {
    throw new Error('ENOENT: no such file /opt/secret/claude');
  },
  stat: () => ({ isFile: true, mode: 0o755 }),
};

const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'the network',
  facts: [{ id: 'a', label: 'A', text: '12', provenance: 'live' }],
  guidance: 'g',
  scriptedDraft: { headline: 'H', paragraphs: ['{{fact:a}}'] },
};

let errorSpy: ReturnType<typeof vi.spyOn>;
let spawn: ReturnType<typeof vi.fn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  spawn = vi.fn(() => {
    throw new Error('spawn must not be called');
  });
});
afterEach(() => errorSpy.mockRestore());

function deps(over: Partial<CliFactoryDeps> = {}): CliFactoryDeps {
  return {
    env: { CLAUDE_BIN: '/usr/local/bin/claude', DEPOT_COPILOT_PROVIDER: 'auto' },
    spawn: spawn as unknown as SpawnLike,
    fs: okFs,
    makeDir: vi.fn(() => '/tmp/depot-copilot-x'),
    semaphore: createSemaphore(2, 2),
    limiter: { tryAcquire: () => true },
    ...over,
  };
}

describe('createCliProvider', () => {
  it('is null for the scripted setting, without touching the file system', () => {
    const fs = { realpath: vi.fn(), stat: vi.fn() };
    const made = deps({
      env: { CLAUDE_BIN: '/usr/local/bin/claude', DEPOT_COPILOT_PROVIDER: 'scripted' },
      fs,
    });
    expect(createCliProvider(made)).toBeNull();
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(made.makeDir).not.toHaveBeenCalled();
  });

  it('is null when no binary is configured', () => {
    expect(createCliProvider(deps({ env: {} }))).toBeNull();
  });

  it('catches a missing or unsafe binary once and logs a reason code only', () => {
    expect(createCliProvider(deps({ fs: throwingFs }))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toBe('[depot:copilot-api] cli_unavailable');
  });

  it('catches an invalid model name the same way', () => {
    const env = { CLAUDE_BIN: '/usr/local/bin/claude', DEPOT_COPILOT_MODEL: '--dangerous' };
    expect(createCliProvider(deps({ env }))).toBeNull();
  });

  it('builds a provider that spends the shared hourly and daily budget', async () => {
    const provider = createCliProvider(deps({ limiter: { tryAcquire: () => false } }));
    expect(provider?.id).toBe('claude-cli');
    await expect(provider!.draft(REQUEST)).rejects.toEqual(
      new CopilotFailure('budget_exhausted', 'call budget used'),
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

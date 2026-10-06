// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SHOWN_SETTING_CHARS,
  readProviderSetting,
  unrecognisedProviderSetting,
} from '@/lib/depot/copilot/config';
import { getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';

/**
 * A writer setting the server does not recognise is a typo for an operator who meant to
 * choose: it selects the scripted writer (the safe side) and says so once in the log, in a
 * short, safe form of the value.
 */

const RUNTIME_KEY = Symbol.for('olympuss.depot.copilotRuntime');
type Holder = typeof globalThis & { [RUNTIME_KEY]?: unknown };
const forgetRuntime = (): void => {
  delete (globalThis as Holder)[RUNTIME_KEY];
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  forgetRuntime();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
  forgetRuntime();
});

const logLines = (): string[] => errorSpy.mock.calls.map((c) => String(c[0]));

describe('an unrecognised writer setting', () => {
  it.each(['script', 'Scripted', 'claude', 'off'])('reads %s as scripted', (value) => {
    expect(readProviderSetting({ DEPOT_COPILOT_PROVIDER: value })).toBe('scripted');
  });

  it('is shown only when set and unrecognised', () => {
    expect(unrecognisedProviderSetting({})).toBeNull();
    expect(unrecognisedProviderSetting({ DEPOT_COPILOT_PROVIDER: '' })).toBeNull();
    for (const value of ['auto', 'claude-cli', 'scripted']) {
      expect(unrecognisedProviderSetting({ DEPOT_COPILOT_PROVIDER: value })).toBeNull();
    }
    expect(unrecognisedProviderSetting({ DEPOT_COPILOT_PROVIDER: 'Scripted' })).toBe('Scripted');
  });

  it('is shown short, on one line, in safe characters only', () => {
    const value = `ab"c\n[depot:x] forged ${'y'.repeat(200)}TAIL`;
    const shown = unrecognisedProviderSetting({ DEPOT_COPILOT_PROVIDER: value }) ?? '';
    expect(shown.length).toBeLessThanOrEqual(MAX_SHOWN_SETTING_CHARS + 1);
    expect(shown).toMatch(/^[A-Za-z0-9._?-]+…?$/);
    expect(shown).not.toContain('TAIL');
  });

  it('is logged once, when the runtime is first built, and Claude is not used', () => {
    vi.stubEnv('DEPOT_COPILOT_PROVIDER', 'Scripted');
    vi.stubEnv('CLAUDE_BIN', '/usr/local/bin/claude');
    const runtime = getCopilotRuntime();
    getCopilotRuntime();
    expect(runtime.usesClaude).toBe(false);
    expect(runtime.claudeExpected).toBe(false);
    expect(logLines()).toEqual([
      '[depot:copilot-api] provider_setting_unrecognised: "Scripted"; the scripted writer is used',
    ]);
  });

  it('logs nothing for a recognised setting', () => {
    vi.stubEnv('DEPOT_COPILOT_PROVIDER', 'scripted');
    getCopilotRuntime();
    expect(logLines()).toEqual([]);
  });
});

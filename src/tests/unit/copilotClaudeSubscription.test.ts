// @vitest-environment node
//
// The copilot's model adapter now authenticates with the operator's Claude
// subscription (a `claude setup-token` OAuth token in CLAUDE_CODE_OAUTH_TOKEN)
// driven through the `claude` CLI, rather than a metered ANTHROPIC_API_KEY.
//
// These assertions are the ones that would actually cost something if they
// regressed: that a missing or expired credential fails closed with an honest
// message instead of producing text, that the token travels in the child's env
// and never in argv (argv is world-readable via `ps`), that an
// ANTHROPIC_API_KEY left in the server environment cannot silently take
// precedence and move the call onto per-token billing, and that no error path
// echoes the credential back to the caller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { generateCopilotText } from '@/lib/copilot/claudeSubscription';

interface FakeChildOptions {
  stdout?: string;
  stderr?: string;
  code?: number;
  spawnError?: NodeJS.ErrnoException;
}

/** Minimal stand-in for the ChildProcess surface the adapter actually uses. */
function fakeChild(options: FakeChildOptions) {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdinWrites: string[] = [];

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), {
    end: (data: string) => {
      stdinWrites.push(data);
    },
  });
  child.kill = vi.fn();
  child.stdinWrites = stdinWrites;

  setImmediate(() => {
    if (options.spawnError) {
      child.emit('error', options.spawnError);
      return;
    }
    if (options.stdout) (child.stdout as EventEmitter).emit('data', Buffer.from(options.stdout));
    if (options.stderr) (child.stderr as EventEmitter).emit('data', Buffer.from(options.stderr));
    child.emit('close', options.code ?? 0);
  });

  return child;
}

function successPayload(text: string): string {
  return JSON.stringify({ is_error: false, api_error_status: null, result: text, subtype: 'success' });
}

/** The shape the CLI really prints on a rejected credential — captured from a
 *  live run against an invalid token, not invented. Note `subtype` stays
 *  "success" even here, which is why the adapter keys off is_error/status. */
function authFailurePayload(status: number): string {
  return JSON.stringify({
    is_error: true,
    api_error_status: status,
    subtype: 'success',
    terminal_reason: 'api_error',
    result: `Failed to authenticate. API Error: ${status} OAuth access token is invalid.`,
  });
}

const ORIGINAL_ENV = { ...process.env };

function lastSpawnCall() {
  const call = spawnMock.mock.calls.at(-1);
  if (!call) throw new Error('spawn was not called');
  return {
    command: call[0] as string,
    args: call[1] as string[],
    options: call[2] as { env: NodeJS.ProcessEnv; cwd: string },
  };
}

describe('generateCopilotText (Claude subscription)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.CLAUDE_CLI_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fails closed, without invoking the CLI, when no subscription credential is configured', async () => {
    const result = await generateCopilotText({ system: 'sys', prompt: 'hello' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    // The important half: it must not have tried, and must not have produced text.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns the model text on success', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('Bus 42 bunched at 14:05.') }));

    const result = await generateCopilotText({ system: 'sys', prompt: 'What happened?' });

    expect(result).toEqual({ ok: true, text: 'Bus 42 bunched at 14:05.', model: 'claude-sonnet-4-5' });
  });

  it('passes the credential in the child environment and never in argv', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('ok') }));

    await generateCopilotText({ system: 'sys', prompt: 'question' });

    const { args, options } = lastSpawnCall();
    expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-test-token');
    expect(args.join(' ')).not.toContain('sk-ant-oat01-test-token');
  });

  it('sends the grounded prompt over stdin rather than argv', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    let child: (EventEmitter & Record<string, unknown>) | undefined;
    spawnMock.mockImplementation(() => {
      child = fakeChild({ stdout: successPayload('ok') });
      return child;
    });

    await generateCopilotText({ system: 'sys', prompt: 'incident evidence for vehicle 42' });

    expect(child?.stdinWrites).toEqual(['incident evidence for vehicle 42']);
    expect(lastSpawnCall().args).not.toContain('incident evidence for vehicle 42');
  });

  it('strips ANTHROPIC_API_KEY from the child so it can never take precedence over the subscription', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-should-not-be-used';
    process.env.ANTHROPIC_AUTH_TOKEN = 'shadow-token';
    process.env.ANTHROPIC_BASE_URL = 'https://attacker.example';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('ok') }));

    await generateCopilotText({ system: 'sys', prompt: 'question' });

    const { options } = lastSpawnCall();
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(options.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('reports an expired or revoked credential as its own actionable failure', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-expired';
    spawnMock.mockImplementation(() => fakeChild({ stdout: authFailurePayload(401), code: 1 }));

    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/401/);
      expect(result.error).toMatch(/expired or been revoked/);
      expect(result.error).toMatch(/claude setup-token/);
    }
  });

  it('never echoes the credential back through an error path', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-supersecret';
    // Worst case: the CLI itself quotes the token back in its error text.
    spawnMock.mockImplementation(() =>
      fakeChild({
        stdout: JSON.stringify({
          is_error: true,
          api_error_status: 500,
          result: 'upstream failed for token sk-ant-oat01-supersecret',
        }),
        code: 1,
      }),
    );

    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('sk-ant-oat01-supersecret');
      expect(result.error).toContain('[redacted]');
    }
  });

  it('explains itself when the Claude CLI is not installed on the host', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    const enoent: NodeJS.ErrnoException = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    spawnMock.mockImplementation(() => fakeChild({ spawnError: enoent }));

    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not installed|CLAUDE_CLI_PATH/);
  });

  it('fails closed rather than returning empty text when the model produces nothing', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('   ') }));

    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no text content/);
  });

  it('refuses an oversized prompt before spawning the CLI at all, with a legible product-owned message', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    // One byte over the real "piped stdin input exceeds 10MB" CLI failure
    // this backstop exists to preempt - well within our own lower budget's
    // reach, so this proves the backstop trips before the CLI's own cap
    // would ever be hit.
    const oversizedPrompt = 'x'.repeat(8_000_001);

    const result = await generateCopilotText({ system: 'sys', prompt: oversizedPrompt });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/8\.0MB/);
      expect(result.error).toMatch(/narrow the question/i);
      expect(result.error).not.toMatch(/stdin/i);
    }
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('accepts a prompt right at the budget boundary and still invokes the CLI', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('ok') }));
    const boundaryPrompt = 'x'.repeat(8_000_000);

    const result = await generateCopilotText({ system: 'sys', prompt: boundaryPrompt });

    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('runs with no tools, no ambient MCP servers and no host settings', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    spawnMock.mockImplementation(() => fakeChild({ stdout: successPayload('ok') }));

    await generateCopilotText({ system: 'sys', prompt: 'hi' });

    const { args } = lastSpawnCall();
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
  });
});

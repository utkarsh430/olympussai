/**
 * Claude subscription adapter — the only place the copilot module talks to a
 * model.
 *
 * Auth is the operator's **Claude subscription**, never a metered
 * `ANTHROPIC_API_KEY`. The credential is a Claude Code OAuth token minted with
 * `claude setup-token` and supplied as `CLAUDE_CODE_OAUTH_TOKEN`; we hand it to
 * the `claude` CLI in `--print` mode and read back a single JSON result. This
 * mirrors the approach already proven in the operator's crewban project
 * (`apps/runner/src/claude.ts` there) so the two behave identically — same env
 * var, same CLI mechanism, same API-key strip below.
 *
 * Why the CLI rather than a direct HTTPS call to the Messages API: a
 * subscription OAuth token is what the Claude Code CLI is built to carry. The
 * CLI is the supported consumer of that credential, so the token never has to
 * be hand-assembled into an `Authorization` header against an endpoint whose
 * contract for subscription auth is not a published integration surface.
 *
 * Node runtime only (invoked from route handlers that are already
 * `export const runtime = 'nodejs'`). Never throws: every failure mode
 * (missing credential, expired credential, CLI absent, timeout, non-zero exit,
 * empty response) is reported back as `{ ok: false, error }` so callers can log
 * it to ops_copilot_interactions and surface a clean 503 COPILOT_UNAVAILABLE
 * instead of a 500 — and, critically, instead of a fabricated answer. This
 * product's premise is that it does not invent data; an AI surface that
 * degraded into a plausible guess when its credential expired would be the
 * worst possible violation of that, so there is deliberately no fallback path
 * here that produces text without a successful model call.
 */
import 'server-only';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/** Model id. Auth-independent — this names a model, not a credential. */
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Backstop on `input.prompt` - the only piece of this request that is piped
 * over stdin (see runClaudeCli below) and therefore the only piece subject
 * to the CLI's own hard cap, which fails a request with "piped stdin input
 * exceeds 10MB" rather than any budget of ours. This module's per-source
 * grounding limits (src/lib/copilot/grounding.ts) are meant to keep every
 * real prompt far under this, but that is a property of today's call
 * sites, not something this file can see or enforce on its own - a future
 * grounding source, or a caller that forgets to bound its evidence, would
 * reintroduce the same failure. Checking here, at the one place this
 * module hands text to the CLI, means that mistake fails with a legible,
 * product-owned message instead of the CLI's raw stdin error, and fails
 * BEFORE the child process is even spawned. Set comfortably under the
 * real 10MB limit so this message is the one an operator actually sees.
 */
const MAX_PROMPT_BYTES = 8_000_000;

/**
 * Env vars that must never reach the child. `ANTHROPIC_API_KEY` is the
 * important one: claude-code gives an API key precedence over stored OAuth
 * credentials, so a key left in the server's environment would silently move
 * every copilot call onto per-token billing while this file still claimed to be
 * the subscription path. `ANTHROPIC_AUTH_TOKEN` shadows it the same way, and
 * `ANTHROPIC_BASE_URL` would redirect the whole conversation — grounded
 * incident data included — to a host of the environment's choosing.
 */
const STRIPPED_CHILD_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

export interface CopilotLlmRequest {
  /** Grounding rules + citation contract — never user-controlled. */
  system: string;
  /** The grounded context + question, built by src/lib/copilot/prompts.ts. */
  prompt: string;
  /**
   * Advisory output budget. The `claude` CLI exposes no hard output-token cap,
   * so unlike the previous Messages-API adapter this is expressed to the model
   * as guidance rather than enforced by the transport. Callers that must not
   * over-run should keep their own prompt-level format constraints.
   */
  maxTokens?: number;
}

export type CopilotLlmResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

/** The single JSON object `claude -p --output-format json` prints. */
interface ClaudeCliResult {
  is_error?: boolean;
  result?: string;
  api_error_status?: number | null;
  modelUsage?: Record<string, unknown>;
}

export function resolveCopilotModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.COPILOT_CLAUDE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Strip anything that looks like a credential out of text that may be logged or
 * returned to a caller. Belt-and-braces: the token is never placed in argv and
 * the CLI does not echo it, but an error path must not be the one place a
 * secret escapes, so we scrub the exact token value and any `sk-ant-` shaped
 * string before the text can leave this module.
 */
function redact(text: string): string {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  let scrubbed = text;
  if (token && token.length >= 8) {
    scrubbed = scrubbed.split(token).join('[redacted]');
  }
  return scrubbed.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]');
}

interface CliOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
}

function runClaudeCli(args: string[], prompt: string, token: string, timeoutMs: number): Promise<CliOutcome> {
  return new Promise((resolve) => {
    // Copy the server's env, then remove every credential/endpoint override
    // that would take precedence over the subscription token (see
    // STRIPPED_CHILD_ENV_VARS) before setting the token itself.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const name of STRIPPED_CHILD_ENV_VARS) delete childEnv[name];
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

    const child = spawn(process.env.CLAUDE_CLI_PATH?.trim() || 'claude', args, {
      // Run somewhere inert. The CLI discovers CLAUDE.md, settings and other
      // project context from its working directory; the server's cwd is a
      // deployed application tree, and none of it belongs in a copilot prompt.
      cwd: tmpdir(),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const finish = (outcome: CliOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, timedOut, spawnError: error });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut });
    });

    // The prompt carries grounded operational data, so it goes over stdin
    // rather than argv — argv is world-readable via `ps` on a shared host.
    child.stdin.on('error', () => {
      /* Child exited before the prompt was written; `close` reports the real cause. */
    });
    child.stdin.end(prompt, 'utf8');
  });
}

/**
 * Runs one grounded completion on the operator's Claude subscription and
 * returns the response text. Callers are responsible for logging `input.prompt`
 * and the result to ops_copilot_interactions (this function does not persist
 * anything itself — src/lib/copilot/service.ts owns that so every call site
 * logs consistently, success or failure).
 */
export async function generateCopilotText(input: CopilotLlmRequest): Promise<CopilotLlmResult> {
  const promptBytes = Buffer.byteLength(input.prompt, 'utf8');
  if (promptBytes > MAX_PROMPT_BYTES) {
    const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
    console.error('[copilot] assembled prompt exceeded the size budget; refusing before invoking the CLI', {
      promptBytes,
      maxPromptBytes: MAX_PROMPT_BYTES,
    });
    return {
      ok: false,
      error:
        `This request needs more evidence than can be answered safely in one call (${mb(promptBytes)}MB, ` +
        `over the ${mb(MAX_PROMPT_BYTES)}MB limit). Narrow the question - a shorter time window, a single ` +
        `route-direction, or a more specific question - and try again.`,
    };
  }

  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      error:
        'Claude subscription credential is not configured. Set CLAUDE_CODE_OAUTH_TOKEN (create one with `claude setup-token`).',
    };
  }

  const model = resolveCopilotModel();
  const system = input.maxTokens
    ? `${input.system}\n\nKeep the response within approximately ${input.maxTokens} output tokens.`
    : input.system;

  const args = [
    '--print',
    '--output-format',
    'json',
    '--model',
    model,
    '--system-prompt',
    system,
    // A grounded text completion needs no tools, no MCP servers, and no
    // ambient user/project settings. Each of these closes a way for the
    // server's own configuration to change what the copilot does.
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    // Nothing about a single stateless request should persist on the host.
    '--no-session-persistence',
  ];

  let outcome: CliOutcome;
  try {
    outcome = await runClaudeCli(args, input.prompt, token, resolveTimeoutMs());
  } catch (error) {
    const message = error instanceof Error ? redact(error.message) : 'Unknown error running the Claude CLI';
    console.error('[copilot] claude cli invocation threw', { message });
    return { ok: false, error: message };
  }

  if (outcome.spawnError) {
    if (outcome.spawnError.code === 'ENOENT') {
      return {
        ok: false,
        error:
          'The Claude CLI is not installed on this server. Install it and make `claude` available on PATH, or set CLAUDE_CLI_PATH.',
      };
    }
    return { ok: false, error: `Could not start the Claude CLI: ${redact(outcome.spawnError.message)}` };
  }

  if (outcome.timedOut) {
    return { ok: false, error: `Claude subscription request timed out after ${resolveTimeoutMs()}ms` };
  }

  let parsed: ClaudeCliResult | null = null;
  if (outcome.stdout.trim()) {
    try {
      parsed = JSON.parse(outcome.stdout) as ClaudeCliResult;
    } catch {
      parsed = null;
    }
  }

  // An auth failure is reported in-band: exit code 1 with is_error and an
  // api_error_status of 401/403. Surfacing it as its own operator-facing
  // sentence matters because the remedy is specific and human — mint a new
  // token — not something a retry will ever fix.
  const status = parsed?.api_error_status ?? null;
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: `Claude subscription credential was rejected (HTTP ${status}). It has expired or been revoked — run \`claude setup-token\` and update CLAUDE_CODE_OAUTH_TOKEN.`,
    };
  }

  if (parsed?.is_error) {
    const detail = parsed.result ? redact(parsed.result) : `HTTP ${status ?? 'unknown'}`;
    // Never log the prompt or the response body to stdout/stderr — those are
    // persisted to ops_copilot_interactions by the caller instead, which is
    // access-controlled the same way as the rest of the ops audit trail.
    console.error('[copilot] claude cli reported an error', { status });
    return { ok: false, error: `Claude subscription request failed: ${detail}` };
  }

  if (outcome.code !== 0) {
    const detail = redact(outcome.stderr).trim().slice(0, 200);
    console.error('[copilot] claude cli exited non-zero', { code: outcome.code });
    return {
      ok: false,
      error: detail
        ? `Claude CLI exited with code ${outcome.code}: ${detail}`
        : `Claude CLI exited with code ${outcome.code}`,
    };
  }

  if (!parsed) {
    return { ok: false, error: 'Claude CLI returned an unreadable response' };
  }

  const text = typeof parsed.result === 'string' ? parsed.result.trim() : '';
  if (!text) {
    return { ok: false, error: 'Claude response contained no text content' };
  }

  return { ok: true, text, model };
}

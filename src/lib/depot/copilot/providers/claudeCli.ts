import { accessSync, constants, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { buildCliArgs, isValidModelName } from '@/lib/depot/copilot/cli/args';
import { classifyCliFailure, parseCliOutput } from '@/lib/depot/copilot/cli/classify';
import { buildChildEnv } from '@/lib/depot/copilot/cli/env';
import {
  buildSystemPrompt,
  buildUserPrompt,
  DRAFT_JSON_SCHEMA,
} from '@/lib/depot/copilot/cli/prompt';
import { runCli, type SpawnLike } from '@/lib/depot/copilot/cli/run';
import {
  CLI_CONCURRENCY,
  CLI_MAX_CALLS_PER_DAY,
  CLI_MAX_CALLS_PER_HOUR,
  CLI_MAX_OUTPUT_BYTES,
  CLI_QUEUE,
  CLI_TIMEOUT_MS,
} from '@/lib/depot/copilot/config';
import { createCallLimiter, type CallLimiter } from '@/lib/depot/copilot/limiter';
import { MAX_PROMPT_BYTES } from '@/lib/depot/copilot/limits';
import { createSemaphore, type Semaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
} from '@/lib/depot/copilot/types';

// Defined in types.ts (the semaphore needs it and imports from there too, so
// defining it here would create an import cycle); re-exported for callers.
export { CopilotFailure };

export interface ClaudeCliDeps {
  readonly spawn: SpawnLike;
  /** Absolute path to the CLI; a bare name would be resolved through PATH. */
  readonly bin: string;
  readonly model: string;
  /** Throwaway HOME for the child, so it cannot read the server user's config. */
  readonly home: string;
  /** Returns an empty directory to run in. */
  readonly cwd: () => string;
  /** The server's environment; only an allowlist of it reaches the child. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory of the running node executable; defaults to this process's. */
  readonly nodeDir?: string;
  /** Shared across providers when more than one is built; defaults to a private one. */
  readonly semaphore?: Semaphore;
  /** Hourly and daily call budget; defaults to the configured limits on the system clock. */
  readonly limiter?: CallLimiter;
}

const SCHEMA_JSON = JSON.stringify(DRAFT_JSON_SCHEMA);

/** Pure check: an absolute path with no NUL byte. */
export function isAbsoluteBinary(path: string): boolean {
  return path.length > 0 && !path.includes('\0') && isAbsolute(path);
}

/** Startup check for wiring code: absolute, an existing regular file, executable. */
export function assertUsableBinary(path: string): void {
  if (!isAbsoluteBinary(path)) throw new Error('The Claude binary path must be absolute');
  if (!statSync(path).isFile()) throw new Error('The Claude binary path is not a file');
  accessSync(path, constants.X_OK);
}

/** Writes drafts through `claude -p`. Every failure is a `CopilotFailure`. */
export function createClaudeCliProvider(deps: ClaudeCliDeps): CopilotProvider {
  if (!isAbsoluteBinary(deps.bin)) throw new Error('The Claude binary path must be absolute');
  if (!isValidModelName(deps.model)) throw new RangeError('Invalid model name');
  const semaphore = deps.semaphore ?? createSemaphore(CLI_CONCURRENCY, CLI_QUEUE);
  const limiter =
    deps.limiter ??
    createCallLimiter({
      now: Date.now,
      perHour: CLI_MAX_CALLS_PER_HOUR,
      perDay: CLI_MAX_CALLS_PER_DAY,
    });
  const nodeDir = deps.nodeDir ?? dirname(process.execPath);

  return {
    id: 'claude-cli',
    async draft(request: CopilotRequest): Promise<CopilotDraft> {
      let stdin: string;
      let args: string[];
      try {
        stdin = buildUserPrompt(request);
        args = buildCliArgs({
          schemaJson: SCHEMA_JSON,
          systemPrompt: buildSystemPrompt(request.task),
          model: deps.model,
        });
      } catch {
        // Request shape, not CLI health: never starts a cool-down.
        throw new CopilotFailure('request_rejected', 'request cannot be sent to the CLI');
      }
      if (Buffer.byteLength(stdin, 'utf8') > MAX_PROMPT_BYTES) {
        throw new CopilotFailure('request_rejected', 'prompt too large');
      }
      const result = await semaphore.run(() => {
        // Counted where an attempt really starts, so queued or refused work costs nothing.
        if (!limiter.tryAcquire()) throw new CopilotFailure('budget_exhausted', 'call budget used');
        return runCli(
          {
            bin: deps.bin,
            args,
            env: buildChildEnv(deps.env, deps.home, nodeDir),
            cwd: deps.cwd(),
            stdin,
            timeoutMs: CLI_TIMEOUT_MS,
            maxOutputBytes: CLI_MAX_OUTPUT_BYTES,
          },
          deps.spawn,
        );
      });
      if (!result.ok) throw new CopilotFailure(result.reason, result.detail);

      const parsed = parseCliOutput(result.stdout);
      if (parsed.ok) return parsed.draft;
      // The CLI can report auth or limit errors in its own error envelope on a
      // clean exit; model-written text is never consulted (see classify.ts).
      const reason = classifyCliFailure(1, '', result.stdout);
      throw new CopilotFailure(reason === 'error' ? 'invalid_output' : reason, 'unusable output');
    },
  };
}

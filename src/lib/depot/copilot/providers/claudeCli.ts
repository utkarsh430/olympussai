import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { buildCliArgs, isValidModelName } from '@/lib/depot/copilot/cli/args';
import { classifyCliFailure, parseCliOutput } from '@/lib/depot/copilot/cli/classify';
import { buildChildEnv } from '@/lib/depot/copilot/cli/env';
import {
  buildSystemPrompt,
  buildUserPrompt,
  DRAFT_JSON_SCHEMA,
} from '@/lib/depot/copilot/cli/prompt';
import { runCli, type SpawnLike } from '@/lib/depot/copilot/cli/run';
import { CLI_MAX_OUTPUT_BYTES, CLI_TIMEOUT_MS } from '@/lib/depot/copilot/config';
import type { CallLimiter } from '@/lib/depot/copilot/limiter';
import { MAX_PROMPT_BYTES } from '@/lib/depot/copilot/limits';
import {
  assertUsableBinary,
  isAbsoluteBinary,
  nodeBinaryFs,
  type BinaryFs,
} from '@/lib/depot/copilot/providers/binary';
import type { Semaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
} from '@/lib/depot/copilot/types';

// Defined in types.ts (the semaphore needs it and imports from there too, so
// defining it here would create an import cycle); re-exported for callers.
export { CopilotFailure };
export { assertUsableBinary, isAbsoluteBinary };

export interface ClaudeCliDeps {
  readonly spawn: SpawnLike;
  /**
   * Absolute path to the CLI; a bare name would be resolved through PATH. It is
   * verified at construction (see `assertUsableBinary`) and its real path spawned.
   */
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
  /**
   * Required, with no private default: build ONE semaphore and ONE limiter per
   * process and pass them to every provider, or each caller gets a fresh budget.
   */
  readonly semaphore: Semaphore;
  readonly limiter: CallLimiter;
  /** HOME and the working directory must lie outside this; defaults to the server's cwd. */
  readonly repoRoot?: string;
  /** File-system calls for the binary check; defaults to the real file system. */
  readonly fs?: BinaryFs;
}

const SCHEMA_JSON = JSON.stringify(DRAFT_JSON_SCHEMA);

/** Writes drafts through `claude -p`. Every failure is a `CopilotFailure`. */
export function createClaudeCliProvider(deps: ClaudeCliDeps): CopilotProvider {
  if (!isAbsoluteBinary(deps.bin)) throw new Error('The Claude binary path must be absolute');
  if (!isValidModelName(deps.model)) throw new RangeError('Invalid model name');
  const fs = deps.fs ?? nodeBinaryFs;
  assertUsableBinary(deps.bin, fs);
  const { semaphore, limiter } = deps;
  // Checked at run time too: an untyped caller must not get an unlimited provider.
  if (!semaphore || !limiter) throw new Error('A shared semaphore and limiter are required');
  const repoRoot = resolve(deps.repoRoot ?? process.cwd());
  /** Absolute and outside the repository, so the child can read no project file. */
  const isPrivateDir = (path: string): boolean => {
    if (!isAbsolute(path) || path.includes('\0')) return false;
    const fromRepo = relative(repoRoot, resolve(path));
    return fromRepo.startsWith('..') || isAbsolute(fromRepo);
  };
  if (!isPrivateDir(deps.home)) {
    throw new Error('The child HOME must be absolute and outside the repository');
  }
  const nodeDir = deps.nodeDir ?? dirname(process.execPath);

  return {
    id: 'claude-cli',
    async draft(request: CopilotRequest, signal?: AbortSignal): Promise<CopilotDraft> {
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
      // Verified on every call, before a slot or budget is used.
      let bin: string;
      try {
        bin = assertUsableBinary(deps.bin, fs);
      } catch {
        throw new CopilotFailure('not_installed', 'binary check failed');
      }
      const cwd = deps.cwd();
      if (!isPrivateDir(cwd)) throw new CopilotFailure('error', 'working directory rejected');
      const result = await semaphore.run(() => {
        // Counted where an attempt really starts, so queued or refused work costs nothing.
        if (!limiter.tryAcquire()) throw new CopilotFailure('budget_exhausted', 'call budget used');
        return runCli(
          {
            bin,
            args,
            env: buildChildEnv(deps.env, deps.home, nodeDir),
            cwd,
            stdin,
            timeoutMs: CLI_TIMEOUT_MS,
            maxOutputBytes: CLI_MAX_OUTPUT_BYTES,
            signal,
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

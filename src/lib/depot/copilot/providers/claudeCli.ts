import { buildCliArgs } from '@/lib/depot/copilot/cli/args';
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
  CLI_MAX_OUTPUT_BYTES,
  CLI_QUEUE,
  CLI_TIMEOUT_MS,
} from '@/lib/depot/copilot/config';
import { createSemaphore, type Semaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
} from '@/lib/depot/copilot/types';

export { CopilotFailure };

export interface ClaudeCliDeps {
  readonly spawn: SpawnLike;
  readonly bin: string;
  readonly model: string;
  /** Throwaway HOME for the child, so it cannot read the server user's config. */
  readonly home: string;
  /** Returns an empty directory to run in. */
  readonly cwd: () => string;
  /** The server's environment; only an allowlist of it reaches the child. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Shared across providers when more than one is built; defaults to a private one. */
  readonly semaphore?: Semaphore;
}

const SCHEMA_JSON = JSON.stringify(DRAFT_JSON_SCHEMA);

/** Writes drafts through `claude -p`. Every failure is a `CopilotFailure`. */
export function createClaudeCliProvider(deps: ClaudeCliDeps): CopilotProvider {
  const semaphore = deps.semaphore ?? createSemaphore(CLI_CONCURRENCY, CLI_QUEUE);

  return {
    id: 'claude-cli',
    async draft(request: CopilotRequest): Promise<CopilotDraft> {
      const result = await semaphore.run(() =>
        runCli(
          {
            bin: deps.bin,
            args: buildCliArgs({
              schemaJson: SCHEMA_JSON,
              systemPrompt: buildSystemPrompt(request.task),
              model: deps.model,
            }),
            env: buildChildEnv(deps.env, deps.home),
            cwd: deps.cwd(),
            stdin: buildUserPrompt(request),
            timeoutMs: CLI_TIMEOUT_MS,
            maxOutputBytes: CLI_MAX_OUTPUT_BYTES,
          },
          deps.spawn,
        ),
      );
      if (!result.ok) throw new CopilotFailure(result.reason, result.detail);

      const parsed = parseCliOutput(result.stdout);
      if (parsed.ok) return parsed.draft;
      // The CLI can report auth or limit errors in its envelope on a clean exit.
      const reason = classifyCliFailure(1, '', result.stdout);
      throw new CopilotFailure(reason === 'error' ? 'invalid_output' : reason, 'unusable output');
    },
  };
}

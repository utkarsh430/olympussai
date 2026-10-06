import { readProviderSetting } from '@/lib/depot/copilot/config';
import type { SpawnLike } from '@/lib/depot/copilot/cli/run';
import type { CallLimiter } from '@/lib/depot/copilot/limiter';
import type { BinaryFs } from '@/lib/depot/copilot/providers/binary';
import { createClaudeCliProvider } from '@/lib/depot/copilot/providers/claudeCli';
import type { Semaphore } from '@/lib/depot/copilot/semaphore';
import type { CopilotProvider } from '@/lib/depot/copilot/types';
import { logDepotError } from '@/lib/depot/log';
import { DEFAULT_COPILOT_MODEL, LOG_SCOPE } from '@/lib/depot/copilot/service/constants';

export interface CliFactoryDeps {
  /** The server's environment: `DEPOT_COPILOT_PROVIDER`, `CLAUDE_BIN`, `DEPOT_COPILOT_MODEL`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawn: SpawnLike;
  /** Defaults to the real file system inside the provider. */
  readonly fs?: BinaryFs;
  /** Creates an empty private directory and returns its path. */
  readonly makeDir: (prefix: string) => string;
  readonly semaphore: Semaphore;
  /** The hourly and daily call budget, shared by every request. */
  readonly limiter: CallLimiter;
}

/**
 * Builds the Claude CLI provider once, at engine construction, or returns null
 * so the engine runs scripted-only. The core's constructor throws when the
 * binary is missing or unsafe or the model name is invalid; that is caught
 * here, once, and logged as a reason code, never with the path or message.
 */
export function createCliProvider(deps: CliFactoryDeps): CopilotProvider | null {
  if (readProviderSetting(deps.env) === 'scripted') return null;
  const bin = deps.env.CLAUDE_BIN;
  if (bin === undefined || bin === '') return null;
  try {
    const home = deps.makeDir('depot-copilot-home-');
    const workDir = deps.makeDir('depot-copilot-cwd-');
    return createClaudeCliProvider({
      spawn: deps.spawn,
      bin,
      model: deps.env.DEPOT_COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
      home,
      // The CLI runs with every tool disabled, so one empty directory serves every call.
      cwd: () => workDir,
      env: deps.env,
      semaphore: deps.semaphore,
      limiter: deps.limiter,
      ...(deps.fs ? { fs: deps.fs } : {}),
    });
  } catch {
    logDepotError(LOG_SCOPE, 'cli_unavailable');
    return null;
  }
}

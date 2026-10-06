import { readProviderSetting } from '@/lib/depot/copilot/config';
import { liveCalls, type LiveCalls } from '@/lib/depot/copilot/cli/liveCalls';
import type { KillGroup, SpawnLike } from '@/lib/depot/copilot/cli/run';
import type { CallLimiter } from '@/lib/depot/copilot/limiter';
import type { BinaryFs } from '@/lib/depot/copilot/providers/binary';
import { createClaudeCliProvider } from '@/lib/depot/copilot/providers/claudeCli';
import type { Semaphore } from '@/lib/depot/copilot/semaphore';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
} from '@/lib/depot/copilot/types';
import { logDepotError } from '@/lib/depot/log';
import { DEFAULT_COPILOT_MODEL, LOG_SCOPE } from '@/lib/depot/copilot/service/constants';

export interface CliFactoryDeps {
  /** The server's environment: `DEPOT_COPILOT_PROVIDER`, `CLAUDE_BIN`, `DEPOT_COPILOT_MODEL`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawn: SpawnLike;
  /** Defaults to the real file system inside the provider. */
  readonly fs?: BinaryFs;
  /** The system temp directory, outside the repository; every call's directories go in it. */
  readonly tempRoot: string;
  /** Creates an empty private (0700) directory under `tempRoot` and returns its path. */
  readonly makeDir: (prefix: string) => Promise<string>;
  /** Removes a directory made by `makeDir`, with everything in it. */
  readonly removeDir: (path: string) => Promise<void>;
  readonly semaphore: Semaphore;
  /** The hourly and daily call budget, shared by every request. */
  readonly limiter: CallLimiter;
  /** Kills the child's process group; defaults to the real signal. */
  readonly killGroup?: KillGroup;
  /** The calls a shutdown must end (review L4); defaults to the process's registry. */
  readonly liveCalls?: LiveCalls;
}

const HOME_PREFIX = 'depot-copilot-home-';
const CWD_PREFIX = 'depot-copilot-cwd-';

/** The core's provider for one HOME and working directory, sharing slots and budget. */
function coreProvider(deps: CliFactoryDeps, bin: string, home: string, cwd: string) {
  return createClaudeCliProvider({
    spawn: deps.spawn,
    bin,
    model: deps.env.DEPOT_COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
    home,
    cwd: () => cwd,
    env: deps.env,
    semaphore: deps.semaphore,
    limiter: deps.limiter,
    ...(deps.fs ? { fs: deps.fs } : {}),
    ...(deps.killGroup ? { killGroup: deps.killGroup } : {}),
  });
}

/** Removes the call's directories; a failure is logged as a reason code and never thrown. */
async function removeAll(
  deps: CliFactoryDeps,
  dirs: readonly string[],
  calls: LiveCalls,
): Promise<void> {
  const results = await Promise.allSettled(dirs.map((dir) => deps.removeDir(dir)));
  // A folder that could not be removed stays known, so a shutdown tries once more.
  dirs.forEach((dir, i) => {
    if (results[i]?.status === 'fulfilled') calls.dropDir(dir);
  });
  if (results.some((r) => r.status === 'rejected')) logDepotError(LOG_SCOPE, 'cleanup_failed');
}

/**
 * Builds the Claude CLI provider, or returns null so the engine runs
 * scripted-only. The binary and model are checked once here: the core's
 * constructor throws when the binary is missing or unsafe or the model name is
 * invalid, which is caught and logged as a reason code, never with the path.
 *
 * Every call then gets a fresh private HOME and working directory, removed in
 * `finally`. The draft settles only after the child has closed (or the bounded
 * grace in `runCli` has passed), so removal never races a dying process. Nothing the CLI writes (session files holding the server's
 * prompts) outlives the call. Sign-in comes from `CLAUDE_CODE_OAUTH_TOKEN`
 * in the child's environment, not from HOME, so HOME need not persist.
 */
export function createCliProvider(deps: CliFactoryDeps): CopilotProvider | null {
  if (readProviderSetting(deps.env) === 'scripted') return null;
  const bin = deps.env.CLAUDE_BIN;
  if (bin === undefined || bin === '') return null;
  try {
    // Validation only: this instance never drafts, so its directories are never used.
    coreProvider(deps, bin, deps.tempRoot, deps.tempRoot);
  } catch {
    logDepotError(LOG_SCOPE, 'cli_unavailable');
    return null;
  }
  return {
    id: 'claude-cli',
    async draft(
    request: CopilotRequest,
    signal?: AbortSignal,
    canStart?: () => boolean,
  ): Promise<CopilotDraft> {
      let dirs: readonly string[] = [];
      const calls = deps.liveCalls ?? liveCalls();
      try {
        // Settled one by one, so a directory made before the other failed is still removed.
        const made = await Promise.allSettled([
          deps.makeDir(HOME_PREFIX),
          deps.makeDir(CWD_PREFIX),
        ]);
        dirs = made.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        dirs.forEach((dir) => calls.addDir(dir));
        const [home, cwd] = dirs;
        if (home === undefined || cwd === undefined || dirs.length !== made.length) {
          throw new CopilotFailure('error', 'private directories unavailable');
        }
        let provider: CopilotProvider;
        try {
          provider = coreProvider(deps, bin, home, cwd);
        } catch {
          throw new CopilotFailure('not_installed', 'provider check failed');
        }
        return await provider.draft(request, signal, canStart);
      } finally {
        await removeAll(deps, dirs, calls);
      }
    },
  };
}

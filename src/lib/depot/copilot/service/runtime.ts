import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI_CONCURRENCY,
  CLI_COOLDOWN_MS,
  CLI_MAX_CALLS_PER_DAY,
  CLI_MAX_CALLS_PER_HOUR,
  CLI_QUEUE,
  readProviderSetting,
  type ProviderSetting,
} from '@/lib/depot/copilot/config';
import { createCallLimiter } from '@/lib/depot/copilot/limiter';
import { createScriptedProvider } from '@/lib/depot/copilot/providers/scripted';
import { createCopilotEngine, type CopilotEngine } from '@/lib/depot/copilot/resolve';
import { createSemaphore } from '@/lib/depot/copilot/semaphore';
import type { CopilotProvider } from '@/lib/depot/copilot/types';
import { createResponseCache, type ResponseCache } from '@/lib/depot/copilot/service/cache';
import { createCliProvider } from '@/lib/depot/copilot/service/cliFactory';
import {
  GLOBAL_REQUESTS_PER_MINUTE,
  MAX_TRACKED_SESSIONS,
  RATE_WINDOW_MS,
  REQUEST_DEADLINE_MS,
  RESPONSE_CACHE_ENTRIES,
  RESPONSE_CACHE_MS,
  SESSION_REQUESTS_PER_MINUTE,
} from '@/lib/depot/copilot/service/constants';
import { createWindowLimiter, type WindowLimiter } from '@/lib/depot/rateLimit';

/** Everything the route shares between requests. Built once per process. */
export interface CopilotRuntime {
  /** Chooses Claude or scripted, with the core's cool-down and fallbacks. */
  readonly engine: CopilotEngine;
  /** Scripted only: the answer when the deadline passes or the engine fails. */
  readonly scriptedEngine: CopilotEngine;
  /** Claude was asked for by name but could not be set up: say it was unavailable. */
  readonly claudeExpected: boolean;
  /** A Claude provider exists, so a scripted answer forced by the deadline is a fallback. */
  readonly usesClaude: boolean;
  readonly sessionLimiter: WindowLimiter;
  readonly globalLimiter: WindowLimiter;
  readonly cache: ResponseCache;
  readonly deadlineMs: number;
  readonly now: () => number;
}

export interface RuntimeOptions {
  readonly setting: ProviderSetting;
  /** The Claude provider, or null when none could be built. */
  readonly cli: CopilotProvider | null;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

export function buildCopilotRuntime(options: RuntimeOptions): CopilotRuntime {
  const now = options.now ?? Date.now;
  const scripted = createScriptedProvider();
  const engineFor = (setting: ProviderSetting, cli: CopilotProvider | null): CopilotEngine =>
    createCopilotEngine({ setting, cli, scripted, now, cooldownMs: CLI_COOLDOWN_MS });
  const limiter = (limit: number, maxKeys: number): WindowLimiter =>
    createWindowLimiter({ now, limit, windowMs: RATE_WINDOW_MS, maxKeys });
  return {
    engine: engineFor(options.setting, options.cli),
    scriptedEngine: engineFor('scripted', null),
    claudeExpected: options.setting === 'claude-cli' && options.cli === null,
    usesClaude: options.setting !== 'scripted' && options.cli !== null,
    sessionLimiter: limiter(SESSION_REQUESTS_PER_MINUTE, MAX_TRACKED_SESSIONS),
    globalLimiter: limiter(GLOBAL_REQUESTS_PER_MINUTE, 1),
    cache: createResponseCache({
      now,
      ttlMs: RESPONSE_CACHE_MS,
      maxEntries: RESPONSE_CACHE_ENTRIES,
    }),
    deadlineMs: options.deadlineMs ?? REQUEST_DEADLINE_MS,
    now,
  };
}

/** The real wiring: the server's environment, `spawn`, temp directories, the system clock. */
function createProcessRuntime(): CopilotRuntime {
  const env = process.env;
  const cli = createCliProvider({
    env,
    spawn,
    makeDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    semaphore: createSemaphore(CLI_CONCURRENCY, CLI_QUEUE),
    limiter: createCallLimiter({
      now: Date.now,
      perHour: CLI_MAX_CALLS_PER_HOUR,
      perDay: CLI_MAX_CALLS_PER_DAY,
    }),
  });
  return buildCopilotRuntime({ setting: readProviderSetting(env), cli });
}

const RUNTIME_KEY = Symbol.for('olympuss.depot.copilotRuntime');
type RuntimeHolder = typeof globalThis & { [RUNTIME_KEY]?: CopilotRuntime };

/**
 * One runtime per process, held on `globalThis` so a hot reload of this module
 * reuses it: a second engine would bring a second semaphore and call budget,
 * doubling what the CLI may spend.
 */
export function getCopilotRuntime(): CopilotRuntime {
  const holder = globalThis as RuntimeHolder;
  const existing = holder[RUNTIME_KEY];
  if (existing) return existing;
  const runtime = createProcessRuntime();
  holder[RUNTIME_KEY] = runtime;
  return runtime;
}

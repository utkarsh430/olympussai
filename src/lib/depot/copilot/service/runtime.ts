import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
  CLAUDE_ALLOWANCE_WINDOW_MS,
  IDENTITY_CLAUDE_CALLS_PER_HOUR,
  IDENTITY_REQUESTS_PER_MINUTE,
  MAX_TRACKED_IDENTITIES,
  MIN_CLAUDE_REMAINING_MS,
  PROCESS_REQUESTS_PER_MINUTE,
  RATE_WINDOW_MS,
  REQUEST_DEADLINE_MS,
  RESPONSE_CACHE_ENTRIES,
  RESPONSE_CACHE_MS,
  ADDRESS_CLAUDE_CALLS_PER_HOUR,
  ADDRESS_REQUESTS_PER_MINUTE,
} from '@/lib/depot/copilot/service/constants';
import { createInflightCalls, type InflightCalls } from '@/lib/depot/copilot/service/inflight';
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
  /** Requests per identity per minute. */
  readonly identityLimiter: WindowLimiter;
  /** All requests per minute: protects the process only. */
  readonly processLimiter: WindowLimiter;
  /** Keyed on the trusted address alone; used only when one is known. */
  readonly addressLimiter: WindowLimiter;
  readonly addressClaudeAllowance: WindowLimiter;
  /** Claude calls an identity may start per hour. */
  readonly claudeAllowance: WindowLimiter;
  /** One running Claude call per cache key. */
  readonly inflight: InflightCalls;
  readonly cache: ResponseCache;
  readonly deadlineMs: number;
  /** A Claude call is not started with less than this left before the deadline. */
  readonly minClaudeMs: number;
  /** The server's environment, read for `DEPOT_TRUSTED_IP_HEADER`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => number;
}

export interface RuntimeOptions {
  readonly setting: ProviderSetting;
  /** The Claude provider, or null when none could be built. */
  readonly cli: CopilotProvider | null;
  readonly now?: () => number;
  readonly deadlineMs?: number;
  readonly minClaudeMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Tests only: a lower process ceiling than `PROCESS_REQUESTS_PER_MINUTE`, so they stay cheap. */
  readonly processRequestsPerMinute?: number;
}

export function buildCopilotRuntime(options: RuntimeOptions): CopilotRuntime {
  const now = options.now ?? Date.now;
  const scripted = createScriptedProvider();
  const engineFor = (setting: ProviderSetting, cli: CopilotProvider | null): CopilotEngine =>
    createCopilotEngine({ setting, cli, scripted, now, cooldownMs: CLI_COOLDOWN_MS });
  const limiter = (limit: number, maxKeys: number, windowMs = RATE_WINDOW_MS): WindowLimiter =>
    createWindowLimiter({ now, limit, windowMs, maxKeys });
  return {
    engine: engineFor(options.setting, options.cli),
    scriptedEngine: engineFor('scripted', null),
    claudeExpected: options.setting === 'claude-cli' && options.cli === null,
    usesClaude: options.setting !== 'scripted' && options.cli !== null,
    identityLimiter: limiter(IDENTITY_REQUESTS_PER_MINUTE, MAX_TRACKED_IDENTITIES),
    processLimiter: limiter(
      options.processRequestsPerMinute ?? PROCESS_REQUESTS_PER_MINUTE,
      1,
    ),
    addressLimiter: limiter(ADDRESS_REQUESTS_PER_MINUTE, MAX_TRACKED_IDENTITIES),
    addressClaudeAllowance: limiter(
      ADDRESS_CLAUDE_CALLS_PER_HOUR,
      MAX_TRACKED_IDENTITIES,
      CLAUDE_ALLOWANCE_WINDOW_MS,
    ),
    claudeAllowance: limiter(
      IDENTITY_CLAUDE_CALLS_PER_HOUR,
      MAX_TRACKED_IDENTITIES,
      CLAUDE_ALLOWANCE_WINDOW_MS,
    ),
    inflight: createInflightCalls(),
    cache: createResponseCache({
      now,
      ttlMs: RESPONSE_CACHE_MS,
      maxEntries: RESPONSE_CACHE_ENTRIES,
    }),
    deadlineMs: options.deadlineMs ?? REQUEST_DEADLINE_MS,
    minClaudeMs: options.minClaudeMs ?? MIN_CLAUDE_REMAINING_MS,
    env: options.env ?? {},
    now,
  };
}

/** The real wiring: the server's environment, `spawn`, temp directories, the system clock. */
function createProcessRuntime(): CopilotRuntime {
  const env = process.env;
  const cli = createCliProvider({
    env,
    spawn,
    // Under the system temp directory, outside the repository; mkdtemp makes it 0700.
    tempRoot: tmpdir(),
    makeDir: (prefix) => mkdtemp(join(tmpdir(), prefix)),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    semaphore: createSemaphore(CLI_CONCURRENCY, CLI_QUEUE),
    // No clock passed: the core's budget runs on its monotonic default.
    limiter: createCallLimiter({
      perHour: CLI_MAX_CALLS_PER_HOUR,
      perDay: CLI_MAX_CALLS_PER_DAY,
    }),
  });
  return buildCopilotRuntime({ setting: readProviderSetting(env), cli, env });
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

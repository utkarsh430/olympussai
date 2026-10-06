import { rmSync } from 'node:fs';
import { killProcessGroup, type KillGroup } from '@/lib/depot/copilot/cli/kill';
import { liveCalls, type LiveCalls } from '@/lib/depot/copilot/cli/liveCalls';

/**
 * Review L4: stopping the server mid-call must not leave a `claude` child running
 * (it is detached in its own session, so Ctrl+C does not reach it) or its private
 * folders behind.
 *
 * On SIGTERM or SIGINT the handler kills the process group of every child this
 * service started and has not yet seen exit, removes every folder it made and has
 * not yet removed, and then lets the signal take its course: a listener for a
 * signal replaces Node's default of exiting, so when no other listener is left
 * the signal is raised again and the default exit happens. When another listener
 * remains (Next.js registers its own), that listener owns the exit. The handler
 * runs first (prepended), synchronously, and never throws.
 */

export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface SignalSource {
  once(signal: ShutdownSignal, handler: () => void): void;
  listenerCount(signal: ShutdownSignal): number;
  raise(signal: ShutdownSignal): void;
}

export interface ShutdownDeps {
  readonly calls: LiveCalls;
  readonly killGroup: KillGroup;
  readonly removeDirSync: (dir: string) => void;
  readonly signals: SignalSource;
}

const INSTALLED_KEY = Symbol.for('depot.copilot.shutdownInstalled');

function attempt(action: () => void): void {
  try {
    action();
  } catch {
    // Shutting down: a group already gone or a folder in use must not stop the rest.
  }
}

function cleanUp(calls: LiveCalls, deps: ShutdownDeps): void {
  const { pids, dirs } = calls.snapshot();
  for (const pid of pids) {
    attempt(() => deps.killGroup(pid));
    calls.dropPid(pid);
  }
  for (const dir of dirs) {
    attempt(() => deps.removeDirSync(dir));
    calls.dropDir(dir);
  }
}

/**
 * Registers the handler once per process: the flag lives on `holder`
 * (`globalThis` by default), so a hot reload or a second import does not add
 * another. Returns whether this call registered it.
 */
export function installShutdownCleanup(
  deps: ShutdownDeps,
  holder: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>,
): boolean {
  if (holder[INSTALLED_KEY] === true) return false;
  holder[INSTALLED_KEY] = true;
  for (const signal of SHUTDOWN_SIGNALS) {
    deps.signals.once(signal, () => {
      cleanUp(deps.calls, deps);
      if (deps.signals.listenerCount(signal) === 0) deps.signals.raise(signal);
    });
  }
  return true;
}

/** The process's own signals; used only by the runtime when the Claude writer is set up. */
export const processSignals: SignalSource = {
  once: (signal, handler) => {
    process.prependOnceListener(signal, handler);
  },
  listenerCount: (signal) => process.listenerCount(signal),
  raise: (signal) => {
    process.kill(process.pid, signal);
  },
};

export function installDefaultShutdownCleanup(): boolean {
  return installShutdownCleanup({
    calls: liveCalls(),
    killGroup: killProcessGroup,
    removeDirSync: (dir) => rmSync(dir, { recursive: true, force: true }),
    signals: processSignals,
  });
}

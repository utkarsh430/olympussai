import { describeCopilotError, withheldStrings } from '@/lib/depot/copilot/errorText';
import { LOG_SCOPE } from '@/lib/depot/copilot/service/constants';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { logDepotError } from '@/lib/serverLog';

/**
 * One log line for a copilot failure: the stage's reason code, the writer the runtime
 * uses, and the error's class and bounded message with the withheld strings blanked
 * (`snapshot_failed writer=scripted: TypeError: …`).
 */
export function logCopilotFailure(
  runtime: Pick<CopilotRuntime, 'usesClaude'>,
  code: string,
  error: unknown,
  withheld: readonly string[],
): void {
  const writer = runtime.usesClaude ? 'claude-cli' : 'scripted';
  logDepotError(LOG_SCOPE, `${code} writer=${writer}: ${describeCopilotError(error, withheld)}`);
}

/**
 * The process's copilot runtime, or null when building it throws: the route then answers
 * its fixed 503 with `no-store` instead of the framework's own error page. The failure is
 * logged once per request that meets it, with environment values blanked.
 */
export function copilotRuntimeOrNull(
  getRuntime: () => CopilotRuntime,
  env: Readonly<Record<string, string | undefined>>,
): CopilotRuntime | null {
  try {
    return getRuntime();
  } catch (error: unknown) {
    const text = describeCopilotError(error, withheldStrings({ env }));
    logDepotError(LOG_SCOPE, `runtime_failed: ${text}`);
    return null;
  }
}

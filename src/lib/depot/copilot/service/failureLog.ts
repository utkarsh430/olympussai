import { describeCopilotError } from '@/lib/depot/copilot/errorText';
import { LOG_SCOPE } from '@/lib/depot/copilot/service/constants';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { logDepotError } from '@/lib/depot/log';

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

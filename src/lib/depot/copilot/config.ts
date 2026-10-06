export type ProviderSetting = 'auto' | 'claude-cli' | 'scripted';

export const CLI_CONCURRENCY = 2;
export const CLI_QUEUE = 2;
export const CLI_TIMEOUT_MS = 45_000;
export const CLI_MAX_OUTPUT_BYTES = 1_048_576;
export const CLI_COOLDOWN_MS = 600_000;
/** Consecutive timeouts or bad outputs tolerated before the CLI is left alone. */
/** Rolling breaker: this many failures among the last CLI_WINDOW attempts start the cool-down. */
export const CLI_WINDOW = 10;
export const CLI_WINDOW_FAILURES = 5;
export const CLI_MAX_CALLS_PER_HOUR = 30;
export const CLI_MAX_CALLS_PER_DAY = 200; /** Spend ceiling for one print-mode call; a briefing costs a small fraction of this. */
export const CLI_MAX_BUDGET_USD = 0.25;

/** `DEPOT_COPILOT_PROVIDER`; anything unrecognised means `auto`, never an error. */
export function readProviderSetting(
  env: Readonly<Record<string, string | undefined>>,
): ProviderSetting {
  const value = env.DEPOT_COPILOT_PROVIDER;
  return value === 'claude-cli' || value === 'scripted' ? value : 'auto';
}

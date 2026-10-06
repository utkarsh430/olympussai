export type ProviderSetting = 'auto' | 'claude-cli' | 'scripted';

export const CLI_CONCURRENCY = 2;
export const CLI_QUEUE = 2;
export const CLI_TIMEOUT_MS = 45_000;
export const CLI_MAX_OUTPUT_BYTES = 1_048_576;
export const CLI_COOLDOWN_MS = 600_000;

/** `DEPOT_COPILOT_PROVIDER`; anything unrecognised means `auto`, never an error. */
export function readProviderSetting(
  env: Readonly<Record<string, string | undefined>>,
): ProviderSetting {
  const value = env.DEPOT_COPILOT_PROVIDER;
  return value === 'claude-cli' || value === 'scripted' ? value : 'auto';
}

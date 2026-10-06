export type ProviderSetting = 'auto' | 'claude-cli' | 'scripted';

export const CLI_CONCURRENCY = 2;
export const CLI_QUEUE = 2;
export const CLI_TIMEOUT_MS = 45_000;
export const CLI_MAX_OUTPUT_BYTES = 1_048_576;
export const CLI_COOLDOWN_MS = 600_000;
/** Rolling breaker: this many failures among the last CLI_WINDOW attempts start the cool-down. */
export const CLI_WINDOW = 10;
export const CLI_WINDOW_FAILURES = 5;
/** Call budget, counted where a CLI attempt starts, on the injected clock. */
export const CLI_MAX_CALLS_PER_HOUR = 30;
export const CLI_MAX_CALLS_PER_DAY = 200;
/** Spend ceiling for one print-mode call; a briefing costs a small fraction of this. */
export const CLI_MAX_BUDGET_USD = 0.25;

type Env = Readonly<Record<string, string | undefined>>;

const SETTINGS: readonly ProviderSetting[] = ['auto', 'claude-cli', 'scripted'];

/** How much of an unrecognised setting the log may show. */
export const MAX_SHOWN_SETTING_CHARS = 24;

const isSetting = (value: string): value is ProviderSetting =>
  SETTINGS.some((setting) => setting === value);

/**
 * `DEPOT_COPILOT_PROVIDER`. Unset or empty means `auto`. A value that is set but not one
 * of the three (a typo such as `Scripted`) means `scripted`: an operator who wrote
 * something meant to choose, and the scripted writer is the side that never runs Claude.
 */
export function readProviderSetting(env: Env): ProviderSetting {
  const value = env.DEPOT_COPILOT_PROVIDER;
  if (value === undefined || value === '') return 'auto';
  return isSetting(value) ? value : 'scripted';
}

/**
 * An unrecognised setting in a short, safe form for the server log (letters, digits,
 * `.`, `_` and `-`; anything else a `?`; cut at `MAX_SHOWN_SETTING_CHARS`), or null when
 * the setting is unset or recognised.
 */
export function unrecognisedProviderSetting(env: Env): string | null {
  const value = env.DEPOT_COPILOT_PROVIDER;
  if (value === undefined || value === '' || isSetting(value)) return null;
  const safe = value.slice(0, MAX_SHOWN_SETTING_CHARS).replace(/[^A-Za-z0-9._-]/g, '?');
  return value.length > MAX_SHOWN_SETTING_CHARS ? `${safe}…` : safe;
}

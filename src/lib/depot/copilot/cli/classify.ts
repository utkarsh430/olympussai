import { draftSchema } from '@/lib/depot/copilot/render';
import type { CopilotDraft, FallbackReason } from '@/lib/depot/copilot/types';

/**
 * Specific phrases the CLI or the API prints, anchored to the start of a line
 * where the message begins one. A word such as "limit", "credentials" or
 * "sign in" on its own is not enough: unrelated stderr on a non-zero exit must
 * stay `error`, because these two reasons start a cool-down that hides a bug.
 */
const USAGE_PATTERNS: readonly RegExp[] = [
  // The subscription's own cap: "Claude AI usage limit reached|<reset time>"
  // (later versions drop the "AI").
  /\bclaude (?:ai )?usage limit reached\b/i,
  // The interactive wording of the same cap: "You've hit your limit · resets 5pm".
  /^(?:error:\s*)?you(?:'ve| have) hit your (?:[a-z-]+ )?limit\b/im,
  // The rolling-window cap: "5-hour limit reached · resets 3pm".
  /^(?:error:\s*)?\d+-hour limit reached\b/im,
  // The API refused for rate: "API Error: 429 …" or "HTTP 429 …".
  /^(?:api error:|http)\s*429\b/im,
  // The API error body's type for the same refusal.
  /"type"\s*:\s*"rate_limit_error"/,
];

const AUTH_PATTERNS: readonly RegExp[] = [
  // No stored credentials: "Not logged in · Please run /login".
  /^(?:error:\s*)?not logged in\b/im,
  // A rejected key or token: "Invalid API key · Please run /login".
  /^(?:error:\s*)?invalid api key\b/im,
  // The CLI's fix-it instruction that accompanies both messages above.
  /\bplease run \/login\b/i,
  // An expired subscription token: "OAuth token has expired. Please obtain…".
  /\boauth token has expired\b/i,
  // The API refused the credentials: "API Error: 401 …".
  /^(?:api error:|http)\s*401\b/im,
  // The API error body's type for the same refusal.
  /"type"\s*:\s*"authentication_error"/,
];

const matchesAny = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

function parseEnvelope(stdout: string): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

/**
 * The only stdout text that is the CLI's own words: the envelope's `subtype`
 * and `result`, and only when `is_error` is true. On success `result` is
 * model-written, so it must never steer classification.
 */
function envelopeErrorText(stdout: string): string {
  const envelope = parseEnvelope(stdout);
  if (envelope === null || envelope.is_error !== true) return '';
  const parts = [envelope.subtype, envelope.result];
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

/**
 * Maps a failed run to a fallback reason using stderr, the exit code and the
 * CLI's own error envelope, never model-written text. Usage is tested first: a
 * limit message can also mention signing in.
 */
export function classifyCliFailure(
  exitCode: number | null,
  stderr: string,
  stdout: string,
): FallbackReason {
  if (exitCode === null) return 'error';
  const text = `${stderr}\n${envelopeErrorText(stdout)}`;
  if (matchesAny(USAGE_PATTERNS, text)) return 'usage_limit';
  if (matchesAny(AUTH_PATTERNS, text)) return 'not_authenticated';
  return 'error';
}

export type ParsedCliOutput =
  | { readonly ok: true; readonly draft: CopilotDraft }
  | { readonly ok: false; readonly reason: 'invalid_output' };

const INVALID: ParsedCliOutput = { ok: false, reason: 'invalid_output' };

/** Reads the CLI's JSON envelope and validates `structured_output` as a draft. */
export function parseCliOutput(stdout: string): ParsedCliOutput {
  const envelope = parseEnvelope(stdout);
  if (envelope === null || envelope.is_error === true) return INVALID;
  const parsed = draftSchema.safeParse(envelope.structured_output);
  return parsed.success ? { ok: true, draft: parsed.data } : INVALID;
}

import { draftSchema } from '@/lib/depot/copilot/render';
import type { CopilotDraft, FallbackReason } from '@/lib/depot/copilot/types';

const USAGE = /usage limit|rate limit|limit reached|too many requests|\b429\b|quota/i;
const AUTH =
  /not logged in|\/login|log in|sign in|invalid api key|unauthori[sz]ed|\b401\b|authentication|oauth token|token (?:has )?expired|credentials/i;

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
  if (USAGE.test(text)) return 'usage_limit';
  if (AUTH.test(text)) return 'not_authenticated';
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

import { draftSchema } from '@/lib/depot/copilot/render';
import type { CopilotDraft, FallbackReason } from '@/lib/depot/copilot/types';

const USAGE = /usage limit|rate limit|limit reached|too many requests|\b429\b|quota/i;
const AUTH =
  /not logged in|\/login|log in|sign in|invalid api key|unauthori[sz]ed|\b401\b|authentication|oauth token|token (?:has )?expired|credentials/i;

/**
 * Maps a failed run to a fallback reason. The CLI reports some failures on
 * stdout (in its JSON envelope) and others on stderr, so both are inspected.
 * Usage is tested first: a limit message can also mention signing in.
 */
export function classifyCliFailure(
  exitCode: number | null,
  stderr: string,
  stdout: string,
): FallbackReason {
  if (exitCode === null) return 'error';
  const text = `${stderr}\n${stdout}`;
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
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return INVALID;
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return INVALID;
  const record = envelope as Readonly<Record<string, unknown>>;
  if (record.is_error === true) return INVALID;
  const parsed = draftSchema.safeParse(record.structured_output);
  return parsed.success ? { ok: true, draft: parsed.data } : INVALID;
}

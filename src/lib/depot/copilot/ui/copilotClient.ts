import type { Provenance } from '@/lib/depot/types';
import type { CopilotApiRequest, CopilotApiResponse } from '../wire';

/**
 * Browser side of `POST /api/upsrtc/depot/copilot`. Pure apart from `fetch`;
 * imports only the wire types, never a server module. It never throws: every
 * failure comes back as a value the UI can turn into a sentence.
 */

export const COPILOT_ENDPOINT = '/api/upsrtc/depot/copilot';

/** Used when a 429 carries no usable wait, so the countdown still ends. */
export const FALLBACK_RETRY_SECONDS = 30;

export type CopilotFailureKind =
  | 'rate_limited'
  | 'session_expired'
  | 'not_found'
  | 'invalid'
  | 'forbidden'
  | 'unavailable'
  | 'network'
  | 'aborted';

export type CopilotResult =
  | { readonly ok: true; readonly response: CopilotApiResponse }
  | { readonly ok: false; readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly ok: false; readonly kind: Exclude<CopilotFailureKind, 'rate_limited'> };

const STATUS_KIND: Readonly<Record<number, Exclude<CopilotFailureKind, 'rate_limited'>>> = {
  400: 'invalid',
  401: 'session_expired',
  403: 'forbidden',
  404: 'not_found',
};

const PROVIDERS: readonly string[] = ['claude', 'scripted'];
const NOTICES: readonly string[] = ['none', 'claude_unavailable', 'summary_unavailable'];
const PROVENANCES: readonly Provenance[] = ['live', 'derived', 'modelled', 'reference'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFact(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.text === 'string' &&
    PROVENANCES.some((p) => p === value.provenance)
  );
}

function isTable(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.columns) &&
    Array.isArray(value.rows) &&
    value.rows.every(isStringArray)
  );
}

/** Strict about types, lenient about extra keys. */
function isCopilotResponse(value: unknown): value is CopilotApiResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.headline === 'string' &&
    isStringArray(value.paragraphs) &&
    PROVIDERS.some((p) => p === value.provider) &&
    NOTICES.some((n) => n === value.notice) &&
    typeof value.generatedAt === 'string' &&
    typeof value.cached === 'boolean' &&
    Array.isArray(value.facts) &&
    value.facts.every(isFact) &&
    (value.interpretedAs === undefined || typeof value.interpretedAs === 'string') &&
    (value.table === undefined || isTable(value.table))
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function rateLimited(response: Response): Promise<CopilotResult> {
  const body = await readJson(response);
  const seconds = isRecord(body) ? body.retryAfterSeconds : undefined;
  const usable = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0;
  return {
    ok: false,
    kind: 'rate_limited',
    retryAfterSeconds: usable ? Math.ceil(seconds) : FALLBACK_RETRY_SECONDS,
  };
}

export async function requestCopilot(
  body: CopilotApiRequest,
  signal?: AbortSignal,
): Promise<CopilotResult> {
  let response: Response;
  try {
    response = await fetch(COPILOT_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return { ok: false, kind: signal?.aborted ? 'aborted' : 'network' };
  }
  if (signal?.aborted) return { ok: false, kind: 'aborted' };
  if (response.status === 429) return rateLimited(response);
  if (response.status !== 200) {
    return { ok: false, kind: STATUS_KIND[response.status] ?? 'unavailable' };
  }
  const parsed = await readJson(response);
  if (signal?.aborted) return { ok: false, kind: 'aborted' };
  return isCopilotResponse(parsed)
    ? { ok: true, response: parsed }
    : { ok: false, kind: 'unavailable' };
}

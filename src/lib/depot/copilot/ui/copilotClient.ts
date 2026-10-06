import type { Provenance } from '@/lib/depot/types';
import {
  MAX_FACTS,
  MAX_FACT_LABEL_CHARS,
  MAX_FACT_TEXT_CHARS,
  MAX_PARAGRAPHS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
} from '../limits';
import type { CopilotApiRequest, CopilotApiResponse } from '../wire';

/** Generous ceilings on an answer table: the widest query lists a handful of columns. */
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 200;
/** Per-string ceilings: a longer cell, heading, id or timestamp is a malformed response. */
export const MAX_TABLE_CELL_CHARS = 200;
export const MAX_TABLE_HEADING_CHARS = 80;
export const MAX_FACT_ID_CHARS = 80;
export const MAX_GENERATED_AT_CHARS = 40;

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
const DATA_SOURCES: readonly string[] = ['last_good', 'sample'];
const PROVENANCES: readonly Provenance[] =['live', 'derived', 'modelled', 'reference'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** A text of 1..max characters. */
function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isFact(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length <= MAX_FACT_ID_CHARS &&
    typeof value.label === 'string' &&
    value.label.length <= MAX_FACT_LABEL_CHARS &&
    typeof value.text === 'string' &&
    value.text.length <= MAX_FACT_TEXT_CHARS &&
    PROVENANCES.some((p) => p === value.provenance)
  );
}

/** Optional: when sent, one known provenance (or null for a name column) per column. */
function isColumnProvenance(value: unknown, width: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === width &&
      value.every((p) => p === null || PROVENANCES.some((known) => known === p)))
  );
}

/** Every row has exactly one cell per column, so the table is always rectangular. */
function isTable(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.columns)) return false;
  const width = value.columns.length;
  const rows = value.rows;
  return (
    width <= MAX_TABLE_COLUMNS &&
    isColumnProvenance(value.provenance, width) &&
    value.columns.every((heading) => heading.length <= MAX_TABLE_HEADING_CHARS) &&
    Array.isArray(rows) &&
    rows.length <= MAX_TABLE_ROWS &&
    rows.every(
      (row) =>
        isStringArray(row) &&
        row.length === width &&
        row.every((cell) => cell.length <= MAX_TABLE_CELL_CHARS),
    )
  );
}

function isScopeDepot(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.depotId, MAX_TABLE_CELL_CHARS) &&
    isText(value.depotName, MAX_TABLE_CELL_CHARS)
  );
}

/** Round 8 A: the scope the answer used, one of the three wire shapes. */
function isAnswerScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'network') return true;
  if (value.kind === 'depot') return isScopeDepot(value);
  return (
    value.kind === 'depots' &&
    Array.isArray(value.depots) &&
    value.depots.length >= 2 &&
    value.depots.length <= MAX_TABLE_ROWS &&
    value.depots.every(isScopeDepot)
  );
}

function isParagraphs(value: unknown): value is readonly string[] {
  return (
    isStringArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_PARAGRAPHS &&
    value.every((p) => p.length <= MAX_RENDERED_PARAGRAPH_CHARS)
  );
}

/** Strict about types and bounds, lenient about extra keys. */
function isCopilotResponse(value: unknown): value is CopilotApiResponse {
  if (!isRecord(value)) return false;
  return (
    isText(value.headline, MAX_RENDERED_HEADLINE_CHARS) &&
    isParagraphs(value.paragraphs) &&
    PROVIDERS.some((p) => p === value.provider) &&
    NOTICES.some((n) => n === value.notice) &&
    typeof value.generatedAt === 'string' &&
    value.generatedAt.length <= MAX_GENERATED_AT_CHARS &&
    typeof value.cached === 'boolean' &&
    Array.isArray(value.facts) &&
    value.facts.length <= MAX_FACTS &&
    value.facts.every(isFact) &&
    (value.interpretedAs === undefined ||
      (typeof value.interpretedAs === 'string' &&
        value.interpretedAs.length <= MAX_RENDERED_PARAGRAPH_CHARS)) &&
    (value.table === undefined || isTable(value.table)) &&
    (value.answerScope === undefined || isAnswerScope(value.answerScope)) &&
    (value.dataSource === undefined || DATA_SOURCES.some((s) => s === value.dataSource))
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

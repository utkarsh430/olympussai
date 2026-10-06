import { NextResponse } from 'next/server';
import type { CopilotApiError, CopilotApiResponse } from '@/lib/depot/copilot/wire';

/** Fixed error bodies: nothing in them depends on the request or the failure. */
const ERRORS = {
  origin: { status: 403, error: 'Invalid request origin' },
  contentType: { status: 415, error: 'Unsupported content type' },
  tooLarge: { status: 413, error: 'Request too large' },
  invalid: { status: 400, error: 'Invalid request' },
  notFound: { status: 404, error: 'Not found' },
  unavailable: { status: 503, error: 'Depot data unavailable' },
} as const;

export type ErrorKind = keyof typeof ERRORS;

/** Every response of the route is `no-store`. */
export function reply(
  body: CopilotApiResponse | CopilotApiError,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export const fail = (kind: ErrorKind): NextResponse =>
  reply({ error: ERRORS[kind].error }, ERRORS[kind].status);

/** The same body for every limit, so a 429 does not say which limit refused. */
export const tooMany = (retryAfterSeconds: number): NextResponse =>
  reply({ error: 'Too many requests', retryAfterSeconds }, 429, {
    'Retry-After': String(retryAfterSeconds),
  });

/** `application/json` exactly, in any case, with any parameters. */
export function isJsonMediaType(contentType: string | null): boolean {
  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

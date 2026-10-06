import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/config';
import { isSameOrigin } from '@/lib/auth/origin';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { CopilotApiError, CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { logDepotError } from '@/lib/depot/log';
import { readCappedBody } from '@/lib/depot/copilot/service/body';
import { LOG_SCOPE, MAX_BODY_BYTES } from '@/lib/depot/copilot/service/constants';
import { answerCopilot } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest, type Prepared } from '@/lib/depot/copilot/service/prepare';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';

/** Fixed error bodies: nothing in them depends on the request or the failure. */
const ERRORS = {
  origin: { status: 403, error: 'Invalid request origin' },
  contentType: { status: 415, error: 'Unsupported content type' },
  tooLarge: { status: 413, error: 'Request too large' },
  invalid: { status: 400, error: 'Invalid request' },
  notFound: { status: 404, error: 'Not found' },
  unavailable: { status: 503, error: 'Depot data unavailable' },
} as const;

const GLOBAL_KEY = 'all';
const SNAPSHOT_DEADLINE = Symbol('snapshot-deadline');

function reply(
  body: CopilotApiResponse | CopilotApiError,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const fail = (kind: keyof typeof ERRORS): NextResponse =>
  reply({ error: ERRORS[kind].error }, ERRORS[kind].status);

const tooMany = (retryAfterSeconds: number): NextResponse =>
  reply({ error: 'Too many requests', retryAfterSeconds }, 429, {
    'Retry-After': String(retryAfterSeconds),
  });

/** The session is identified by a hash of its cookie, never by the raw value. */
function sessionKey(request: NextRequest): string {
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? '';
  return createHash('sha256').update(token).digest('hex');
}

async function loadWithin(
  load: () => Promise<FleetSnapshotView>,
  deadlineAt: number,
  now: number,
): Promise<FleetSnapshotView | typeof SNAPSHOT_DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof SNAPSHOT_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(SNAPSHOT_DEADLINE), Math.max(0, deadlineAt - now));
  });
  return Promise.race([load(), expiry]).finally(() => clearTimeout(timer));
}

/** Snapshot, then facts; a failure here has no facts to answer from, so it is a fixed 503. */
async function prepare(
  body: NonNullable<ReturnType<typeof parseCopilotBody>>,
  load: () => Promise<FleetSnapshotView>,
  runtime: CopilotRuntime,
  deadlineAt: number,
): Promise<Prepared | null> {
  let view: FleetSnapshotView | typeof SNAPSHOT_DEADLINE;
  try {
    view = await loadWithin(load, deadlineAt, runtime.now());
  } catch {
    logDepotError(LOG_SCOPE, 'snapshot_failed');
    return null;
  }
  if (view === SNAPSHOT_DEADLINE) {
    logDepotError(LOG_SCOPE, 'snapshot_deadline');
    return null;
  }
  try {
    return prepareCopilotRequest(body, view);
  } catch {
    logDepotError(LOG_SCOPE, 'prepare_failed');
    return null;
  }
}

/**
 * Everything after authentication, in the order that keeps work cheapest for
 * a hostile caller: origin and content type, then both rate limits, then a
 * capped body read and a strict parse, and only then the snapshot and the
 * engine. The caller has already checked the session.
 */
export async function handleCopilotPost(
  request: NextRequest,
  runtime: CopilotRuntime,
  loadSnapshot: () => Promise<FleetSnapshotView>,
): Promise<NextResponse> {
  const deadlineAt = runtime.now() + runtime.deadlineMs;
  if (!isSameOrigin(request)) return fail('origin');
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) return fail('contentType');

  const perSession = runtime.sessionLimiter.take(sessionKey(request));
  if (perSession.limited) return tooMany(perSession.retryAfterSeconds);
  const overall = runtime.globalLimiter.take(GLOBAL_KEY);
  if (overall.limited) return tooMany(overall.retryAfterSeconds);

  const raw = await readCappedBody(request, MAX_BODY_BYTES);
  if (!raw.ok) return fail(raw.status === 413 ? 'tooLarge' : 'invalid');
  const body = parseCopilotBody(raw.text);
  if (!body) return fail('invalid');

  const prepared = await prepare(body, loadSnapshot, runtime, deadlineAt);
  if (!prepared) return fail('unavailable');
  if (!prepared.ok) return fail('notFound');
  return reply(await answerCopilot(runtime, prepared, deadlineAt));
}

import type { NextRequest, NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/auth/origin';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { logDepotError } from '@/lib/depot/log';
import { requestIdentity, takeAll, type IdentityClaims } from '@/lib/depot/rateLimit';
import { readCappedBody } from '@/lib/depot/copilot/service/body';
import { BODY_READ_MS, LOG_SCOPE, MAX_BODY_BYTES } from '@/lib/depot/copilot/service/constants';
import { answerCopilot } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest, type Prepared } from '@/lib/depot/copilot/service/prepare';
import { fail, isJsonMediaType, reply, tooMany } from '@/lib/depot/copilot/service/respond';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { parseCopilotBody, type ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';
import { staleSentence } from '@/lib/depot/copilot/service/stale';

const PROCESS_KEY = 'all';
const SNAPSHOT_DEADLINE = Symbol('snapshot-deadline');

type Loaded = { readonly prepared: Prepared; readonly staleSentence?: string };

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
async function loadAndPrepare(
  body: ValidCopilotRequest,
  load: () => Promise<FleetSnapshotView>,
  runtime: CopilotRuntime,
  deadlineAt: number,
): Promise<Loaded | null> {
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
    return { prepared: prepareCopilotRequest(body, view), staleSentence: staleSentence(view) };
  } catch {
    logDepotError(LOG_SCOPE, 'prepare_failed');
    return null;
  }
}

/**
 * Everything after authentication, in the order that keeps work cheapest for
 * a hostile caller: origin and media type, then both request limits (checked
 * before either is spent), then a capped, timed body read and a strict parse,
 * and only then the snapshot and the engine.
 */
async function handleChecked(
  request: NextRequest,
  runtime: CopilotRuntime,
  loadSnapshot: () => Promise<FleetSnapshotView>,
  claims: Readonly<IdentityClaims>,
): Promise<NextResponse> {
  const deadlineAt = runtime.now() + runtime.deadlineMs;
  if (!isSameOrigin(request)) return fail('origin');
  if (!isJsonMediaType(request.headers.get('content-type'))) return fail('contentType');

  const identity = requestIdentity(claims, request.headers, runtime.env);
  const limit = takeAll([
    { limiter: runtime.identityLimiter, key: identity },
    { limiter: runtime.processLimiter, key: PROCESS_KEY },
  ]);
  if (limit.limited) return tooMany(limit.retryAfterSeconds);

  const waitMs = Math.min(BODY_READ_MS, deadlineAt - runtime.now());
  const raw = await readCappedBody(request, MAX_BODY_BYTES, waitMs);
  if (!raw.ok) return fail(raw.status === 413 ? 'tooLarge' : 'invalid');
  const body = parseCopilotBody(raw.text);
  if (!body) return fail('invalid');

  const loaded = await loadAndPrepare(body, loadSnapshot, runtime, deadlineAt);
  if (!loaded) return fail('unavailable');
  if (!loaded.prepared.ok) return fail('notFound');
  return reply(
    await answerCopilot(runtime, loaded.prepared, {
      deadlineAt,
      signal: request.signal,
      identity,
      staleSentence: loaded.staleSentence,
    }),
  );
}

/**
 * The route's handler. The caller has already verified the session and
 * passes its claims, which identify the caller for the limits. Anything that
 * throws past the guards is a fixed 503 with `no-store` and one reason code,
 * as in the house pattern; the error itself never leaves the server.
 */
export async function handleCopilotPost(
  request: NextRequest,
  runtime: CopilotRuntime,
  loadSnapshot: () => Promise<FleetSnapshotView>,
  claims: Readonly<IdentityClaims>,
): Promise<NextResponse> {
  try {
    return await handleChecked(request, runtime, loadSnapshot, claims);
  } catch {
    logDepotError(LOG_SCOPE, 'unexpected');
    return fail('unavailable');
  }
}

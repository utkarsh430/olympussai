import type { NextRequest, NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/auth/origin';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { requestLimitChecks } from '@/lib/depot/copilot/service/allowance';
import { logDepotError } from '@/lib/serverLog';
import { withheldStrings } from '@/lib/depot/copilot/errorText';
import { logCopilotFailure } from '@/lib/depot/copilot/service/failureLog';
import { requestAddress, requestIdentity, takeAll, type IdentityClaims } from '@/lib/depot/rateLimit';
import { readCappedBody } from '@/lib/depot/copilot/service/body';
import { BODY_READ_MS, LOG_SCOPE, MAX_BODY_BYTES } from '@/lib/depot/copilot/service/constants';
import { answerCopilot } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest, type Prepared } from '@/lib/depot/copilot/service/prepare';
import { fail, isJsonMediaType, reply, tooMany } from '@/lib/depot/copilot/service/respond';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { parseCopilotBody, type ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';
import { loadServiceData, type ServiceSources } from '@/lib/depot/copilot/service/serviceData';
import { dataSourceOf, staleSentence } from '@/lib/depot/copilot/service/stale';
import type { CopilotDataSource } from '@/lib/depot/copilot/wire';

const SNAPSHOT_DEADLINE = Symbol('snapshot-deadline');

type Loaded = {
  readonly prepared: Prepared;
  readonly staleSentence?: string;
  readonly dataSource?: CopilotDataSource;
};

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
  sources: ServiceSources | undefined,
): Promise<Loaded | null> {
  let view: FleetSnapshotView | typeof SNAPSHOT_DEADLINE;
  const withheld = (): readonly string[] =>
    withheldStrings({
      env: runtime.env,
      question: body.task === 'ask' ? body.question : undefined,
    });
  try {
    view = await loadWithin(load, deadlineAt, runtime.now());
  } catch (error: unknown) {
    logCopilotFailure(runtime, 'snapshot_failed', error, withheld());
    return null;
  }
  if (view === SNAPSHOT_DEADLINE) {
    logDepotError(LOG_SCOPE, 'snapshot_deadline');
    return null;
  }
  try {
    const service = sources === undefined ? {} : await loadServiceData(body, view, sources);
    return {
      prepared: prepareCopilotRequest(body, view, service),
      staleSentence: staleSentence(view),
      dataSource: dataSourceOf(view),
    };
  } catch (error: unknown) {
    logCopilotFailure(runtime, 'prepare_failed', error, withheld());
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
  sources: ServiceSources | undefined,
): Promise<NextResponse> {
  const deadlineAt = runtime.now() + runtime.deadlineMs;
  if (!isSameOrigin(request)) return fail('origin');
  if (!isJsonMediaType(request.headers.get('content-type'))) return fail('contentType');

  const identity = requestIdentity(claims, request.headers, runtime.env);
  const address = requestAddress(request.headers, runtime.env);
  const limit = takeAll(requestLimitChecks(runtime, identity, address));
  if (limit.limited) return tooMany(limit.retryAfterSeconds);

  const waitMs = Math.min(BODY_READ_MS, deadlineAt - runtime.now());
  const raw = await readCappedBody(request, MAX_BODY_BYTES, waitMs);
  if (!raw.ok) return fail(raw.status === 413 ? 'tooLarge' : 'invalid');
  const body = parseCopilotBody(raw.text);
  if (!body) return fail('invalid');

  const loaded = await loadAndPrepare(body, loadSnapshot, runtime, deadlineAt, sources);
  if (!loaded) return fail('unavailable');
  if (!loaded.prepared.ok) return fail('notFound');
  return reply(
    await answerCopilot(runtime, loaded.prepared, {
      deadlineAt,
      signal: request.signal,
      identity,
      address,
      staleSentence: loaded.staleSentence,
      dataSource: loaded.dataSource,
    }),
  );
}

/**
 * The route's handler. The caller has already verified the session and
 * passes its claims, which identify the caller for the limits. Anything that
 * throws past the guards is a fixed 503 with `no-store` and one log line (reason code,
 * writer, the error's class and bounded message); the error never leaves the server.
 * `sources` are the service stores the route and network kinds read; without them those
 * kinds answer that the data is not available.
 */
export async function handleCopilotPost(
  request: NextRequest,
  runtime: CopilotRuntime,
  loadSnapshot: () => Promise<FleetSnapshotView>,
  claims: Readonly<IdentityClaims>,
  sources?: ServiceSources,
): Promise<NextResponse> {
  try {
    return await handleChecked(request, runtime, loadSnapshot, claims, sources);
  } catch (error: unknown) {
    logCopilotFailure(runtime, 'unexpected', error, withheldStrings({ env: runtime.env }));
    return fail('unavailable');
  }
}

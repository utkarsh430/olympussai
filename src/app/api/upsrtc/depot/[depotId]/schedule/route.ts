import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { isValidDepotId } from '@/lib/depot/ids';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { buildScheduleResponse } from '@/lib/depot/live/scheduleView';
import { scheduleParamsSchema } from '@/lib/depot/schedule/api';
import type { ScheduleParams } from '@/lib/depot/schedule/types';
import { createWindowLimiter, requestIdentity, takeAll } from '@/lib/depot/rateLimit';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ depotId: string }>;
}

/** A what-if is a whole plan; a login may ask for a few a minute, the process for a few more. */
const WHAT_IF_LIMITS = { perIdentityPerMinute: 20, perProcessPerMinute: 120, windowMs: 60_000, maxIdentities: 5_000 } as const;
const MAX_BODY_CHARS = 16_384;
const perIdentity = createWindowLimiter({ now: () => Date.now(), limit: WHAT_IF_LIMITS.perIdentityPerMinute, windowMs: WHAT_IF_LIMITS.windowMs, maxKeys: WHAT_IF_LIMITS.maxIdentities });
const perProcess = createWindowLimiter({ now: () => Date.now(), limit: WHAT_IF_LIMITS.perProcessPerMinute, windowMs: WHAT_IF_LIMITS.windowMs, maxKeys: 1 });

async function answer(request: NextRequest, depotId: string, raw: ScheduleParams): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    const response = await buildScheduleResponse(view, depotId, repositories.crew, getServiceRepositories(), raw);
    if (!response) return jsonResponse({ error: 'Depot not found' }, { status: 404 });
    return jsonResponse(response, { acceptEncoding });
  } catch (error) {
    // The message can name hosts or carry tokens, so it stays on the server.
    logDepotError('schedule-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}

/** The depot's baseline schedule. */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();
  const { depotId } = await context.params;
  if (!isValidDepotId(depotId)) return jsonResponse({ error: 'Invalid depot id' }, { status: 400 });
  return answer(request, depotId, {});
}

/** The depot's schedule under a what-if; an empty body answers the baseline. Nothing is stored. */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();
  const { depotId } = await context.params;
  if (!isValidDepotId(depotId)) return jsonResponse({ error: 'Invalid depot id' }, { status: 400 });
  const decision = takeAll([
    { limiter: perIdentity, key: requestIdentity(session, request.headers, process.env) },
    { limiter: perProcess, key: 'process' },
  ]);
  if (decision.limited) return jsonResponse({ error: 'Too many requests', retryAfterSeconds: decision.retryAfterSeconds }, { status: 429 });
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return jsonResponse({ error: 'Invalid request body' }, { status: 400 });
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = scheduleParamsSchema.safeParse(raw);
  if (!parsed.success) return jsonResponse({ error: 'Invalid request body' }, { status: 400 });
  return answer(request, depotId, parsed.data);
}

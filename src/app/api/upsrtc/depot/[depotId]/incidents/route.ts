import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { isValidDepotId } from '@/lib/depot/ids';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { buildIncidentsResponse, declaredIncidentResponse } from '@/lib/depot/live/incidentView';
import { declareIncidentSchema } from '@/lib/depot/incident/api';
import { createWindowLimiter, requestIdentity, takeAll } from '@/lib/depot/rateLimit';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ depotId: string }>;
}

const DECLARE_LIMITS = { perIdentityPerMinute: 30, perProcessPerMinute: 200, windowMs: 60_000, maxIdentities: 5_000 } as const;
const MAX_BODY_CHARS = 2_048;
const perIdentity = createWindowLimiter({ now: () => Date.now(), limit: DECLARE_LIMITS.perIdentityPerMinute, windowMs: DECLARE_LIMITS.windowMs, maxKeys: DECLARE_LIMITS.maxIdentities });
const perProcess = createWindowLimiter({ now: () => Date.now(), limit: DECLARE_LIMITS.perProcessPerMinute, windowMs: DECLARE_LIMITS.windowMs, maxKeys: 1 });

/** The depot's suspected incidents with their replacement plans. */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();
  const { depotId } = await context.params;
  if (!isValidDepotId(depotId)) return jsonResponse({ error: 'Invalid depot id' }, { status: 400 });
  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    const response = await buildIncidentsResponse(view, depotId, repositories.crew, getServiceRepositories());
    if (!response) return jsonResponse({ error: 'Depot not found' }, { status: 404 });
    return jsonResponse(response, { acceptEncoding });
  } catch (error) {
    logDepotError('incidents-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}

/** A bus declared broken down by a person: its replacement plan. Nothing is stored. */
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
    raw = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = declareIncidentSchema.safeParse(raw);
  if (!parsed.success) return jsonResponse({ error: 'Invalid request body' }, { status: 400 });
  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    const response = await declaredIncidentResponse(view, depotId, parsed.data.registrationNumber, repositories.crew, getServiceRepositories());
    if (response === 'no_depot') return jsonResponse({ error: 'Depot not found' }, { status: 404 });
    if (response === 'no_bus') return jsonResponse({ error: 'Bus not in this depot' }, { status: 404 });
    return jsonResponse(response, { acceptEncoding });
  } catch (error) {
    logDepotError('incidents-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}

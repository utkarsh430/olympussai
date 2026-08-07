import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo, OpsKillSwitchConflictError } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const engageBodySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('network'), reason: z.string().trim().min(1).max(2000) }),
  z.object({
    scope: z.literal('route'),
    routeDirectionId: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/control-room/kill-switches — currently-engaged kill
 * switches (this ticket's AC: "route-level and network-wide"). Readable by
 * dispatcher/depot too (not just control_room): a dispatcher needs to know
 * automation is halted on their route before proposing an action into a
 * queue that will just sit there, same reasoning as the read-only
 * KillSwitchBanner shown on those dashboards.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['dispatcher', 'depot', 'control_room']);
  if (!guard.ok) return guard.response;

  try {
    const repo = getOpsRepo();
    const active = await repo.listKillSwitches(true);
    return NextResponse.json({ active }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

/**
 * POST /api/ops/control-room/kill-switches — engage a route-level or
 * network-wide kill switch (this ticket's AC: "immediately halt new
 * automatic commands ... both logged"). control_room only: this is the
 * most disruptive action this console exposes, so it stays scoped to the
 * role the ticket names as the owner of the network map / kill switches.
 * Enforced at POST /api/ops/control-room/commands, this app's one real
 * command-creation gate — see that route and the migration comment for why.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.', 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed request body.', 400);
  }

  const parsed = engageBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'scope must be "network" or "route" (with routeDirectionId), plus a reason.',
      400,
    );
  }

  try {
    const repo = getOpsRepo();
    const killSwitch = await repo.engageKillSwitch({
      scope: parsed.data.scope,
      routeDirectionId: parsed.data.scope === 'route' ? parsed.data.routeDirectionId : null,
      engagedBy: guard.claims.sub,
      reason: parsed.data.reason,
    });

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'control_room.kill_switch.engage',
      resourceType: 'ops_kill_switch',
      resourceId: killSwitch.id,
      metadata: { scope: killSwitch.scope, routeDirectionId: killSwitch.routeDirectionId, reason: killSwitch.reason },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json({ ok: true, killSwitch }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsKillSwitchConflictError) {
      return errorResponse('KILL_SWITCH_ALREADY_ENGAGED', error.message, 409);
    }
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { OpsDbConfigError } from '@/lib/db/pool';
import { getControlRoomOverview } from '@/lib/ops/controlRoomOverview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/control-room/overview — the console's status band, refreshed.
 *
 * WHY A ROUTE AT ALL. The control-room page is a Server Component render, so
 * before this the status band was only ever as current as the operator's last
 * manual reload. A control room that has to be refreshed by hand to notice a
 * new bunching incident is not a live console; the numbers under the map have
 * to move on their own. This is the read half of that, polled from
 * ControlRoomConsole on the single console clock.
 *
 * WHY IT IS NOT DEPOT-SCOPED, AND WHY THAT IS SAFE. `control_room` is the
 * statewide role — src/lib/ops/depotAccess.ts resolves it to
 * OPS_FLEET_SCOPE_ALL — and this route refuses every other role, including
 * `depot`. It also accepts no depot parameter of any kind, so there is nothing
 * to forge: a depot operator cannot reach it, and cannot widen it if they did.
 * `routeDirectionId` selects which corridor the headway/incident/KPI readings
 * describe and grants access to nothing.
 *
 * WHY NO SAME-ORIGIN CHECK. It matches every other operator-facing GET on this
 * surface (the approval queue, the kill-switch list, the fleet map): the
 * session cookie is SameSite=lax, the response is `no-store`, and nothing here
 * changes state. `isSameOrigin` guards the state-changing POSTs — issuing a
 * command, engaging a kill switch, asking the engine to solve — where a
 * cross-site request would actually do something.
 */

const querySchema = z.object({
  routeDirectionId: z.string().min(1).max(200).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    routeDirectionId: url.searchParams.get('routeDirectionId') ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse('INVALID_QUERY', 'routeDirectionId must be a non-empty string when provided.', 400);
  }

  try {
    const overview = await getControlRoomOverview(parsed.data.routeDirectionId);
    return NextResponse.json(overview, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // getControlRoomOverview composes readers that are each built not to
    // throw, so reaching here means the ops datastore itself is unconfigured
    // rather than one upstream being down - which the overview reports in
    // band, as `ok: false` per source, instead of failing the whole request.
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

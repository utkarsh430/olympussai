import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getWarRoomIncidents } from '@/lib/controlService/pilotData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/control-room/pilot/war-room?date=YYYY-MM-DD&routeDirectionId=
 *
 * The day's bunching incidents (eligible/exogenous/structural once
 * reviewed) with action and outcome (ticket AC3). `date` defaults to
 * today (UTC) in control-service.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? undefined;
  const routeDirectionId = url.searchParams.get('routeDirectionId') ?? undefined;

  const snapshot = await getWarRoomIncidents(date, routeDirectionId);
  return NextResponse.json(snapshot, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

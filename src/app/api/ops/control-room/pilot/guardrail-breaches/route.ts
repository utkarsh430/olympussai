import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getGuardrailBreaches } from '@/lib/controlService/pilotData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/control-room/pilot/guardrail-breaches?routeDirectionId=
 *
 * Real-time guardrail-breach feed (ticket AC4: "guardrail breaches ...
 * audit-logged and visible without waiting for day-end"). Short (5s) cache
 * TTL relative to the other pilot reads, since this is the one surface
 * this ticket explicitly promises is real-time.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const routeDirectionId = url.searchParams.get('routeDirectionId') ?? undefined;

  const snapshot = await getGuardrailBreaches(routeDirectionId);
  return NextResponse.json(snapshot, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

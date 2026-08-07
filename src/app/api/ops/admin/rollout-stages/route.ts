import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getRolloutStages } from '@/lib/controlService/pilotData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/admin/rollout-stages
 *
 * Admin-only list of every active route-direction's current pilot rollout
 * stage (ticket AC1). Read-only; the mutation is
 * PUT /api/ops/admin/rollout-stages/:id.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  const snapshot = await getRolloutStages();
  return NextResponse.json(snapshot, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { fetchShiftReportDraft } from '@/lib/copilot/service';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** GET /api/ops/control-room/copilot/shift-reports/[id] — reload a draft (e.g. after navigating away before saving/sending it). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid shift report id.', 400);
  }

  try {
    const draft = await fetchShiftReportDraft(parsedParams.data.id);
    if (!draft) {
      return errorResponse('NOT_FOUND', 'Shift report draft not found.', 404);
    }
    return NextResponse.json(draft, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Copilot storage is not configured.', 503);
    }
    throw error;
  }
}

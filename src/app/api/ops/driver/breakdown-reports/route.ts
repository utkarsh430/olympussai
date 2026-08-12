import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.enum(['Mechanical', 'Electrical', 'Tyre/wheel', 'Accident', 'Other']);

const bodySchema = z.object({
  vehicleReg: z.string().trim().min(1).max(50),
  category: categorySchema,
  description: z.string().trim().min(1).max(2000),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional(),
  category: categorySchema.optional(),
  vehicleReg: z.string().trim().min(1).max(50).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * The driver-scope audited-action endpoint filed as follow-up to ticket
 * 49d5b2d8's own out-of-scope note ("New audited-action API routes beyond
 * the two already listed [dispatcher/approvals, control-room/commands]; if
 * a dashboard needs an action with no existing endpoint, file it as a
 * separate ticket"). Mirrors POST /api/ops/dispatcher/approvals exactly:
 * requireOpsRole guard restricted to the submitting role, zod body
 * validation, same-origin check, one persisted row plus one fail-closed
 * ops_audit_log row per submission.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['driver']);
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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'A valid vehicleReg, category and description are required.',
      400,
    );
  }

  try {
    const repo = getOpsRepo();
    const report = await repo.createBreakdownReport({
      driverUserId: guard.claims.sub,
      vehicleReg: parsed.data.vehicleReg,
      category: parsed.data.category,
      description: parsed.data.description,
    });

    // Fail closed: if the audit write fails, the whole request 500s. A
    // breakdown report that exists without an audit trail entry is worse
    // than no report at all for an operational record.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'driver.breakdown_report.create',
      resourceType: 'ops_breakdown_report',
      resourceId: report.id,
      metadata: {
        vehicleReg: report.vehicleReg,
        category: report.category,
      },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, breakdownReportId: report.id, createdAt: report.createdAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

/**
 * A driver's own breakdown-report history. Always scoped server-side to
 * `guard.claims.sub` — same posture as GET /api/ops/pilot-driver/commands,
 * which derives the vehicle to poll from the caller's own ops_users row
 * rather than any client-supplied id. There is no `driverUserId` (or
 * equivalent) query param at all here, so there is nothing for a caller to
 * override even if they tried.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['driver']);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    before: searchParams.get('before') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    vehicleReg: searchParams.get('vehicleReg') ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      'INVALID_QUERY',
      parsed.error.issues[0]?.message ?? 'Invalid query parameters.',
      400,
    );
  }

  try {
    const repo = getOpsRepo();
    const { items, nextCursor } = await repo.listBreakdownReports({
      driverUserId: guard.claims.sub,
      limit: parsed.data.limit,
      before: parsed.data.before,
      category: parsed.data.category,
      vehicleReg: parsed.data.vehicleReg,
    });

    return NextResponse.json(
      { reports: items, nextCursor },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

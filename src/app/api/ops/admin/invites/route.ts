import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { deriveInviteStatus } from '@/lib/auth/rbac/inviteStatus';
import { generateInviteToken, hashInviteToken } from '@/lib/auth/rbac/tokens';
import { OPS_ROLES } from '@/lib/auth/rbac/roles';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { buildAcceptUrl } from '@/lib/auth/rbac/inviteUrl';
import { sendEmail } from '@/lib/email/resend';
import { renderInviteEmail } from '@/lib/email/inviteEmailTemplate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Admins may invite any of the five operational roles, or another admin —
// OPS_ROLES already includes 'admin', so no extra union is needed.
const inviteRoleSchema = z.enum(OPS_ROLES);

const bodySchema = z.object({
  email: z.string().email().max(254),
  role: inviteRoleSchema,
  // Opt-in only: the raw accept URL is a credential-equivalent, one-time
  // link. Since invite delivery now goes out over email by default, the API
  // omits it from the response unless the admin explicitly asks for it (e.g.
  // as a fallback while confirming Resend delivery is working).
  revealAcceptUrl: z.boolean().optional().default(false),
  // Optional vehicle assignment (db/migrations/20260806180000__ops_users_vehicle_assignment.sql),
  // copied onto the ops_users row on accept (repo.acceptInvite). Only
  // meaningful for driver/pilot_driver roles, but accepted for any role —
  // an admin can also leave it unset and assign later via
  // POST /api/ops/admin/users/:id/vehicle.
  vehicleId: z.string().trim().min(1).max(200).nullable().optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Create an admin invite. Only role guarded by 'admin' can call this — the
 * database also refuses non-admin callers implicitly (invited_by must be a
 * valid ops_users.id, and only admins reach this branch of the app), but the
 * guard is the enforced control (docs/CONTROL_SERVICE_INTEGRATION.md's
 * "Auth boundary: explicit, enforced at the API layer" principle applied
 * here to a first-party admin surface instead of the control-service one).
 *
 * The invite is emailed to the invitee via the Resend adapter
 * (src/lib/email/resend.ts) with a branded template
 * (src/lib/email/inviteEmailTemplate.ts) containing the accept link and its
 * expiry. The raw accept URL (a credential-equivalent, one-time link) is
 * never persisted and never logged, and is included in the API response
 * only when the admin explicitly opts in via `revealAcceptUrl: true` — by
 * default the response omits it and relies on the email. If Resend delivery
 * fails, the invite row is NOT rolled back (see repo.createInvite above);
 * the response instead reports `delivered: false` with an actionable
 * message so the admin can retry from the invites panel (POST
 * /api/ops/admin/invites/:id/resend).
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['admin']);
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
    return errorResponse('INVALID_BODY', 'A valid email and role are required.', 400);
  }

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    const repo = getOpsRepo();
    const invite = await repo.createInvite({
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: guard.claims.sub,
      tokenHash,
      expiresAt,
      vehicleId: parsed.data.vehicleId ?? null,
    });

    const acceptUrl = buildAcceptUrl(token);
    const emailTemplate = renderInviteEmail({
      role: invite.role,
      acceptUrl: acceptUrl.toString(),
      expiresAt: invite.expiresAt,
    });
    const emailResult = await sendEmail({
      to: invite.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    // Audit write happens before the response is returned; if this throws,
    // the invite is still in the database but unattributed-audit is treated
    // as a failure of the whole request (fail closed) — the 500 tells the
    // admin to retry rather than silently accepting an unaudited invite.
    // The email-delivery outcome is recorded in the same event so the audit
    // trail shows whether the invitee was actually notified.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.invite.create',
      resourceType: 'ops_invite',
      resourceId: invite.id,
      metadata: { email: invite.email, role: invite.role, emailDelivered: emailResult.ok },
      ip: clientIpFrom(request.headers),
    });

    if (!emailResult.ok) {
      console.error('[ops/admin/invites] email delivery failed', {
        inviteId: invite.id,
        error: emailResult.error,
      });
      // Fail gracefully: the invite record already exists and stays put.
      // Report the failure as part of a successful (201) response — the
      // resource WAS created — with an actionable next step, rather than
      // returning a 5xx that would suggest nothing happened.
      return NextResponse.json(
        {
          ok: true,
          delivered: false,
          inviteId: invite.id,
          expiresAt: invite.expiresAt,
          error: {
            code: 'EMAIL_DELIVERY_FAILED',
            message:
              'The invite was created, but the email could not be sent. Use "Resend email" ' +
              'from the invites panel to try again' +
              (parsed.data.revealAcceptUrl ? ', or share the accept link below.' : '.'),
          },
          ...(parsed.data.revealAcceptUrl ? { acceptUrl: acceptUrl.toString() } : {}),
        },
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        delivered: true,
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
        ...(parsed.data.revealAcceptUrl ? { acceptUrl: acceptUrl.toString() } : {}),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    // Unique-violation on ops_invites_pending_email_idx → a live invite already exists.
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return errorResponse(
        'INVITE_ALREADY_PENDING',
        'This email already has a pending invite.',
        409,
      );
    }
    throw error;
  }
}

/**
 * List outstanding (not yet accepted, not revoked) invites for the admin
 * panel — backs the expiry/status state and the resend action on
 * OpsAdminInvitesPanel.tsx. Never returns token_hash.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  try {
    const invites = await getOpsRepo().listOutstandingInvites();
    return NextResponse.json(
      {
        invites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          status: deriveInviteStatus(invite),
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
        })),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

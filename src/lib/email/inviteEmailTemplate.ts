/**
 * Branded invite-email template. Pure/no dependencies (no `server-only`
 * marker) so it is unit-testable and reusable from both the create-invite
 * and resend-invite route handlers.
 */
import type { OpsRole } from '@/lib/auth/rbac/roles';

export interface InviteEmailInput {
  role: OpsRole;
  acceptUrl: string;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ROLE_LABEL: Record<OpsRole, string> = {
  driver: 'Driver',
  pilot_driver: 'Pilot Driver',
  dispatcher: 'Dispatcher',
  depot: 'Depot',
  control_room: 'Control Room',
  planner: 'Planner',
  admin: 'Admin',
};

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders the subject/html/text of the invite email. Escapes every value interpolated into HTML. */
export function renderInviteEmail(input: InviteEmailInput): RenderedEmail {
  const roleLabel = ROLE_LABEL[input.role] ?? input.role;
  const expiry = formatExpiry(input.expiresAt);
  const subject = `You're invited to Olympuss Ops as ${roleLabel}`;

  const safeAcceptUrl = escapeHtml(input.acceptUrl);
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeExpiry = escapeHtml(expiry);

  const text = [
    `You've been invited to join Olympuss Ops as ${roleLabel}.`,
    '',
    `Accept your invite: ${input.acceptUrl}`,
    '',
    `This link expires on ${expiry} and can only be used once.`,
    "If you weren't expecting this invite, you can safely ignore this email.",
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0a0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0b10;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#12141c;border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <p style="margin:0;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#a3a7b2;">
                  Olympuss Ops
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0;font-size:20px;line-height:1.4;color:#e6e9ef;">
                  You're invited as ${safeRoleLabel}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 0 32px;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:#9aa0ad;">
                  An admin has invited you to join the Olympuss operations
                  console with the <strong style="color:#e6e9ef;">${safeRoleLabel}</strong> role. Accept the invite
                  below to set your password and sign in.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <a href="${safeAcceptUrl}"
                   style="display:inline-block;background-color:rgba(79,140,255,0.12);border:1px solid rgba(79,140,255,0.6);color:#8fb4ff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px;">
                  Accept invite
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7684;word-break:break-all;">
                  Or paste this link into your browser:<br />
                  <span style="color:#8fb4ff;">${safeAcceptUrl}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7684;">
                  This link expires on <strong style="color:#9aa0ad;">${safeExpiry}</strong> and can only be used once.
                  If you weren't expecting this invite, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Resend adapter — the only place that talks to the Resend HTTP API.
 *
 * Implemented as a plain `fetch` call against Resend's REST endpoint rather
 * than the `resend` npm package: this repo has no vendor SDK dependencies
 * anywhere else (see src/lib/upsrtc/client.ts for the same fetch-with-timeout
 * pattern against a different upstream), and a single documented POST
 * endpoint does not justify adding one. Node runtime only, same rule as the
 * rest of src/lib/auth/rbac/* (this is invoked from route handlers that are
 * already `export const runtime = 'nodejs'`).
 *
 * Callers must treat a failed send as recoverable: the caller's own record
 * (e.g. an ops_invites row) must already be persisted before this is called,
 * and a failure here must never be used to roll that record back — see
 * docs/olympuss/RBAC.md's "email delivery" section.
 */
import 'server-only';

const RESEND_API_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? 'Olympuss Ops <ops@olympuss.us>';
}

/**
 * Send one email through Resend. Never throws — every failure mode (missing
 * API key, network error, timeout, non-2xx response) is reported back as
 * `{ ok: false, error }` so callers can decide how to surface it, per the
 * "fail gracefully, do not silently drop the underlying record" rule.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      // Never log the API key or the email body (may contain the accept
      // link); the status + a truncated, best-effort error body is enough
      // to diagnose a delivery failure without leaking a credential-equivalent
      // link into logs.
      const bodyText = await response.text().catch(() => '');
      console.error('[resend] delivery failed', {
        status: response.status,
        body: bodyText.slice(0, 300),
      });
      return { ok: false, error: `Resend API responded with HTTP ${response.status}` };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: data?.id ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[resend] delivery threw', { message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

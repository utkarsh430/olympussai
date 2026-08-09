/**
 * HMAC verification for inbound control-service -> web webhook deliveries.
 *
 * The exact counterpart of control-service/src/webhooks/sign.ts, reimplemented
 * here rather than imported: the two packages are deployed independently and
 * share no build (docs/CONTROL_SERVICE_INTEGRATION.md §3). The algorithm is
 * three lines, and duplicating it means a change on either side shows up as a
 * failing test instead of as a silent version skew.
 *
 * Contract, byte for byte:
 *   signed string  `${timestamp}.${rawBody}`
 *   timestamp      Unix SECONDS, decimal string (not ms, not ISO)
 *   signature      lowercase hex sha256 HMAC — no `sha256=` prefix
 *
 * Node runtime only (`node:crypto`). Never import this from edge middleware.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Accepted clock skew between the sender's timestamp and ours, in seconds.
 *
 * 300s is roughly 20x the sender's entire retry budget (3 attempts, 5s timeout
 * each, 250ms + 500ms backoff — under 16s worst case), so a legitimate retry
 * from a host with a mildly wrong clock still lands, while the replay window
 * an intercepted request stays valid in remains tight.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Unix-seconds decimal string, 1-10 digits (10 digits covers every value until 2286). */
const TIMESTAMP_PATTERN = /^\d{1,10}$/;

/** sha256 produces 32 bytes / 64 hex chars. */
const SIGNATURE_BYTE_LENGTH = 32;

export type WebhookVerificationFailure =
  | 'MISSING_SIGNATURE_HEADERS'
  | 'INVALID_TIMESTAMP'
  | 'STALE_TIMESTAMP'
  | 'INVALID_SIGNATURE';

export type WebhookVerificationResult =
  | { ok: true; timestampSeconds: number }
  | { ok: false; code: WebhookVerificationFailure; message: string };

export interface WebhookVerificationInput {
  /** The EXACT request bytes as text. Never a re-serialization of a parsed object. */
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  idempotencyKey: string | null;
  secret: string;
  /** Injectable for tests; defaults to the real clock. */
  nowSeconds?: number;
}

/** Computes the signature control-service would have produced for these bytes. */
export function signControlServiceWebhook(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` THROWS on differing buffer lengths, which would turn a
 * malformed signature into a 500 (retryable — the sender would burn three
 * attempts on an attacker-controlled request). Both buffers are therefore
 * length-checked to 32 bytes first, and anything else is simply "not equal".
 */
function digestsMatch(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length !== SIGNATURE_BYTE_LENGTH || provided.length !== SIGNATURE_BYTE_LENGTH) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

/**
 * Verifies headers + body against the shared secret.
 *
 * Ordering matters and is deliberate: everything here runs BEFORE the body is
 * parsed as JSON, so an unauthenticated caller never reaches the parser.
 */
export function verifyControlServiceWebhook(
  input: WebhookVerificationInput,
): WebhookVerificationResult {
  const { rawBody, timestamp, signature, idempotencyKey, secret } = input;

  if (!timestamp || !signature || !idempotencyKey) {
    return {
      ok: false,
      code: 'MISSING_SIGNATURE_HEADERS',
      message: 'Signature, timestamp and idempotency-key headers are required.',
    };
  }

  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return {
      ok: false,
      code: 'INVALID_TIMESTAMP',
      message: 'Timestamp header must be Unix seconds.',
    };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Two-sided: a far-future timestamp is as suspect as a stale one, and would
  // otherwise extend an intercepted request's replay window indefinitely.
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      ok: false,
      code: 'STALE_TIMESTAMP',
      message: 'Timestamp is outside the accepted window.',
    };
  }

  if (!digestsMatch(signControlServiceWebhook(rawBody, timestamp, secret), signature)) {
    return { ok: false, code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' };
  }

  return { ok: true, timestampSeconds };
}

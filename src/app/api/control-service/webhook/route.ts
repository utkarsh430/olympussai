import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { OpsDbConfigError } from '@/lib/db/pool';
import { verifyControlServiceWebhook } from '@/lib/webhooks/controlServiceSignature';
import {
  applyWebhookSideEffects,
  eventTimeFor,
  markEventFailed,
  markEventProcessed,
  storeWebhookEvent,
} from '@/lib/webhooks/controlServiceEvents';
import {
  controlServiceWebhookEventSchema,
  controlServiceWebhookEventTypeSchema,
  webhookEventEnvelopeSchema,
} from '@/models/control';

/**
 * POST /api/control-service/webhook — the inbound half of the control-service
 * integration (docs/CONTROL_SERVICE_INTEGRATION.md §1 "Control service ->
 * web").
 *
 * Until this route existed, control-service POSTed every command lifecycle
 * event to WEB_APP_WEBHOOK_URL and received a 404. Its retry policy only
 * retries 408/429/5xx (control-service/src/webhooks/dispatch.ts), so a 404 was
 * terminal: every event was dropped after a single attempt, and the control
 * room could only discover that a driver answered UNABLE or UNSAFE by polling.
 *
 * AUTHENTICATION IS THE HMAC AND NOTHING ELSE. There is no Authorization
 * header on these deliveries and no ops session — this path is exempt from the
 * ops RBAC middleware on purpose (see src/middleware.ts). Every branch below
 * runs before the body is parsed, so an unauthenticated caller never reaches
 * the JSON parser.
 *
 * Status codes are tuned to the SENDER's retry policy rather than to generic
 * REST taste:
 *   200  processed, or a duplicate that was already processed
 *   413  body over 256 KB
 *   400  bad signature / bad or stale timestamp / unparseable body / schema
 *        mismatch — deliberately NOT retryable. A retry cannot fix a bad
 *        signature, and answering 5xx would make the sender spend three
 *        attempts and ~15s on an attacker-controlled request.
 *   503  secret unset or datastore unavailable — retryable on purpose, so a
 *        misconfigured or briefly-down deploy drops nothing.
 *   500  stored but a side effect threw — retryable, and `processed_at` is
 *        left null so the retry re-runs the side effects.
 *   200  unknown event type — forward compatibility; 4xx-ing a benign new
 *        event type would make the sender log delivery errors forever.
 */
export const runtime = 'nodejs'; // node:crypto timingSafeEqual + pg — never edge
export const dynamic = 'force-dynamic';

/**
 * 256 KB, measured in BYTES rather than in JS string length.
 *
 * A `{command}` envelope is a couple of KB at most; this cap exists so an
 * unauthenticated caller cannot make us hash an arbitrarily large body, and is
 * therefore checked BEFORE the HMAC is computed.
 *
 * `String.length` counts UTF-16 code units, so measuring it would let a body
 * of multi-byte characters through at up to ~3x this size — precisely the
 * payload an attacker probing this endpoint would send. `Buffer.byteLength`
 * measures what actually gets hashed.
 */
const MAX_BODY_BYTES = 256_000;

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function okResponse(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/** Best-effort command id for the event log's index column; null when absent or not a string. */
function commandIdFrom(data: Record<string, unknown>): string | null {
  const command = data.command;
  if (typeof command !== 'object' || command === null) return null;
  const id = (command as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.CONTROL_SERVICE_WEBHOOK_SECRET;
  if (!secret || !secret.trim()) {
    // 503, not 500: retryable. A deploy that forgot the secret gets fixed, and
    // in the meantime the sender keeps re-offering the event instead of
    // discarding it — there is no outbox on the other side to replay from.
    console.error('[control-service/webhook] CONTROL_SERVICE_WEBHOOK_SECRET is not configured');
    return errorResponse('NOT_CONFIGURED', 'Webhook receiver is not configured.', 503);
  }

  // The EXACT bytes. Never request.json() followed by a re-stringify: key
  // order and number formatting are not guaranteed to survive that round trip,
  // so the recomputed HMAC would fail intermittently in a way indistinguishable
  // from a wrong secret. This is the single most important line in the file.
  const raw = await request.text();

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  }

  const headerIdempotencyKey = request.headers.get('x-control-service-idempotency-key');
  const verification = verifyControlServiceWebhook({
    rawBody: raw,
    timestamp: request.headers.get('x-control-service-timestamp'),
    signature: request.headers.get('x-control-service-signature'),
    idempotencyKey: headerIdempotencyKey,
    secret,
  });

  if (!verification.ok) {
    console.warn('[control-service/webhook] rejected delivery', { code: verification.code });
    return errorResponse(verification.code, verification.message, 400);
  }

  // ---- authenticated from here on -----------------------------------------

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed JSON body.', 400);
  }

  const envelope = webhookEventEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return errorResponse('INVALID_BODY', 'Body is not a control-service webhook envelope.', 400);
  }

  // The body's idempotencyKey is authoritative because it is covered by the
  // signature; the header is not signed and so cannot be trusted to key
  // deduplication. They are the same value from a healthy sender — a mismatch
  // means something rewrote the request in flight, which is worth a log line
  // but not a rejection (the signed value is still trustworthy).
  const idempotencyKey = envelope.data.idempotencyKey;
  if (headerIdempotencyKey !== idempotencyKey) {
    console.warn('[control-service/webhook] idempotency key header disagrees with signed body', {
      idempotencyKey,
    });
  }

  const knownType = controlServiceWebhookEventTypeSchema.safeParse(envelope.data.type);

  try {
    const stored = await storeWebhookEvent({
      idempotencyKey,
      eventType: envelope.data.type,
      commandId: commandIdFrom(envelope.data.data),
      payload: envelope.data,
    });

    if (!stored.inserted && stored.processedAt !== null) {
      // Already handled end to end. Re-running the side effects would be
      // harmless (they are idempotent) but pointless.
      return okResponse({ ok: true, idempotencyKey, duplicate: true });
    }

    // Falling through here on a duplicate whose processed_at is still null is
    // deliberate: without it, one transient side-effect failure would swallow
    // the event permanently.

    if (!knownType.success) {
      // Recorded in full (payload included) so support can be added later and
      // the event replayed from ops_control_service_webhook_events — but no
      // side effect runs, and the sender gets a 200 so a new control-service
      // event type never looks like an outage.
      console.warn('[control-service/webhook] unknown event type, stored without side effects', {
        type: envelope.data.type,
        idempotencyKey,
      });
      await markEventProcessed(idempotencyKey);
      return okResponse({ ok: true, idempotencyKey, ignored: true });
    }
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      console.error('[control-service/webhook] ops datastore is not configured');
      return errorResponse('NOT_CONFIGURED', 'Ops datastore is not configured.', 503);
    }
    console.error('[control-service/webhook] failed to record delivery', {
      idempotencyKey,
      message: error instanceof Error ? error.message : String(error),
    });
    // Nothing was stored, so this event must not be considered delivered.
    return errorResponse('STORAGE_UNAVAILABLE', 'Unable to record the event.', 503);
  }

  const event = controlServiceWebhookEventSchema.safeParse(envelope.data);
  if (!event.success) {
    // A known type whose payload does not match the contract is a sender bug,
    // not a transient failure — 400 so the sender stops rather than retrying
    // something that cannot succeed. The raw payload is already persisted for
    // diagnosis.
    console.error('[control-service/webhook] known event type failed schema validation', {
      type: envelope.data.type,
      idempotencyKey,
    });
    await markEventFailed(idempotencyKey, 'schema validation failed').catch(() => {});
    return errorResponse('INVALID_EVENT', 'Event payload does not match the contract.', 400);
  }

  try {
    await applyWebhookSideEffects(event.data, eventTimeFor(event.data, verification.timestampSeconds));
    await markEventProcessed(idempotencyKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[control-service/webhook] side effects failed', {
      type: event.data.type,
      idempotencyKey,
      message,
    });
    // processed_at stays null, so the sender's retry takes the
    // duplicate-but-unprocessed branch above and tries the side effects again.
    await markEventFailed(idempotencyKey, message).catch(() => {});
    return errorResponse('PROCESSING_FAILED', 'Event stored but not yet processed.', 500);
  }

  return okResponse({ ok: true, idempotencyKey, type: event.data.type });
}

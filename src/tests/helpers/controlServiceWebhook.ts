/**
 * Test-side reimplementation of the control-service webhook SENDER.
 *
 * Deliberately NOT imported from control-service/: that is a separately
 * deployed package with its own tsconfig/build and is not resolvable from this
 * app's module graph. The signing algorithm is three lines, so it is mirrored
 * here verbatim from control-service/src/webhooks/sign.ts + dispatch.ts. If
 * either side ever changes, these tests fail — which is the point: a silent
 * version skew between signer and verifier is exactly the bug this suite
 * exists to catch.
 *
 * Mirrored source, byte for byte:
 *   dispatch.ts  const rawBody = JSON.stringify({ type, idempotencyKey, data })
 *   sign.ts      createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
 *   sign.ts      headers: content-type + x-control-service-{timestamp,signature,idempotency-key}
 *                (there is NO Authorization header — the HMAC is the only auth)
 */
import { createHmac } from 'node:crypto';

/** The shared secret both ends of the HMAC use in tests. */
export const TEST_SECRET = 'shared-hmac-secret-for-tests';

/** control-service/src/webhooks/sign.ts:signWebhookPayload, verbatim. */
export function signWebhookPayload(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** control-service/src/webhooks/dispatch.ts:dispatchWebhook's body serialization, verbatim. */
export function serializeEnvelope(
  type: string,
  idempotencyKey: string,
  data: Record<string, unknown>,
): string {
  return JSON.stringify({ type, idempotencyKey, data });
}

export interface SignedDelivery {
  rawBody: string;
  headers: Record<string, string>;
}

/**
 * Produces the exact bytes + headers control-service would send.
 *
 * `rawBodyOverride` exists so a test can send bytes that differ from the ones
 * that were signed (tampering, re-serialization) or sign bytes that are not
 * the canonical `JSON.stringify` output (proving the receiver hashes what it
 * actually received rather than a re-serialization of it).
 */
export function buildSignedDelivery(input: {
  type: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
  secret?: string;
  timestampSeconds?: number;
  /** Bytes actually sent. Defaults to the signed bytes. */
  rawBodyOverride?: string;
  /** Bytes actually signed. Defaults to the canonical serialization. */
  signedBodyOverride?: string;
}): SignedDelivery {
  const secret = input.secret ?? TEST_SECRET;
  const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const canonical = serializeEnvelope(input.type, input.idempotencyKey, input.data);
  const signedBody = input.signedBodyOverride ?? canonical;
  const rawBody = input.rawBodyOverride ?? signedBody;

  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-control-service-timestamp': timestamp,
      'x-control-service-signature': signWebhookPayload(signedBody, timestamp, secret),
      'x-control-service-idempotency-key': input.idempotencyKey,
    },
  };
}

/**
 * A full camelCase CommandRow as control-service serializes it
 * (control-service/src/db/commands.ts:CommandRow — every field, none omitted).
 */
export function buildCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recommendationId: null,
    vehicleId: 'BUS-100',
    tripId: null,
    actionType: 'speed_guidance',
    targetStopId: null,
    parameters: { targetSpeedKph: 32 },
    dispatcherActionId: '22222222-2222-4222-8222-222222222222',
    ttlSeconds: 120,
    validFrom: '2026-08-08T06:00:00.000Z',
    expiresAt: '2026-08-08T06:02:00.000Z',
    policyVersion: 'v1',
    status: 'delivered',
    version: 1,
    supersedesCommandId: null,
    deliveredAt: '2026-08-08T06:00:10.000Z',
    acknowledgedAt: null,
    acknowledgementReason: null,
    ackOutcome: null,
    createdAt: '2026-08-08T06:00:00.000Z',
    ...overrides,
  };
}

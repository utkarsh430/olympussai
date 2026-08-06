// HMAC-SHA256 signing for outbound control-service -> web webhook
// deliveries (docs/CONTROL_SERVICE_INTEGRATION.md section 1: "Each request
// carries an HMAC-SHA256 signature over the raw body plus a timestamp
// header"). The web app's handler recomputes this same signature to
// verify authenticity and reject replays outside a clock-skew window.
import { createHmac } from 'node:crypto';

export interface SignedPayload {
  timestamp: string;
  signature: string;
}

/** Signs `rawBody` (the exact bytes that will be sent) together with the timestamp, so the receiver can bind the signature to both the body and the delivery time (replay protection). */
export function signWebhookPayload(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function buildSignedHeaders(
  rawBody: string,
  secret: string,
  idempotencyKey: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(rawBody, timestamp, secret);
  return {
    'content-type': 'application/json',
    'x-control-service-timestamp': timestamp,
    'x-control-service-signature': signature,
    'x-control-service-idempotency-key': idempotencyKey,
  };
}

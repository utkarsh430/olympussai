import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookPayload, buildSignedHeaders } from '../src/webhooks/sign.js';

describe('webhook signing', () => {
  it('produces a signature the receiver can independently recompute', () => {
    const rawBody = JSON.stringify({ hello: 'world' });
    const timestamp = '1700000000';
    const secret = 'shared-secret';

    const signature = signWebhookPayload(rawBody, timestamp, secret);
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    expect(signature).toBe(expected);
  });

  it('changes the signature if the body changes (tamper-evident)', () => {
    const timestamp = '1700000000';
    const secret = 'shared-secret';
    const sigA = signWebhookPayload('{"a":1}', timestamp, secret);
    const sigB = signWebhookPayload('{"a":2}', timestamp, secret);
    expect(sigA).not.toBe(sigB);
  });

  it('changes the signature if the timestamp changes (replay protection)', () => {
    const rawBody = '{"a":1}';
    const secret = 'shared-secret';
    const sigA = signWebhookPayload(rawBody, '1700000000', secret);
    const sigB = signWebhookPayload(rawBody, '1700000001', secret);
    expect(sigA).not.toBe(sigB);
  });

  it('builds headers carrying timestamp, signature and idempotency key', () => {
    const headers = buildSignedHeaders('{"a":1}', 'secret', 'idem-123');
    expect(headers['x-control-service-idempotency-key']).toBe('idem-123');
    expect(headers['x-control-service-timestamp']).toMatch(/^\d+$/);
    expect(headers['x-control-service-signature']).toMatch(/^[a-f0-9]{64}$/);
  });
});

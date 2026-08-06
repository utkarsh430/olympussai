// Outbound webhook dispatch: delivers, retries on retryable failure, gives
// up (without throwing) on non-retryable / exhausted-retries failure -
// docs/CONTROL_SERVICE_INTEGRATION.md section 2 "Control service -> web
// (inbound webhook)" failure-isolation expectations, from the sender side.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchWebhook } from '../src/webhooks/dispatch.js';

describe('dispatchWebhook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('delivers successfully on the first attempt', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await dispatchWebhook({ type: 'command.created', data: { foo: 'bar' } });

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on a retryable (5xx) status and eventually succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await dispatchWebhook({ type: 'command.created', data: {} });

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('does not retry a non-retryable (4xx) status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 400 }));

    const result = await dispatchWebhook({ type: 'command.created', data: {} });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries and reports failure without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

    const result = await dispatchWebhook({ type: 'command.created', data: {} });

    expect(result.delivered).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('signs every delivery attempt with the idempotency key it returns', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await dispatchWebhook({ type: 'command.created', idempotencyKey: 'fixed-key', data: {} });

    expect(result.idempotencyKey).toBe('fixed-key');
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-control-service-idempotency-key']).toBe('fixed-key');
    expect(headers['x-control-service-signature']).toBeDefined();
  });
});

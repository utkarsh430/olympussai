import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCopilot } from '@/lib/depot/copilot/ui/copilotClient';
import type { CopilotApiRequest } from '@/lib/depot/copilot/wire';

const BODY: CopilotApiRequest = { task: 'briefing', scope: { kind: 'network' } };
const GOOD = {
  headline: 'Network briefing',
  paragraphs: ['One.', 'Two.'],
  provider: 'claude',
  notice: 'none',
  generatedAt: '2026-10-06T09:30:00.000Z',
  cached: false,
  facts: [{ id: 'f1', label: 'Depots', text: '143', provenance: 'live' }],
};
const originalFetch = globalThis.fetch;

function stub(status: number, body: unknown, jsonThrows = false): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (jsonThrows) throw new SyntaxError('bad json');
      return body;
    },
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('requestCopilot', () => {
  it('posts JSON to the contract url without caching', async () => {
    const fn = stub(200, GOOD);
    const signal = new AbortController().signal;
    await requestCopilot(BODY, signal);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/upsrtc/depot/copilot');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(BODY);
  });

  it('puts an ask question only in the body, never the url', async () => {
    const fn = stub(200, GOOD);
    await requestCopilot({ task: 'ask', question: 'Which depots?', scope: { kind: 'network' } });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('Which');
    expect(JSON.parse(init.body as string).question).toBe('Which depots?');
  });

  it('returns the response on 200', async () => {
    stub(200, GOOD);
    expect(await requestCopilot(BODY)).toEqual({ ok: true, response: GOOD });
  });

  it('accepts ask fields and tolerates unknown extra keys', async () => {
    stub(200, {
      ...GOOD,
      extra: 1,
      interpretedAs: 'Depot ranking',
      table: { columns: ['A'], rows: [['x']] },
    });
    expect((await requestCopilot(BODY)).ok).toBe(true);
  });

  it.each([
    [401, 'session_expired'],
    [404, 'not_found'],
    [400, 'invalid'],
    [403, 'forbidden'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [418, 'unavailable'],
  ])('maps status %i to %s', async (status, kind) => {
    stub(status, { error: 'x' });
    expect(await requestCopilot(BODY)).toEqual({ ok: false, kind });
  });

  it('reads retryAfterSeconds on 429', async () => {
    stub(429, { error: 'slow', retryAfterSeconds: 12 });
    expect(await requestCopilot(BODY)).toEqual({
      ok: false,
      kind: 'rate_limited',
      retryAfterSeconds: 12,
    });
  });

  it('falls back to a positive wait on 429 without a usable number', async () => {
    stub(429, { error: 'slow' });
    const missing = await requestCopilot(BODY);
    expect(missing).toMatchObject({ ok: false, kind: 'rate_limited' });
    stub(429, { error: 'slow', retryAfterSeconds: -4 });
    const negative = await requestCopilot(BODY);
    for (const result of [missing, negative]) {
      expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['missing headline', { ...GOOD, headline: undefined }],
    ['paragraph not a string', { ...GOOD, paragraphs: [1] }],
    ['unknown provider', { ...GOOD, provider: 'gpt' }],
    ['unknown notice', { ...GOOD, notice: 'weird' }],
    ['cached not boolean', { ...GOOD, cached: 'no' }],
    ['bad fact provenance', { ...GOOD, facts: [{ ...GOOD.facts[0], provenance: 'other' }] }],
    ['table cell not text', { ...GOOD, table: { columns: ['a'], rows: [[3]] } }],
  ])('treats a malformed 200 body (%s) as unavailable', async (_name, body) => {
    stub(200, body);
    expect(await requestCopilot(BODY)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('treats an unparseable 200 body as unavailable', async () => {
    stub(200, null, true);
    expect(await requestCopilot(BODY)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('reports network on a thrown fetch', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await requestCopilot(BODY)).toEqual({ ok: false, kind: 'network' });
  });

  it('reports aborted when the signal fired during a thrown fetch', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    expect(await requestCopilot(BODY, controller.signal)).toEqual({ ok: false, kind: 'aborted' });
  });

  it('reports aborted when fetch resolves after the signal fired', async () => {
    const controller = new AbortController();
    stub(200, GOOD);
    controller.abort();
    expect(await requestCopilot(BODY, controller.signal)).toEqual({ ok: false, kind: 'aborted' });
  });
});

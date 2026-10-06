// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWindowLimiter } from '@/lib/depot/copilot/service/rateLimit';
import { cacheKey, createResponseCache } from '@/lib/depot/copilot/service/cache';
import { readCappedBody } from '@/lib/depot/copilot/service/body';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';
import { MAX_BODY_BYTES } from '@/lib/depot/copilot/service/constants';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import type { CopilotRequest, CopilotText } from '@/lib/depot/copilot/types';

const REQUEST: CopilotRequest = {
  task: 'briefing',
  scopeLabel: 'the network',
  facts: [{ id: 'a', label: 'A', text: '12', provenance: 'live' }],
  guidance: 'g',
  scriptedDraft: { headline: 'H', paragraphs: ['{{fact:a}}'] },
};
const TEXT: CopilotText = {
  headline: 'H',
  paragraphs: ['12'],
  provider: 'claude-cli',
  usedFactIds: ['a'],
  generatedAt: '2026-10-06T08:00:00.000Z',
  fellBack: false,
  fallbackReason: null,
};

describe('createWindowLimiter', () => {
  it('allows the limit per window, then refuses with the seconds until a slot frees', () => {
    let now = 0;
    const limiter = createWindowLimiter({ now: () => now, limit: 2, windowMs: 60_000, maxKeys: 10 });
    expect(limiter.take('s').limited).toBe(false);
    now = 10_000;
    expect(limiter.take('s').limited).toBe(false);
    expect(limiter.take('s')).toEqual({ limited: true, retryAfterSeconds: 50 });
    expect(limiter.take('other').limited).toBe(false);
    now = 60_000;
    expect(limiter.take('s').limited).toBe(false);
  });

  it('a refused request does not extend the wait', () => {
    let now = 0;
    const limiter = createWindowLimiter({ now: () => now, limit: 1, windowMs: 1_000, maxKeys: 10 });
    limiter.take('s');
    for (let i = 0; i < 5; i += 1) expect(limiter.take('s').limited).toBe(true);
    now = 1_000;
    expect(limiter.take('s').limited).toBe(false);
  });

  it('never tracks more than maxKeys keys', () => {
    const limiter = createWindowLimiter({ now: () => 0, limit: 1, windowMs: 1_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd']) limiter.take(key);
    expect(limiter.size()).toBe(3);
  });
});

describe('response cache', () => {
  it('returns a stored text until it ages out', () => {
    let now = 0;
    const cache = createResponseCache({ now: () => now, ttlMs: 1_000, maxEntries: 5 });
    cache.set('k', TEXT);
    expect(cache.get('k')).toEqual(TEXT);
    now = 1_000;
    expect(cache.get('k')).toBeNull();
  });

  it('evicts the oldest entry beyond maxEntries', () => {
    const cache = createResponseCache({ now: () => 0, ttlMs: 1_000, maxEntries: 2 });
    cache.set('a', TEXT);
    cache.set('b', TEXT);
    cache.set('c', TEXT);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('c')).toEqual(TEXT);
  });

  it('keys on the task and the facts, as a hash with no clear text', () => {
    const key = cacheKey(REQUEST);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ ...REQUEST })).toBe(key);
    expect(cacheKey({ ...REQUEST, task: 'answer' })).not.toBe(key);
    const changed = [{ ...REQUEST.facts[0]!, text: '13' }];
    expect(cacheKey({ ...REQUEST, facts: changed })).not.toBe(key);
  });
});

const post = (body: BodyInit | null, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost:3000/x', {
    method: 'POST',
    body,
    headers,
    ...({ duplex: 'half' } as Record<string, string>),
  });

describe('readCappedBody', () => {
  it('reads a body within the cap', async () => {
    expect(await readCappedBody(post('{"a":1}'), 100)).toEqual({ ok: true, text: '{"a":1}' });
  });

  it('refuses a declared length over the cap without reading', async () => {
    const result = await readCappedBody(post('{}', { 'content-length': '999999' }), 100);
    expect(result).toEqual({ ok: false, status: 413 });
  });

  it('stops reading an undeclared stream as soon as it passes the cap', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 10_000) controller.close();
        else controller.enqueue(new Uint8Array(1_024));
      },
    });
    expect(await readCappedBody(post(stream), MAX_BODY_BYTES)).toEqual({ ok: false, status: 413 });
    expect(pulls).toBeLessThan(MAX_BODY_BYTES / 1_024 + 4);
  });

  it('refuses bytes that are not UTF-8', async () => {
    const result = await readCappedBody(post(new Uint8Array([0xff, 0xfe, 0x22])), 100);
    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe('parseCopilotBody', () => {
  const ok = (value: unknown): boolean => parseCopilotBody(JSON.stringify(value)) !== null;

  it('accepts exactly the wire request shapes', () => {
    expect(ok({ task: 'briefing', scope: { kind: 'network' } })).toBe(true);
    expect(ok({ task: 'briefing', scope: { kind: 'depot', depotId: '101' } })).toBe(true);
    expect(ok({ task: 'rationale', transferId: '101>102' })).toBe(true);
    expect(ok({ task: 'ask', question: 'Any exceptions?', scope: { kind: 'network' } })).toBe(true);
  });

  it.each([
    ['not JSON', null],
    ['an unknown key', { task: 'briefing', scope: { kind: 'network' }, provider: 'claude' }],
    ['an unknown scope key', { task: 'briefing', scope: { kind: 'network', model: 'x' } }],
    ['an unknown task', { task: 'prompt', scope: { kind: 'network' } }],
    ['a bad depot id', { task: 'briefing', scope: { kind: 'depot', depotId: '../1' } }],
    ['a bad transfer id', { task: 'rationale', transferId: '101>102>103' }],
    ['a transfer id with text', { task: 'rationale', transferId: 'a>b' }],
    ['an empty question', { task: 'ask', question: '', scope: { kind: 'network' } }],
    [
      'an over-long question',
      { task: 'ask', question: 'x'.repeat(MAX_QUESTION_CHARS + 1), scope: { kind: 'network' } },
    ],
    ['a question of invisible characters', { task: 'ask', question: '​\u0007', scope: { kind: 'network' } }],
    ['a fact list', { task: 'ask', question: 'q', scope: { kind: 'network' }, facts: [] }],
  ])('rejects %s', (_name, value) => {
    expect(parseCopilotBody(value === null ? '{not json' : JSON.stringify(value))).toBeNull();
  });

  it('passes the question through the router sanitiser', () => {
    const parsed = parseCopilotBody(
      JSON.stringify({ task: 'ask', question: ' Any​\nexceptions? ', scope: { kind: 'network' } }),
    );
    expect(parsed).toEqual({ task: 'ask', question: 'Any exceptions?', scope: { kind: 'network' } });
  });
});

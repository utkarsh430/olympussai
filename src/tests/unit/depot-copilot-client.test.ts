import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FACT_ID_CHARS,
  MAX_GENERATED_AT_CHARS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_HEADING_CHARS,
  MAX_TABLE_ROWS,
  requestCopilot,
} from '@/lib/depot/copilot/ui/copilotClient';
import {
  MAX_FACTS,
  MAX_FACT_LABEL_CHARS,
  MAX_FACT_TEXT_CHARS,
  MAX_PARAGRAPHS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
} from '@/lib/depot/copilot/limits';
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
    { kind: 'network' },
    { kind: 'depot', depotId: '49', depotName: 'KAUSHAMBI' },
    {
      kind: 'depots',
      depots: [
        { depotId: '49', depotName: 'KAUSHAMBI' },
        { depotId: '101', depotName: 'KANPUR' },
      ],
    },
  ])('accepts the scope the answer used (round 8 A): %j', async (answerScope) => {
    stub(200, { ...GOOD, answerScope });
    expect(await requestCopilot(BODY)).toEqual({ ok: true, response: { ...GOOD, answerScope } });
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

describe('requestCopilot bounds', () => {
  const fact = GOOD.facts[0];
  const bad: readonly (readonly [string, unknown])[] = [
    ['empty headline', { ...GOOD, headline: '' }],
    ['over-long headline', { ...GOOD, headline: 'h'.repeat(MAX_RENDERED_HEADLINE_CHARS + 1) }],
    ['no paragraphs', { ...GOOD, paragraphs: [] }],
    ['too many paragraphs', { ...GOOD, paragraphs: Array(MAX_PARAGRAPHS + 1).fill('p') }],
    [
      'over-long paragraph',
      { ...GOOD, paragraphs: ['p'.repeat(MAX_RENDERED_PARAGRAPH_CHARS + 1)] },
    ],
    ['too many facts', { ...GOOD, facts: Array(MAX_FACTS + 1).fill(fact) }],
    [
      'over-long fact text',
      { ...GOOD, facts: [{ ...fact, text: 't'.repeat(MAX_FACT_TEXT_CHARS + 1) }] },
    ],
    [
      'over-long fact label',
      { ...GOOD, facts: [{ ...fact, label: 'l'.repeat(MAX_FACT_LABEL_CHARS + 1) }] },
    ],
    ['an unknown answer scope', { ...GOOD, answerScope: { kind: 'route' } }],
    ['a depot scope without a name', { ...GOOD, answerScope: { kind: 'depot', depotId: '49' } }],
    [
      'a depot scope with an over-long name',
      { ...GOOD, answerScope: { kind: 'depot', depotId: '49', depotName: 'n'.repeat(500) } },
    ],
    [
      'over-long interpretedAs',
      { ...GOOD, interpretedAs: 'i'.repeat(MAX_RENDERED_PARAGRAPH_CHARS + 1) },
    ],
    [
      'too many columns',
      {
        ...GOOD,
        table: {
          columns: Array(MAX_TABLE_COLUMNS + 1).fill('c'),
          rows: [Array(MAX_TABLE_COLUMNS + 1).fill('x')],
        },
      },
    ],
    [
      'too many rows',
      { ...GOOD, table: { columns: ['a'], rows: Array(MAX_TABLE_ROWS + 1).fill(['x']) } },
    ],
    ['over-long fact id', { ...GOOD, facts: [{ ...fact, id: 'i'.repeat(MAX_FACT_ID_CHARS + 1) }] }],
    ['over-long generatedAt', { ...GOOD, generatedAt: 'g'.repeat(MAX_GENERATED_AT_CHARS + 1) }],
    [
      'over-long column heading',
      {
        ...GOOD,
        table: { columns: ['c'.repeat(MAX_TABLE_HEADING_CHARS + 1)], rows: [['x']] },
      },
    ],
    [
      'over-long table cell',
      { ...GOOD, table: { columns: ['a'], rows: [['x'.repeat(MAX_TABLE_CELL_CHARS + 1)]] } },
    ],
    ['ragged row (short)', { ...GOOD, table: { columns: ['a', 'b'], rows: [['x']] } }],
    ['ragged row (long)', { ...GOOD, table: { columns: ['a'], rows: [['x', 'y']] } }],
    [
      'column provenance of the wrong length',
      { ...GOOD, table: { columns: ['a', 'b'], rows: [], provenance: [null] } },
    ],
    [
      'an unknown column provenance',
      { ...GOOD, table: { columns: ['a'], rows: [], provenance: ['measured'] } },
    ],
    [
      'column provenance that is not a list',
      { ...GOOD, table: { columns: ['a'], rows: [], provenance: 'live' } },
    ],
  ];

  it.each(bad)('rejects %s as unavailable', async (_name, body) => {
    stub(200, body);
    expect(await requestCopilot(BODY)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('accepts every bound exactly at its limit', async () => {
    stub(200, {
      ...GOOD,
      headline: 'h'.repeat(MAX_RENDERED_HEADLINE_CHARS),
      paragraphs: Array(MAX_PARAGRAPHS).fill('p'.repeat(MAX_RENDERED_PARAGRAPH_CHARS)),
      generatedAt: 'g'.repeat(MAX_GENERATED_AT_CHARS),
      facts: Array(MAX_FACTS).fill({
        ...fact,
        id: 'i'.repeat(MAX_FACT_ID_CHARS),
        text: 't'.repeat(MAX_FACT_TEXT_CHARS),
        label: 'l'.repeat(MAX_FACT_LABEL_CHARS),
      }),
      table: {
        columns: Array(MAX_TABLE_COLUMNS).fill('c'.repeat(MAX_TABLE_HEADING_CHARS)),
        rows: Array(MAX_TABLE_ROWS).fill(
          Array(MAX_TABLE_COLUMNS).fill('x'.repeat(MAX_TABLE_CELL_CHARS)),
        ),
      },
    });
    expect((await requestCopilot(BODY)).ok).toBe(true);
  });

  it('accepts a table with a provenance per column, a name column unset', async () => {
    const table = {
      columns: ['Depot', 'Short by'],
      rows: [['A', '3']],
      provenance: [null, 'modelled'],
    };
    stub(200, { ...GOOD, table });
    const result = await requestCopilot(BODY);
    expect(result.ok && result.response.table).toEqual(table);
  });

  it('accepts a table with no rows', async () => {
    stub(200, { ...GOOD, table: { columns: ['a'], rows: [] } });
    expect((await requestCopilot(BODY)).ok).toBe(true);
  });
});

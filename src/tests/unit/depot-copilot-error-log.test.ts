// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  MAX_LOGGED_ERROR_CHARS,
  describeCopilotError,
  withheldStrings,
} from '@/lib/depot/copilot/errorText';
import { createCopilotEngine } from '@/lib/depot/copilot/resolve';
import { buildCopilotRuntime, type CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { handleCopilotPost } from '@/lib/depot/copilot/service/handle';
import { answerCopilot } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest } from '@/lib/depot/copilot/service/prepare';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';

/**
 * A copilot failure is logged with its stage (the reason code), the writer, and the
 * error's class and bounded message, so a bug can be found from the server log; the
 * question, fact values and environment values are blanked first. Bodies stay fixed.
 */

const rows = normalizeDepotRows(liveFixture).rows;
const view: FleetSnapshotView = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};
const SECRET = 'env-value-0123456789';
const ENV = { UPSTREAM_TOKEN: SECRET, FLAG: 'true' };
const QUESTION = 'which depots are short zqxmarker';
const NETWORK = { task: 'briefing', scope: { kind: 'network' } };

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetAnalysisForTests();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());
const lines = (): string[] => errorSpy.mock.calls.map((c) => String(c[0]));

function networkRequest() {
  const body = parseCopilotBody(JSON.stringify(NETWORK));
  if (!body) throw new Error('fixture must parse');
  const prepared = prepareCopilotRequest(body, view);
  if (!prepared.ok) throw new Error('fixture must prepare');
  return prepared;
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
const CLAIMS = { sub: 'upsrtc', iat: 1 } as never;
const scripted = (): CopilotRuntime =>
  buildCopilotRuntime({ setting: 'scripted', cli: null, env: ENV });

describe('describeCopilotError', () => {
  it('gives the class and the message on one line', () => {
    expect(describeCopilotError(new TypeError('a\nb'), [])).toBe('TypeError: a b');
    expect(describeCopilotError('text', [])).toBe('non-error value thrown (string)');
  });

  it('cuts the message to a fixed length', () => {
    const text = describeCopilotError(new Error('x'.repeat(1000)), []);
    expect(text.length).toBeLessThanOrEqual('Error: '.length + MAX_LOGGED_ERROR_CHARS);
  });

  it('blanks the question, fact values and long environment values, not short flags', () => {
    const withheld = withheldStrings({
      env: ENV,
      question: QUESTION,
      facts: [{ text: '143 buses' }],
    });
    const text = describeCopilotError(
      new Error(`${QUESTION} / 143 buses / ${SECRET} / true`),
      withheld,
    );
    expect(text).toBe('Error: [withheld] / [withheld] / [withheld] / true');
  });
});

describe('copilot log lines', () => {
  it('a snapshot failure names its stage, writer and error, never an environment value', async () => {
    const response = await handleCopilotPost(
      post(NETWORK),
      scripted(),
      () => Promise.reject(new Error(`ECONNREFUSED ${SECRET}`)),
      CLAIMS,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(lines()).toEqual([
      '[depot:copilot-api] snapshot_failed writer=scripted: Error: ECONNREFUSED [withheld]',
    ]);
  });

  it('a fact-building failure names its error and never the question', async () => {
    const broken = {
      ...view,
      get rows(): never {
        throw new TypeError(`rows unreadable for ${QUESTION}`);
      },
    };
    const ask = { task: 'ask', question: QUESTION, scope: { kind: 'network' } };
    const response = await handleCopilotPost(post(ask), scripted(), async () => broken, CLAIMS);
    expect(response.status).toBe(503);
    expect(lines()).toEqual([
      '[depot:copilot-api] prepare_failed writer=scripted: TypeError: rows unreadable for [withheld]',
    ]);
  });

  it('an unexpected throw names its error and keeps the fixed body', async () => {
    const runtime = scripted();
    const broken: CopilotRuntime = {
      ...runtime,
      cache: {
        get: () => {
          throw new RangeError(`boom ${SECRET}`);
        },
        set: () => undefined,
      },
    };
    const response = await handleCopilotPost(post(NETWORK), broken, async () => view, CLAIMS);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(lines()).toEqual([
      '[depot:copilot-api] unexpected writer=scripted: RangeError: boom [withheld]',
    ]);
  });

  it('an engine and a scripted failure name their errors, never a fact value', async () => {
    const prepared = networkRequest();
    const fact = prepared.request.facts.find((f) => f.text.length >= 3)?.text ?? '';
    const runtime = scripted();
    const throwing = {
      generate: async (): Promise<never> => {
        throw new Error(`failed on ${fact}`);
      },
    };
    const call = { deadlineAt: Date.now() + 5_000, signal: new AbortController().signal,
      identity: 'test' };
    const response = await answerCopilot(
      { ...runtime, engine: throwing, scriptedEngine: throwing },
      prepared,
      call,
    );
    expect(response.notice).toBe('summary_unavailable');
    expect(lines()).toEqual([
      '[depot:copilot-api] engine_failed writer=scripted: Error: failed on [withheld]',
      '[depot:copilot-api] scripted_failed writer=scripted: Error: failed on [withheld]',
    ]);
  });

  it("the scripted writer's own throw is logged with its error, never a fact value", async () => {
    const { request } = networkRequest();
    const fact = request.facts.find((f) => f.text.length >= 3)?.text ?? '';
    const engine = createCopilotEngine({
      setting: 'scripted',
      cli: null,
      scripted: {
        id: 'scripted',
        draft: async () => {
          throw new TypeError(`no template for ${fact}`);
        },
      },
      now: () => 0,
      cooldownMs: 1000,
    });
    const text = await engine.generate(request);
    expect(text.fallbackReason).toBe('scripted_unavailable');
    expect(lines()).toEqual([
      '[depot:copilot] scripted briefing draft failed: threw: TypeError: no template for [withheld]',
    ]);
  });
});

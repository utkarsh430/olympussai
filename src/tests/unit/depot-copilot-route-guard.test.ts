// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { createSessionToken, verifySessionToken } from '@/lib/auth/session';
import { formatFeedTime } from '@/lib/depot/format';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildCopilotRuntime, getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { IDENTITY_REQUESTS_PER_MINUTE } from '@/lib/depot/copilot/service/constants';
import { POST } from '@/app/api/upsrtc/depot/copilot/route';

/** The handler's guards, with real signed session tokens (no authorization mock). */

let current: NextRequest | null = null;
vi.mock('next/headers', () => ({ cookies: async () => current?.cookies }));
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn(), getServiceRepositories: vi.fn() }));
vi.mock('@/lib/depot/copilot/service/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/copilot/service/runtime')>();
  return { ...actual, getCopilotRuntime: vi.fn() };
});

const TEST_SECRET = 'route-guard-test-secret-0123456789abcdef';
const saved = { secret: process.env.SESSION_SECRET, project: process.env.PROJECT_NAME };
const rows = normalizeDepotRows(liveFixture).rows;
const view = (stale = false): FleetSnapshotView => ({
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale,
  recordCount: rows.length,
});
const snapshot = vi.fn();
let runtime: CopilotRuntime;
let errorSpy: ReturnType<typeof vi.spyOn>;
let token = '';

function post(
  body: unknown,
  init: { token?: string; type?: string; stream?: ReadableStream } = {},
) {
  current = new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': init.type ?? 'application/json',
      cookie: `olympuss_session=${init.token ?? token}`,
    },
    body: init.stream ?? JSON.stringify(body),
    ...(init.stream ? { duplex: 'half' } : {}),
  });
  return POST(current);
}
const NETWORK = { task: 'briefing', scope: { kind: 'network' } };

beforeEach(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PROJECT_NAME = 'upsrtc';
  token = await createSessionToken('upsrtc');
  resetAnalysisForTests();
  snapshot.mockReset().mockResolvedValue(view());
  vi.mocked(getRepositories).mockReturnValue({
    fleet: { snapshot },
  } as unknown as DepotRepositories);
  runtime = buildCopilotRuntime({ setting: 'scripted', cli: null });
  vi.mocked(getCopilotRuntime).mockImplementation(() => runtime);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  process.env.SESSION_SECRET = saved.secret;
  process.env.PROJECT_NAME = saved.project;
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
  if (saved.project === undefined) delete process.env.PROJECT_NAME;
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** The same token with the unused low bit of the signature's last character flipped. */
function otherEncoding(jwt: string): string {
  const index = ALPHABET.indexOf(jwt.slice(-1));
  return jwt.slice(0, -1) + ALPHABET[index ^ 1];
}

describe('copilot handler guards', () => {
  it('gives two encodings of one token one shared allowance', async () => {
    const variant = otherEncoding(token);
    expect(variant).not.toBe(token);
    expect(await verifySessionToken(variant)).not.toBeNull();
    for (let i = 0; i < IDENTITY_REQUESTS_PER_MINUTE; i += 1) {
      expect((await post(NETWORK, { token: i % 2 ? variant : token })).status).toBe(200);
    }
    expect((await post(NETWORK, { token: variant })).status).toBe(429);
    expect((await post(NETWORK, { token })).status).toBe(429);
  });

  it('keeps serving others once one identity has used its limit', async () => {
    for (let i = 0; i <= IDENTITY_REQUESTS_PER_MINUTE * 3; i += 1) await post(NETWORK);
    expect((await post(NETWORK)).status).toBe(429);
    const other = await createSessionToken('upsrtc');
    expect((await post(NETWORK, { token: other })).status).toBe(200);
  });

  it('answers a body stream that errors with the fixed 400', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('terminated: client went away /srv/secret/path'));
      },
    });
    const response = await post(null, { stream });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Invalid request' });
  });

  it('refuses a body that does not arrive before the deadline', async () => {
    runtime = buildCopilotRuntime({ setting: 'scripted', cli: null, deadlineMs: 30 });
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    expect((await post(null, { stream })).status).toBe(400);
  });

  it('answers an unexpected throw with the fixed 503, no-store and one log line', async () => {
    runtime = {
      ...runtime,
      cache: {
        get: () => {
          throw new Error('boom /srv/secret');
        },
        set: () => undefined,
      },
    };
    const response = await post(NETWORK);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '[depot:copilot-api] unexpected writer=scripted: Error: boom /srv/secret',
    ]);
  });

  it('answers a failure to build the copilot with the fixed 503 and no-store', async () => {
    vi.mocked(getCopilotRuntime).mockImplementation(() => {
      throw new TypeError('cannot build');
    });
    const response = await post(NETWORK);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '[depot:copilot-api] runtime_failed: TypeError: cannot build',
    ]);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('compares the media type exactly, ignoring parameters and case', async () => {
    expect((await post(NETWORK, { type: 'application/jsonx' })).status).toBe(415);
    expect((await post(NETWORK, { type: 'application/json-patch+json' })).status).toBe(415);
    expect((await post(NETWORK, { type: 'Application/JSON; charset=utf-8' })).status).toBe(200);
  });
});

describe('stale snapshot wording', () => {
  const sentence = (): string =>
    `These figures are from the last good data, at the feed time of ${formatFeedTime(view().feedNow)}.`;
  const transferId = (): string => buildDistributionResponse(view()).plan.transfers[0]?.id ?? '';
  const BODIES = [
    () => NETWORK,
    () => ({ task: 'briefing', scope: { kind: 'depot', depotId: rows[0]?.depotId } }),
    () => ({ task: 'rationale', transferId: transferId() }),
    () => ({ task: 'ask', question: 'which depots have a deficit', scope: { kind: 'network' } }),
  ];

  it.each(BODIES.map((b, i) => [i, b] as const))(
    'ends answer %i with one server sentence',
    async (_i, body) => {
      snapshot.mockResolvedValue(view(true));
      const json = await (await post(body())).json();
      const paragraphs: string[] = json.paragraphs;
      expect(paragraphs.at(-1)).toBe(sentence());
      expect(paragraphs.filter((p) => p === sentence())).toHaveLength(1);
    },
  );

  it('adds it to a Claude text cached while the data was fresh', async () => {
    const draft = vi.fn(async (r: CopilotRequest) => r.scriptedDraft);
    runtime = buildCopilotRuntime({
      setting: 'auto',
      cli: { id: 'claude-cli', draft },
      minClaudeMs: 0,
    });
    const body = BODIES[1]!();
    const fresh = await (await post(body)).json();
    expect(fresh.paragraphs).not.toContain(sentence());
    snapshot.mockResolvedValue(view(true));
    const stale = await (await post(body)).json();
    expect(stale.cached).toBe(true);
    expect(stale.paragraphs.at(-1)).toBe(sentence());
    expect(draft).toHaveBeenCalledTimes(1);
  });
});

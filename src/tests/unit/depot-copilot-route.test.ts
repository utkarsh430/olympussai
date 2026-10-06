// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { buildCopilotRuntime, getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import {
  GLOBAL_REQUESTS_PER_MINUTE,
  MAX_BODY_BYTES,
  SESSION_REQUESTS_PER_MINUTE,
} from '@/lib/depot/copilot/service/constants';
import { POST } from '@/app/api/upsrtc/depot/copilot/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));
vi.mock('@/lib/depot/copilot/service/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/copilot/service/runtime')>();
  return { ...actual, getCopilotRuntime: vi.fn() };
});

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const rows = normalizeDepotRows(liveFixture).rows;
const VIEW: FleetSnapshotView = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};
const snapshot = vi.fn();
const draft = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;
let cookieCounter = 0;

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      cookie: `olympuss_session=token-${cookieCounter}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const NETWORK_BRIEFING = { task: 'briefing', scope: { kind: 'network' } };

beforeEach(() => {
  cookieCounter += 1;
  resetAnalysisForTests();
  snapshot.mockReset().mockResolvedValue(VIEW);
  draft.mockReset().mockImplementation(async (r: { scriptedDraft: unknown }) => r.scriptedDraft);
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
  vi.mocked(getRepositories).mockReturnValue({
    fleet: { snapshot },
    history: { series: vi.fn() },
  } as unknown as DepotRepositories);
  vi.mocked(getCopilotRuntime).mockReturnValue(
    buildCopilotRuntime({ setting: 'auto', cli: { id: 'claude-cli', draft } }),
  );
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ error });
}

describe('POST /api/upsrtc/depot/copilot', () => {
  it('answers 401 with the fixed body and touches nothing else', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await POST(post(NETWORK_BRIEFING));
    await expectError(response, 401, 'Unauthorized');
    expect(getRepositories).not.toHaveBeenCalled();
    expect(getCopilotRuntime).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin POST with 403 before reading the body', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(NETWORK_BRIEFING)));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    ); // pulled only when someone reads
    const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    await expectError(await POST(request), 403, 'Invalid request origin');
    expect(pulls).toBe(0);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('requires a JSON content type', async () => {
    const response = await POST(post(NETWORK_BRIEFING, { 'content-type': 'text/plain' }));
    await expectError(response, 415, 'Unsupported content type');
  });

  it('answers 413 for an oversized body', async () => {
    const response = await POST(post('x'.repeat(MAX_BODY_BYTES + 1)));
    await expectError(response, 413, 'Request too large');
  });

  it.each([
    ['malformed JSON', '{"task":'],
    ['an unknown key', { ...NETWORK_BRIEFING, provider: 'claude' }],
    ['a provider-selecting body', { task: 'briefing', scope: { kind: 'network' }, model: 'opus' }],
    ['a bad depot id', { task: 'briefing', scope: { kind: 'depot', depotId: '1; rm' } }],
    ['a bad transfer id', { task: 'rationale', transferId: '<script>' }],
  ])('answers 400 for %s without reading the snapshot', async (_name, body) => {
    await expectError(await POST(post(body)), 400, 'Invalid request');
    expect(snapshot).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown depot or transfer, with no model call', async () => {
    const depot = { task: 'briefing', scope: { kind: 'depot', depotId: '999999' } };
    await expectError(await POST(post(depot)), 404, 'Not found');
    const transfer = { task: 'rationale', transferId: '999998>999999' };
    await expectError(await POST(post(transfer)), 404, 'Not found');
    expect(draft).not.toHaveBeenCalled();
  });

  it('answers 503 with a fixed body when the snapshot cannot be read, logging a reason code', async () => {
    snapshot.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7 token=abc'));
    await expectError(await POST(post(NETWORK_BRIEFING)), 503, 'Depot data unavailable');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe('[depot:copilot-api] snapshot_failed');
  });

  it('answers a briefing in exactly the wire shape, with no-store', async () => {
    const response = await POST(post(NETWORK_BRIEFING));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['cached', 'facts', 'generatedAt', 'headline', 'notice', 'paragraphs', 'provider'].sort(),
    );
    expect(body.provider).toBe('claude');
  });

  it('answers an ask with its interpretation, and never echoes or logs the raw question', async () => {
    const question = 'Which five depots rank highest? zqxmarker';
    const response = await POST(post({ task: 'ask', question, scope: { kind: 'network' } }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.interpretedAs).toBe('string');
    expect(JSON.stringify(body)).not.toContain('zqxmarker');
    expect(JSON.stringify(draft.mock.calls)).not.toContain('zqxmarker');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('zqxmarker');
  });

  it('refuses questions about people in words, with HTTP 200', async () => {
    const question = 'Which conductors at this depot are lazy?';
    const response = await POST(post({ task: 'ask', question, scope: { kind: 'network' } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { headline: string };
    expect(body.headline).toBe('That question is outside what can be answered here');
  });

  it('limits each session, answering 429 with Retry-After and the contract body', async () => {
    const cookie = 'olympuss_session=same-session';
    for (let i = 0; i < SESSION_REQUESTS_PER_MINUTE; i += 1) {
      expect((await POST(post(NETWORK_BRIEFING, { cookie }))).status).toBe(200);
    }
    const limited = await POST(post(NETWORK_BRIEFING, { cookie }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    const seconds = Number(limited.headers.get('retry-after'));
    expect(seconds).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      error: 'Too many requests',
      retryAfterSeconds: seconds,
    });
    // Another session is unaffected.
    expect((await POST(post(NETWORK_BRIEFING))).status).toBe(200);
  });

  it('limits all sessions together, scripted answers included', async () => {
    vi.mocked(getCopilotRuntime).mockReturnValue(
      buildCopilotRuntime({ setting: 'scripted', cli: null }),
    );
    for (let i = 0; i < GLOBAL_REQUESTS_PER_MINUTE; i += 1) {
      const response = await POST(post(NETWORK_BRIEFING, { cookie: `olympuss_session=s${i}` }));
      expect(response.status).toBe(200);
    }
    const limited = await POST(post(NETWORK_BRIEFING, { cookie: 'olympuss_session=fresh' }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('answers a depot briefing and a rationale for a transfer in the current plan', async () => {
    const depotId = buildNetworkResponse(VIEW).depots.find((d) => d.id !== 'unassigned')!.id;
    const depot = await POST(post({ task: 'briefing', scope: { kind: 'depot', depotId } }));
    expect(depot.status).toBe(200);
    const transfer = buildDistributionResponse(VIEW).plan.transfers[0]!;
    const rationale = await POST(post({ task: 'rationale', transferId: transfer.id }));
    expect(rationale.status).toBe(200);
    expect(((await rationale.json()) as { provider: string }).provider).toBe('claude');
  });

  it('answers 503 rather than hang when the snapshot outlasts the deadline', async () => {
    snapshot.mockReturnValue(new Promise(() => undefined));
    vi.mocked(getCopilotRuntime).mockReturnValue(
      buildCopilotRuntime({ setting: 'scripted', cli: null, deadlineMs: 20 }),
    );
    await expectError(await POST(post(NETWORK_BRIEFING)), 503, 'Depot data unavailable');
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe('[depot:copilot-api] snapshot_deadline');
  });

  it('answers scripted with the coarse notice when Claude outlasts the deadline', async () => {
    draft.mockReturnValue(new Promise(() => undefined));
    vi.mocked(getCopilotRuntime).mockReturnValue(
      buildCopilotRuntime({ setting: 'auto', cli: { id: 'claude-cli', draft }, deadlineMs: 50 }),
    );
    const response = await POST(post(NETWORK_BRIEFING));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: 'scripted',
      notice: 'claude_unavailable',
    });
  });
});

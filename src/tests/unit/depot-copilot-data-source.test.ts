// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { createSessionToken } from '@/lib/auth/session';
import { formatFeedTime } from '@/lib/depot/format';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildCopilotRuntime, getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { staleSentence } from '@/lib/depot/copilot/service/stale';
import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { requestCopilot } from '@/lib/depot/copilot/ui/copilotClient';
import { POST } from '@/app/api/upsrtc/depot/copilot/route';

/**
 * Where the snapshot came from, said in every copilot text and its footer: the live feed
 * says nothing extra, the last good data says so, and the saved sample says "sample data"
 * in the pages' own words and never tags its feed time LIVE.
 */

let current: NextRequest | null = null;
vi.mock('next/headers', () => ({ cookies: async () => current?.cookies }));
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn(), getServiceRepositories: vi.fn() }));
vi.mock('@/lib/depot/copilot/service/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/copilot/service/runtime')>();
  return { ...actual, getCopilotRuntime: vi.fn() };
});

const TEST_SECRET = 'data-source-test-secret-0123456789abcdef';
const saved = { secret: process.env.SESSION_SECRET, project: process.env.PROJECT_NAME };
const rows = normalizeDepotRows(liveFixture).rows;
const feedNow = deriveFeedNow(rows);
const TIME = formatFeedTime(feedNow);

type Branch = 'live' | 'last good' | 'sample';
const VIEWS: Readonly<Record<Branch, FleetSnapshotView>> = {
  live: { rows, feedNow, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live', stale: false,
    recordCount: rows.length },
  'last good': { rows, feedNow, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live',
    stale: true, recordCount: rows.length },
  sample: { rows, feedNow, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'fixture',
    stale: true, recordCount: rows.length },
};
const LAST_GOOD = `These figures are from the last good data, at the feed time of ${TIME}.`;
const SAMPLE = `These figures are from sample data, not the live feed (feed time ${TIME}).`;

const snapshot = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;
let token = '';

async function post(body: unknown): Promise<CopilotApiResponse> {
  current = new NextRequest('http://localhost:3000/api/upsrtc/depot/copilot', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      cookie: `olympuss_session=${token}`,
    },
    body: JSON.stringify(body),
  });
  const response = await POST(current);
  expect(response.status).toBe(200);
  return (await response.json()) as CopilotApiResponse;
}

const BODIES = {
  briefing: () => ({ task: 'briefing', scope: { kind: 'network' } }),
  rationale: (view: FleetSnapshotView) => ({
    task: 'rationale',
    transferId: buildDistributionResponse(view).plan.transfers[0]?.id ?? '',
  }),
  answer: () => ({ task: 'ask', question: 'which depots have a deficit', scope: { kind: 'network' } }),
} as const;
const TASKS = Object.keys(BODIES) as (keyof typeof BODIES)[];

beforeEach(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PROJECT_NAME = 'upsrtc';
  token = await createSessionToken('upsrtc');
  resetAnalysisForTests();
  vi.mocked(getRepositories).mockReturnValue({ fleet: { snapshot } } as unknown as DepotRepositories);
  const runtime = buildCopilotRuntime({ setting: 'scripted', cli: null });
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

async function answerOn(branch: Branch, task: keyof typeof BODIES): Promise<CopilotApiResponse> {
  const view = VIEWS[branch];
  snapshot.mockResolvedValue(view);
  return post(BODIES[task](view));
}

describe('copilot text by data source', () => {
  it.each(TASKS)('the %s on the live feed carries no source sentence or footer word', async (task) => {
    const json = await answerOn('live', task);
    expect(json.paragraphs).not.toContain(LAST_GOOD);
    expect(json.paragraphs).not.toContain(SAMPLE);
    expect(json.dataSource).toBeUndefined();
  });

  it.each(TASKS)('the %s on the last good data says so, once, at the end', async (task) => {
    const json = await answerOn('last good', task);
    expect(json.paragraphs.at(-1)).toBe(LAST_GOOD);
    expect(json.paragraphs.filter((p) => p === LAST_GOOD)).toHaveLength(1);
    expect(json.dataSource).toBe('last_good');
  });

  it.each(TASKS)('the %s on the saved sample says sample data, never last good', async (task) => {
    const json = await answerOn('sample', task);
    expect(json.paragraphs.at(-1)).toBe(SAMPLE);
    expect(json.paragraphs.join(' ')).not.toContain('last good data');
    expect(json.dataSource).toBe('sample');
  });

  it('says sample data on the saved sample even when it is not marked stale', async () => {
    snapshot.mockResolvedValue({ ...VIEWS.sample, stale: false });
    const json = await post(BODIES.briefing());
    expect(json.paragraphs.at(-1)).toBe(SAMPLE);
    expect(json.dataSource).toBe('sample');
  });
});

describe('the feed-time fact by data source', () => {
  const feedTimeTag = async (branch: Branch): Promise<string | undefined> =>
    (await answerOn(branch, 'briefing')).facts.find((f) => f.id === 'network.feed_time')
      ?.provenance;

  it('is LIVE on the live feed and on the last good data', async () => {
    expect(await feedTimeTag('live')).toBe('live');
    expect(await feedTimeTag('last good')).toBe('live');
  });

  it('is never LIVE on the saved sample', async () => {
    const tag = await feedTimeTag('sample');
    expect(tag).toBeDefined();
    expect(tag).not.toBe('live');
  });
});

describe('the browser reading the data source', () => {
  afterEach(() => vi.unstubAllGlobals());
  const read = async (body: unknown): Promise<boolean> => {
    vi.stubGlobal('fetch', async () => Response.json(body));
    return (await requestCopilot({ task: 'briefing', scope: { kind: 'network' } })).ok;
  };

  it('accepts each source the server sends and refuses any other', async () => {
    const sample = await answerOn('sample', 'briefing');
    expect(await read(sample)).toBe(true);
    expect(await read({ ...sample, dataSource: 'last_good' })).toBe(true);
    expect(await read({ ...sample, dataSource: 'live' })).toBe(false);
  });
});

describe('staleSentence without a feed time', () => {
  it('keeps each source in its own words', () => {
    const none = { ...VIEWS.live, feedNow: null };
    expect(staleSentence(none)).toBeUndefined();
    expect(staleSentence({ ...none, stale: true })).toBe(
      'These figures are from the last good data; its feed time is not known.',
    );
    expect(staleSentence({ ...none, source: 'fixture' })).toBe(
      'These figures are from sample data, not the live feed; its feed time is not known.',
    );
  });
});

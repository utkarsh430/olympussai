import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotLeaguePage from '@/app/(protected)/project/depots/league/page';
import { DepotTrends } from '@/components/depot/trends/DepotTrends';
import { NetworkTrends } from '@/components/depot/trends/NetworkTrends';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import {
  distributionResponse,
  forecastResponse,
  polled,
  trendRow,
  trendsResponse,
} from './depot-trends-fixtures';

/*
 * The pages that once called their data live, rendered on the saved sample and on last-good
 * data: no sentence, title or label may say live there. Two things may: a provenance class
 * pill (it names the class, not the feed's state now) and the words "not the live feed".
 */

type Feed = { readonly source: 'fixture' | 'live'; readonly stale: boolean };
const SAMPLE: Feed = { source: 'fixture', stale: false };
const LAST_GOOD: Feed = { source: 'live', stale: true };
const FEEDS = [
  ['the saved sample', SAMPLE],
  ['last-good data', LAST_GOOD],
] as const;

const hooks = vi.hoisted(() => ({
  feed: { source: 'fixture', stale: false } as { source: string; stale: boolean },
  network: null as unknown,
}));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => hooks.network,
}));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '20', error: null }),
}));
vi.mock('@/hooks/useDepotForecast', () => ({
  useDepotForecast: (request: { metric: 'onRoadShare' } | null) =>
    polled(request === null ? null : { ...forecastResponse(request.metric, 70), ...hooks.feed }),
}));
vi.mock('@/hooks/useDepotTrends', () => ({
  useDepotTrends: () =>
    polled({ ...trendsResponse([trendRow('a', 2.1), trendRow('20', -3)]), ...hooks.feed }),
}));
vi.mock('@/hooks/useDepotDistribution', () => ({
  useDepotDistribution: () => polled({ ...distributionResponse('20', 40), ...hooks.feed }),
}));

const FEED_NOW = '2026-10-06T15:21:00Z';

function networkState(feed: Feed): unknown {
  const data = {
    ...feed,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T09:51:05.000Z',
    depots: [{ id: 'a', name: 'GANGOH', kind: 'depot', fleet: 80 }],
    scores: [
      { depotId: 'a', peerGroup: 'medium', ranked: true, reason: 'ok', index: 59, rank: 1, peerCount: 1, components: [], samples: 20 },
    ],
    scoreWindow: { lengthMin: 20, since: '2026-10-06T15:01:00Z', samples: 20, coveredMin: 20 },
  };
  return { data, error: null, loading: false, refresh: () => undefined };
}

/** Every line of text, `title` and `aria-label` that says live, outside the class pills. */
function liveClaims(markup: string): string[] {
  const frame = document.createElement('div');
  frame.innerHTML = markup;
  for (const pill of frame.querySelectorAll('[data-testid="depot-provenance"]')) pill.remove();
  const attributes = Array.from(frame.querySelectorAll('[title], [aria-label]')).flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
  const texts = Array.from(frame.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? ''),
  );
  return [...texts, ...attributes]
    .map((text) => text.replace(/not the live feed/gi, ''))
    .filter((text) => /\blive\b/i.test(text));
}

beforeEach(() => {
  hooks.feed = SAMPLE;
  hooks.network = networkState(SAMPLE);
});

describe('no page calls the sample or last-good data live', () => {
  it('finds a live claim when there is one, and passes a class pill', () => {
    expect(liveClaims('<p>Now (live)</p><span aria-label="the live value">x</span>')).toEqual([
      'Now (live)',
      'the live value',
    ]);
    expect(liveClaims('<span data-testid="depot-provenance">LIVE</span>')).toEqual([]);
    expect(liveClaims('<p>Sample data, not the live feed</p>')).toEqual([]);
  });

  it.each(FEEDS)('the network trends page, on %s', (_name, feed) => {
    hooks.feed = feed;
    expect(liveClaims(renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />))).toEqual([]);
  });

  it.each(FEEDS)('the depot trends page, on %s', (_name, feed) => {
    hooks.feed = feed;
    expect(liveClaims(renderToStaticMarkup(<DepotTrends metric="onRoadShare" />))).toEqual([]);
  });

  it.each(FEEDS)('the league page, on %s', async (_name, feed) => {
    hooks.feed = feed;
    hooks.network = networkState(feed);
    const markup = renderToStaticMarkup(await DepotLeaguePage());
    expect(markup).toContain('feed value');
    expect(liveClaims(markup)).toEqual([]);
  });

  it('the depot footer, whatever the data', () => {
    expect(liveClaims(renderToStaticMarkup(<FooterDisclaimer variant="depot" />))).toEqual([]);
  });

  it.each(FEEDS)("the copilot's decline, on %s", (_name, feed) => {
    const network = { ...networkState(feed), depots: [], scores: [] } as unknown;
    const request = buildAnswer(
      { kind: 'unsupported', reason: 'people' },
      { network: { ...(network as { data: DepotNetworkResponse }).data, ...feed } },
    );
    const prose = request.scriptedDraft.paragraphs.join(' ');
    expect(prose).toContain('would be answered from');
    expect(liveClaims(`<p>${prose}</p>`)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotDetailResponse, DepotNetworkResponse } from '@/lib/depot/api';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import { indexWindowText } from '@/lib/depot/copilot/facts/window';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { formatFeedTime } from '@/lib/depot/format';

/** The copilot states the index's window, and a held yard as held. */

const rows = normalizeDepotRows(liveFixture).rows;
const VIEW = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live' as const,
  stale: false,
  recordCount: rows.length,
};
const SINCE = '2026-10-06T07:42:00.000Z';
const AT = formatFeedTime(SINCE);
const MANY = { lengthMin: 20, since: SINCE, samples: 7 };
const ONE = { lengthMin: 20, since: SINCE, samples: 1 };
const COVERED = { ...MANY, coveredMin: 18 };

beforeEach(() => resetAnalysisForTests());

function rankedDetail(): DepotDetailResponse {
  const network = buildNetworkResponse(VIEW);
  const ranked = network.scores.find((s) => s.ranked && s.index !== null);
  const detail = ranked ? buildDepotDetail(VIEW, ranked.depotId) : null;
  if (!detail?.yard.value) throw new Error('fixture needs a ranked depot with a yard');
  return detail;
}

const rendered = (request: CopilotRequest): string => {
  const result = renderDraft(request.scriptedDraft, request.facts);
  if (!result.ok) {
    const refused = request.scriptedDraft.paragraphs.filter(
      (p) => !renderDraft({ headline: 'Briefing', paragraphs: [p] }, request.facts).ok,
    );
    throw new Error(`scripted draft refused: ${JSON.stringify(result)} ${refused.join(' | ')}`);
  }
  return [result.headline, ...result.paragraphs].join('\n');
};
const factText = (request: CopilotRequest, id: string): string | undefined =>
  request.facts.find((f) => f.id === id)?.text;

describe('the window an index or rank covers', () => {
  it('words the window from its samples, preferring coveredMin, and one snapshot as such', () => {
    expect(indexWindowText(MANY)).toBe(`7 snapshots from ${AT}`);
    expect(indexWindowText(COVERED)).toBe(`the 18 minutes from ${AT} (7 snapshots)`);
    expect(indexWindowText(ONE)).toBe(`one snapshot, at ${AT}`);
    expect(indexWindowText({ ...ONE, coveredMin: 0 })).toBe(`one snapshot, at ${AT}`);
    expect(indexWindowText({ ...MANY, since: null })).toBe('7 snapshots');
    expect(indexWindowText(undefined)).toBeNull();
  });

  it.each([
    ['many samples', MANY, `7 snapshots from ${AT}`],
    ['coveredMin', COVERED, `the 18 minutes from ${AT} (7 snapshots)`],
    ['one sample', ONE, `one snapshot, at ${AT}`],
  ])('a depot briefing states it (%s)', (_label, window, text) => {
    const request = buildDepotBriefing({ ...rankedDetail(), scoreWindow: window });
    expect(factText(request, 'depot.index_window')).toBe(text);
    expect(rendered(request)).toContain(`The rank and index cover ${text}.`);
  });

  it('a network briefing states it beside the highest and lowest index', () => {
    const network: DepotNetworkResponse = { ...buildNetworkResponse(VIEW), scoreWindow: ONE };
    const request = buildNetworkBriefing(network);
    expect(rendered(request)).toContain(`The index here covers one snapshot, at ${AT}.`);
  });

  it('a ranking and a comparison state it', () => {
    const network: DepotNetworkResponse = { ...buildNetworkResponse(VIEW), scoreWindow: MANY };
    const ranking = buildAnswer(
      { kind: 'rankDepots', metric: 'index', order: 'top', limit: 3 },
      { network },
    );
    expect(rendered(ranking)).toContain(`The figures here cover 7 snapshots from ${AT}.`);
    const [a, b] = network.scores.filter((s) => s.ranked && s.index !== null);
    if (!a || !b) throw new Error('fixture needs two ranked depots');
    const compare = buildAnswer(
      { kind: 'compareDepots', depotA: a.depotId, depotB: b.depotId },
      { network },
    );
    expect(rendered(compare)).toContain(`The index here covers 7 snapshots from ${AT}.`);
  });

  it('says nothing about a window the response does not carry', () => {
    const request = buildDepotBriefing({ ...rankedDetail(), scoreWindow: undefined });
    expect(factText(request, 'depot.index_window')).toBeUndefined();
    expect(rendered(request)).not.toContain('cover');
  });
});

describe('a held yard', () => {
  it('is described as held since its time on earlier evidence, not as placed now', () => {
    const detail = rankedDetail();
    const yard = { ...detail.yard, value: { ...detail.yard.value!, heldSince: SINCE } };
    const request = buildDepotBriefing({ ...detail, yard });
    const prose = rendered(request);
    expect(prose).toContain(
      `The yard is kept from earlier snapshots rather than placed by this snapshot. It has been held since ${AT}.`,
    );
    expect(prose).not.toContain('inferred from where buses park');
    expect(factText(request, 'depot.yard_held_since')).toBe(AT);
    expect(factText(request, 'depot.yard_support')).toBeUndefined();
  });

  it('keeps the placed-by-this-snapshot wording for a yard that is not held', () => {
    const prose = rendered(buildDepotBriefing(rankedDetail()));
    expect(prose).toContain('The yard is inferred from where buses park;');
    expect(prose).not.toContain('held since');
  });
});

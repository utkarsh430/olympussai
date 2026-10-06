import type { UpstreamSource } from '@/models/canonical';
import { formatFeedTime } from './format';
import { PROVENANCE_LABEL } from './labels';
import { DEPOTS_ROOT } from './nav';

/**
 * The page's provenance line: one tag and one fixed-formula sentence, declared once
 * under the page header (design-wave rulings, section 2). Only what differs from this
 * default carries its own tag elsewhere on the page. Pure, so every sentence is tested.
 */

export type ProvenanceDescription =
  | { readonly default: 'modelled'; readonly replacedBy?: string }
  | { readonly default: 'mixed'; readonly live: string; readonly modelled: string }
  | { readonly default: 'derived' | 'live' }
  | { readonly default: 'reference' };

export type ProvenanceTone = 'live' | 'derived' | 'modelled' | 'reference' | 'mixed';

export interface ProvenanceFeed {
  readonly data: {
    readonly source: UpstreamSource;
    readonly stale: boolean;
    readonly feedNow: string | null;
  } | null;
  readonly error: string | null;
}

export interface ProvenanceLink {
  readonly href: string;
  readonly label: string;
}

export interface ProvenanceLine {
  readonly tag: string;
  readonly tone: ProvenanceTone;
  readonly sentence: string;
  readonly link: ProvenanceLink | null;
}

type FeedState =
  | { readonly kind: 'fresh' | 'stale' | 'sample'; readonly time: string }
  | { readonly kind: 'unavailable' | 'waiting' };

const SOURCES_LINK: ProvenanceLink = { href: `${DEPOTS_ROOT}/sources`, label: 'Data sources' };
const UNAVAILABLE = 'The feed is unavailable.';
const WAITING = 'Waiting for the feed.';

/** Same freshness rule as the feed chip: a cached answer is the live feed; stale is the last good data. */
function feedState({ data, error }: ProvenanceFeed): FeedState {
  if (!data) return error !== null ? { kind: 'unavailable' } : { kind: 'waiting' };
  const time = formatFeedTime(data.feedNow);
  if (data.source === 'fixture') return { kind: 'sample', time };
  if (data.stale || error !== null) return { kind: 'stale', time };
  return { kind: 'fresh', time };
}

/** "<lead> the live feed at 12:36." and its variants, for a derived or live page. */
function feedSentence(state: FeedState, fresh: string, lead: string): string {
  switch (state.kind) {
    case 'fresh':
      return `${fresh} ${state.time}.`;
    case 'stale':
      return `${lead} the last good data, feed time ${state.time}.`;
    case 'sample':
      return `${lead} sample data, feed time ${state.time}.`;
    case 'unavailable':
      return UNAVAILABLE;
    case 'waiting':
      return WAITING;
  }
}

/** What the live part of a mixed page is, in words that never claim LIVE when it is not. */
function livePart(state: FeedState): string {
  switch (state.kind) {
    case 'fresh':
      return 'LIVE';
    case 'stale':
      return `from the last good data, feed time ${state.time}`;
    case 'sample':
      return `sample data, feed time ${state.time}`;
    case 'unavailable':
      return 'unavailable: the feed is unavailable';
    case 'waiting':
      return 'waiting for the feed';
  }
}

function modelledSentence(replacedBy: string | undefined, state: FeedState): string {
  const parts = ['Generated from planning assumptions, not measured.'];
  if (replacedBy) parts.push(`Replaced when ${replacedBy} is connected.`);
  if (state.kind !== 'fresh' && state.kind !== 'waiting') {
    parts.push(state.kind === 'unavailable' ? UNAVAILABLE : feedSentence(state, '', 'Anchored on'));
  }
  return parts.join(' ');
}

export function provenanceLine(desc: ProvenanceDescription, feed: ProvenanceFeed): ProvenanceLine {
  const state = feedState(feed);
  switch (desc.default) {
    case 'modelled':
      return {
        tag: PROVENANCE_LABEL.modelled,
        tone: 'modelled',
        sentence: modelledSentence(desc.replacedBy, state),
        link: SOURCES_LINK,
      };
    case 'mixed':
      return {
        tag: 'MIXED',
        tone: 'mixed',
        sentence: `${desc.live} are ${livePart(state)}; ${desc.modelled} are MODELLED.`,
        link: null,
      };
    case 'derived':
      return {
        tag: PROVENANCE_LABEL.derived,
        tone: 'derived',
        sentence: feedSentence(state, 'Computed from the live feed at', 'Computed from'),
        link: null,
      };
    case 'live':
      return {
        tag: PROVENANCE_LABEL.live,
        tone: 'live',
        sentence: feedSentence(state, 'Live from the feed at', 'From'),
        link: null,
      };
    case 'reference':
      return {
        tag: PROVENANCE_LABEL.reference,
        tone: 'reference',
        sentence: 'Reference data, curated; not from the feed.',
        link: null,
      };
  }
}

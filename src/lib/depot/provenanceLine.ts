import type { UpstreamSource } from '@/models/canonical';
import { formatCount, formatFeedTime } from './format';
import { PROVENANCE_LABEL } from './labels';
import { DEPOTS_ROOT } from './nav';
import { scoreWindowSentence, type WindowWordsInput } from './score/windowWords';

/**
 * The page's provenance line: one tag and one fixed-formula sentence, declared once
 * under the page header (design-wave rulings, section 2). Only what differs from this
 * default carries its own tag elsewhere on the page. Pure, so every sentence is tested.
 */

/** Said after the formula sentence, when the line must carry one more fact. */
interface SecondSentence {
  readonly second?: string;
  /** Says the efficiency index's window, worded from the response, as the second sentence. */
  readonly indexWindow?: boolean;
  /**
   * A page that rests on the modelled operating day passes its sentence here (worded by
   * `modelledDaySentence`), so the line places it and nothing else sits above the hero.
   */
  readonly modelledDay?: string;
}

/**
 * A mixed page names what is LIVE, what is DERIVED (computed from the feed) and what is
 * MODELLED (generated), in that order; an empty part is left out.
 */
export interface MixedDescription extends SecondSentence {
  readonly default: 'mixed';
  readonly live?: string;
  readonly derived?: string;
  readonly modelled?: string;
}

export type ProvenanceDescription =
  | (SecondSentence & {
      readonly default: 'modelled';
      readonly replacedBy?: string;
      /** A feed id from the Data sources registry: the link opens that feed's section. */
      readonly feedId?: string;
    })
  | MixedDescription
  | (SecondSentence & { readonly default: 'derived' | 'live' })
  | (SecondSentence & { readonly default: 'reference' });

export type ProvenanceTone = 'live' | 'derived' | 'modelled' | 'reference' | 'mixed';

export interface ProvenanceFeed {
  readonly data: {
    readonly source: UpstreamSource;
    readonly stale: boolean;
    readonly feedNow: string | null;
    readonly scoreWindow?: WindowWordsInput;
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
  /** The modelled-day sentence, after the formula; absent when the page passes none. */
  readonly context?: string;
  /** The words inside `sentence` that say the data is stale; present only when it is. */
  readonly staleWords?: string;
}

/** The words every stale sentence carries; drawn in the stale tone, so never colour alone. */
export const STALE_WORDS = 'last good data';

export interface ModelledDayInput {
  /** Already formatted ("Mon 05 Oct"). */
  readonly date: string;
  readonly duties: number;
  readonly routes: number;
  /** Buses the feed carries a schedule for, of `fleet`. */
  readonly scheduled: number;
  readonly fleet: number;
}

const plural = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/** The fixed formula for a page built on the modelled operating day. */
export function modelledDaySentence(input: ModelledDayInput): string {
  const { date, duties, routes, scheduled, fleet } = input;
  return (
    `Built on the modelled day for ${date}: ${plural(duties, 'duty', 'duties')} on ` +
    `${plural(routes, 'route', 'routes')}; the feed schedules ${formatCount(scheduled)} of ` +
    `${plural(fleet, 'bus', 'buses')}.`
  );
}

export interface SentenceSegment {
  readonly text: string;
  readonly stale: boolean;
}

/** Splits a sentence around its stale words, so they can be drawn in the stale tone. */
export function sentenceSegments(
  sentence: string,
  staleWords: string | undefined,
): readonly SentenceSegment[] {
  if (!staleWords || !sentence.includes(staleWords)) return [{ text: sentence, stale: false }];
  // A mixed page can say it twice (its live and its derived part): mark every occurrence.
  return sentence
    .split(staleWords)
    .flatMap((text, index) =>
      index === 0
        ? [{ text, stale: false }]
        : [
            { text: staleWords, stale: true },
            { text, stale: false },
          ],
    )
    .filter((part) => part.text.length > 0);
}

type FeedState =
  | { readonly kind: 'fresh' | 'stale' | 'sample'; readonly time: string }
  | { readonly kind: 'unavailable' | 'waiting' };

const SOURCES_PATH = `${DEPOTS_ROOT}/sources`;

/** Data sources, opened at the replacing feed's section when the page names one. */
function sourcesLink(feedId: string | undefined): ProvenanceLink {
  return { href: feedId ? `${SOURCES_PATH}#feed-${feedId}` : SOURCES_PATH, label: 'Data sources' };
}
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

/** What the derived part of a mixed page is computed from, when that is not the live feed. */
function derivedPart(state: FeedState): string {
  switch (state.kind) {
    case 'stale':
      return 'DERIVED from the last good data';
    case 'sample':
      return 'DERIVED from sample data';
    case 'unavailable':
      return 'DERIVED from no data while the feed is unavailable';
    case 'fresh':
    case 'waiting':
      return 'DERIVED';
  }
}

function mixedSentence(desc: MixedDescription, state: FeedState): string {
  const parts = [
    desc.live ? `${desc.live} are ${livePart(state)}` : null,
    desc.derived ? `${desc.derived} are ${derivedPart(state)}` : null,
    desc.modelled ? `${desc.modelled} are MODELLED` : null,
  ].filter((part): part is string => part !== null);
  return `${parts.join('; ')}.`;
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
  const line = formulaLine(desc, state);
  const second = desc.second ?? windowSecond(desc, feed);
  const sentence = second ? `${line.sentence} ${second}` : line.sentence;
  const stale = state.kind === 'stale' && sentence.includes(STALE_WORDS);
  return {
    ...line,
    sentence,
    ...(desc.modelledDay ? { context: desc.modelledDay } : {}),
    ...(stale ? { staleWords: STALE_WORDS } : {}),
  };
}

/** The index window, once the feed has answered: never a window the reader cannot see. */
function windowSecond(desc: ProvenanceDescription, feed: ProvenanceFeed): string | undefined {
  if (!desc.indexWindow || !feed.data) return undefined;
  return scoreWindowSentence(feed.data.scoreWindow, feed.data.feedNow);
}

function formulaLine(desc: ProvenanceDescription, state: FeedState): ProvenanceLine {
  switch (desc.default) {
    case 'modelled':
      return {
        tag: PROVENANCE_LABEL.modelled,
        tone: 'modelled',
        sentence: modelledSentence(desc.replacedBy, state),
        link: sourcesLink(desc.feedId),
      };
    case 'mixed':
      return {
        tag: 'MIXED',
        tone: 'mixed',
        sentence: mixedSentence(desc, state),
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

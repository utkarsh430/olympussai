import type { CopilotQuery, DepotMeasure, RankMetric } from '@/lib/depot/copilot/queries';
import {
  AMBIGUOUS_DEPOT_QUERY,
  OUT_OF_SCOPE_QUERY,
  PEOPLE_QUERY,
  UNKNOWN_ROUTE_QUERY,
  metricHigherIsBetter,
} from '@/lib/depot/copilot/queries';
import { hourOf } from '@/lib/depot/copilot/router/hours';
import { findRoute } from '@/lib/depot/copilot/router/resolveRoute';
import { resolveDepot, type DepotRef } from '@/lib/depot/copilot/router/resolveDepot';
import { measureOf, withoutMeasureWords } from '@/lib/depot/copilot/router/measures';
import { sanitizeQuestion } from '@/lib/depot/copilot/router/sanitize';

/**
 * A deterministic keyword matcher: the question router used whenever Claude is
 * unavailable. It can only ever return a catalogue query, and it declines
 * (`unsupported`) rather than guess when a depot is needed but not clearly named.
 */

const PEOPLE =
  /\b(crew|crews|drivers?|driving|driven|drives|conductors?|operators?|workers?|staff|employees?|personnel|manpower|people|persons?|individuals?|duty|duties|shifts?|rosters?|managers?|supervisors?|technicians?|mechanics?|attendance|salary|salaries)\b/;
/**
 * No catalogue query answers "who" about people, so a question that opens with it is
 * declined, unless it carries a ranking cue and a depot, bus or fleet noun ("who has the most
 * dark buses" ranks depots; "who is the best performer" asks about people).
 */
const LEADING_WHO = /^(who|whom|whose)\b/;
/** A depot, bus or fleet noun: what a leading "who" ranking question must be about. */
const FLEET_NOUN = /\b(depots?|bus|buses|fleets?)\b/;
const COMPARE = /\b(compare\w*|versus|vs|against|differ\w*)\b/;
const TRANSFER =
  /\b(transfers?|transferr\w*|moves?|moved|moving|send\w*|reallocat\w*|redistribut\w*|rebalanc\w*|lend\w*|borrow\w*)\b/;
const OUTSHED =
  /\b(outshed\w*|out-shed\w*|departures?|depart\w*|dispatch\w*|punctual\w*|late|on[\s-]time|leave the yard|left the yard)\b/;
const EXCEPTION = /\b(exceptions?|alerts?|anomal\w*|flagged|issues?|problems?|attention|faults?)\b/;
const DEFICIT =
  /\b(deficits?|shortfalls?|shortages?|short of|short on|need more buses|needs? buses|undersupplied)\b/;
const SURPLUS = /\b(surplus\w*|spares?|excess|oversupplied|extra buses|too many buses)\b/;
const RANKING =
  /\b(best|worst|top|bottom|highest|lowest|most|least|rank\w*|leading|weakest|strongest|poorest|perform\w*)\b/;
const NETWORK =
  /\b(network|overall|overview|summary|summari[sz]e|briefing|brief|whole|entire|everything|fleet|status|situation)\b/;

const TOP_WORDS = /\b(top|highest|most|largest|biggest|greatest)\b/;
const BOTTOM_WORDS = /\b(bottom|lowest|least|smallest|fewest)\b/;
const GOOD_WORDS = /\b(best|strongest|leading|healthiest|perform\w*)\b/;
const BAD_WORDS = /\b(worst|weakest|poorest|poor|struggling|lagging|underperform\w*)\b/;

const METRIC_PATTERNS: readonly (readonly [RankMetric, RegExp])[] = [
  ['dark', /\b(dark|no[\s-]?signal|silent|offline|unreachable)\b/],
  ['offRoad', /\b(off[\s-]?road|maintenance|workshop|breakdowns?)\b/],
  ['onRoad', /\b(on[\s-]?road|running|moving|active)\b/],
  ['scheduled', /\b(schedul\w*|timetable|assigned|coverage)\b/],
];

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const DEFAULT_LIST_LIMIT = 5;
const MAX_LIMIT = 10;
const MIN_NAME_CHARS = 3;

/** Words that may follow "for/of/at" without naming a depot. */
const SCOPE_WORDS = new Set(
  (
    'network whole entire system fleet all overall every each today now moment general total ' +
    'current state it us our this week morning evening depots buses service operations brief ' +
    'short detail plain words simple a an one'
  ).split(' '),
);
const NAMED_AFTER_PREPOSITION =
  /\b(?:for|of|at|about|regarding|in|on)\s+(?:the\s+)?([a-z][a-z0-9()-]*)/g;

interface Mention {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[a-z0-9]/.test(ch);

function nameMentions(text: string, depots: readonly DepotRef[]): Mention[] {
  const found: Mention[] = [];
  for (const depot of depots) {
    const name = depot.name.toLowerCase();
    if (name.length < MIN_NAME_CHARS) continue;
    let from = text.indexOf(name);
    while (from !== -1) {
      const end = from + name.length;
      if (!isWordChar(text[from - 1]) && !isWordChar(text[end])) {
        found.push({ id: depot.id, start: from, end });
      }
      from = text.indexOf(name, end);
    }
  }
  // A shorter name inside a longer one ("agra" in "agra cantt") is not a second depot.
  return found.filter(
    (m) =>
      !found.some(
        (o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start,
      ),
  );
}

function idMentions(text: string, depots: readonly DepotRef[]): Mention[] {
  const found: Mention[] = [];
  for (const match of text.matchAll(/\b(?:depot|id)\s*#?\s*(\d{1,6})\b|#(\d{1,6})\b/g)) {
    const id = resolveDepot(match[1] ?? match[2] ?? '', depots);
    if (id !== null && match.index !== undefined) {
      found.push({ id, start: match.index, end: match.index + match[0].length });
    }
  }
  return found;
}

/**
 * Feed names carry suffixes ("BAREILLY(R)"), so people write the stem. After
 * full names and ids, words (and adjacent word pairs) of three or more
 * characters are offered to `resolveDepot`; only a unique depot whose name
 * starts with the words counts, so a stray word cannot match mid-name.
 */
function partialMentions(
  text: string,
  depots: readonly DepotRef[],
  taken: readonly Mention[],
): Mention[] {
  const words = [...text.matchAll(/[a-z0-9]+/g)].map((m) => ({
    word: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const free = (start: number, end: number): boolean =>
    !taken.some((t) => start < t.end && end > t.start);
  const found: Mention[] = [];
  const used = new Set<number>();
  const tryWindow = (from: number, to: number): void => {
    const first = words[from];
    const last = words[to];
    if (!first || !last || [...used].some((i) => i >= from && i <= to)) return;
    const phrase = text.slice(first.start, last.end);
    if (phrase.replace(/\s/g, '').length < MIN_NAME_CHARS || !free(first.start, last.end)) return;
    if (words.slice(from, to + 1).some((w) => w.word.length < MIN_NAME_CHARS)) return;
    const id = resolveDepot(phrase, depots);
    const depot = depots.find((d) => d.id === id);
    if (!depot || !depot.name.toLowerCase().startsWith(phrase)) return;
    found.push({ id: depot.id, start: first.start, end: last.end });
    for (let i = from; i <= to; i += 1) used.add(i);
  };
  for (let i = 0; i < words.length - 1; i += 1) tryWindow(i, i + 1);
  for (let i = 0; i < words.length; i += 1) tryWindow(i, i);
  return found;
}

/** Depots the question refers to, in the order written, each at most once. */
function findDepots(text: string, depots: readonly DepotRef[]): string[] {
  const exact = [...nameMentions(text, depots), ...idMentions(text, depots)];
  const mentions = [...exact, ...partialMentions(text, depots, exact)].sort(
    (a, b) => a.start - b.start,
  );
  const ids: string[] = [];
  for (const m of mentions) if (!ids.includes(m.id)) ids.push(m.id);
  return ids;
}

function wantsOtherThanNetwork(text: string): boolean {
  return [...text.matchAll(NAMED_AFTER_PREPOSITION)].some((m) => !SCOPE_WORDS.has(m[1] ?? ''));
}

const STOP_WORDS = new Set('all any are can how new the was what who and for not'.split(' '));
const QUESTION_PATTERNS = [
  NETWORK,
  EXCEPTION,
  DEFICIT,
  SURPLUS,
  RANKING,
  TRANSFER,
  OUTSHED,
  COMPARE,
];

/**
 * A question word that is the whole first word of several depot names ("meerut" for
 * MEERUT CITY and MEERUT ROAD): a name, but not a clear one. Words the question
 * patterns already use, and stop words, are never taken as names.
 */
function namesAmbiguousDepot(text: string, depots: readonly DepotRef[]): boolean {
  const words = text.match(/[a-z0-9]+/g) ?? [];
  return words.some(
    (w) =>
      w.length >= MIN_NAME_CHARS &&
      !STOP_WORDS.has(w) &&
      !QUESTION_PATTERNS.some((pattern) => pattern.test(w)) &&
      depots.filter((d) => d.name.toLowerCase().match(/[a-z0-9]+/)?.[0] === w).length > 1,
  );
}

/** The refusal for a question that needed a depot it could not pin down. */
function declined(text: string, depots: readonly DepotRef[]): CopilotQuery {
  return namesAmbiguousDepot(text, depots) ? AMBIGUOUS_DEPOT_QUERY : OUT_OF_SCOPE_QUERY;
}

function limitFrom(text: string): number {
  const digits = /\b(\d{1,3})\b/.exec(text);
  const word = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(text);
  const given = digits ? Number(digits[1]) : word ? NUMBER_WORDS[word[1] ?? ''] : undefined;
  if (given !== undefined) return Math.min(MAX_LIMIT, Math.max(1, given));
  return /\bdepots\b/.test(text) ? DEFAULT_LIST_LIMIT : 1;
}

function rankQuery(text: string): CopilotQuery {
  const metric = METRIC_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'index';
  const higherIsBetter = metricHigherIsBetter(metric);
  let order: 'top' | 'bottom' = 'top';
  if (BOTTOM_WORDS.test(text)) order = 'bottom';
  else if (TOP_WORDS.test(text)) order = 'top';
  else if (BAD_WORDS.test(text)) order = higherIsBetter ? 'bottom' : 'top';
  else if (GOOD_WORDS.test(text)) order = higherIsBetter ? 'top' : 'bottom';
  return { kind: 'rankDepots', metric, order, limit: limitFrom(text) };
}

/**
 * One measure with no depot named. Asked from a depot, it is that depot's
 * figure unless the question says it is about the network; otherwise it is the
 * network's summary, which carries the network's own figure for it.
 */
function measureWithoutDepot(
  text: string,
  depots: readonly DepotRef[],
  measure: DepotMeasure,
  scope: string | undefined,
): CopilotQuery {
  if (scope !== undefined && !NETWORK.test(text)) {
    return { kind: 'depotMeasure', depotId: scope, measure };
  }
  if (wantsOtherThanNetwork(withoutMeasureWords(text)) || namesAmbiguousDepot(text, depots)) {
    return declined(text, depots);
  }
  return { kind: 'networkSummary' };
}

/** The day's service brief: the plan for today, by name. */
const BRIEF =
  /\b(plan for (?:the day|today)|today'?s plan|day'?s plan|daily brief\w*|service brief\w*|brief for today)\b/;
/** Words that ask about routes' service at an hour: short, over-served, what to change. */
const ROUTE_SERVICE =
  /\b(over[\s-]?served|under[\s-]?served|short|change\w*|proposals?|proposed|routes?)\b/;

/**
 * A question about one route: at an hour it is that hour's figures, otherwise the route's
 * day and its proposals. A depot named beside the route is not used: the route is the subject.
 */
function routeQuery(routeName: string, rest: string): CopilotQuery {
  const hour = hourOf(rest);
  return hour === null ? { kind: 'routeProposals', routeName } : { kind: 'routeHour', routeName, hour };
}

/** Words that point at the depot the question was asked from. */
const THIS_DEPOT = /\b(this|my|our|current) depot\b|\bhere\b/;

/**
 * `scopeDepotId` is the depot the question was asked from, if any. It counts as
 * named when the text says "this depot" (or "here"), and fills in for a query
 * that needs a depot when none is named; it never displaces a named depot and
 * never turns a network, ranking or list question into a depot one. `routes` are the route
 * names the snapshot carries; a route is matched only against them.
 */
export function scriptedRoute(
  question: string,
  depots: readonly DepotRef[],
  scopeDepotId?: string,
  routes: readonly string[] = [],
): CopilotQuery {
  const clean = sanitizeQuestion(question);
  const text = clean.toLowerCase();
  if (text === '') return OUT_OF_SCOPE_QUERY;
  if (PEOPLE.test(text)) return PEOPLE_QUERY;
  if (LEADING_WHO.test(text) && !(RANKING.test(text) && FLEET_NOUN.test(text))) {
    return PEOPLE_QUERY;
  }
  const route = findRoute(text, routes);
  if (route.found === 'unknown') return UNKNOWN_ROUTE_QUERY;
  if (route.found === 'known') return routeQuery(route.routeName, route.rest);
  if (BRIEF.test(text)) return { kind: 'serviceBrief' };

  const scope = depots.some((d) => d.id === scopeDepotId) ? scopeDepotId : undefined;
  const named = findDepots(text, depots);
  const [first, second] =
    scope !== undefined && THIS_DEPOT.test(text) && !named.includes(scope)
      ? [scope, ...named]
      : named;
  const needsDepot = (build: (id: string) => CopilotQuery): CopilotQuery => {
    const id = first ?? scope;
    return id === undefined ? declined(text, depots) : build(id);
  };

  const hour = hourOf(text);
  if (hour !== null && second === undefined && ROUTE_SERVICE.test(text)) {
    return first === undefined
      ? { kind: 'hourProposals', hour }
      : { kind: 'hourProposals', hour, depotId: first };
  }
  if (COMPARE.test(text) || (first !== undefined && second !== undefined)) {
    if (first === undefined || second === undefined) return declined(text, depots);
    return { kind: 'compareDepots', depotA: first, depotB: second };
  }
  if (TRANSFER.test(text)) return needsDepot((depotId) => ({ kind: 'transfersFor', depotId }));
  if (OUTSHED.test(text)) return needsDepot((depotId) => ({ kind: 'outshedStatus', depotId }));
  if (EXCEPTION.test(text)) {
    if (
      first === undefined &&
      NETWORK.test(text) &&
      !wantsOtherThanNetwork(text) &&
      !namesAmbiguousDepot(text, depots)
    ) {
      return { kind: 'networkSummary' };
    }
    return needsDepot((depotId) => ({ kind: 'exceptionsFor', depotId }));
  }
  if (DEFICIT.test(text) || SURPLUS.test(text)) {
    // About one depot, the modelled balance is part of its transfer picture.
    if (first !== undefined) return { kind: 'transfersFor', depotId: first };
    return { kind: DEFICIT.test(text) ? 'depotsInDeficit' : 'depotsInSurplus' };
  }
  const measure = measureOf(text);
  if (first !== undefined) {
    return measure === undefined
      ? { kind: 'depotSummary', depotId: first }
      : { kind: 'depotMeasure', depotId: first, measure };
  }
  if (RANKING.test(text)) return rankQuery(text);
  if (measure !== undefined) return measureWithoutDepot(text, depots, measure, scope);
  if (NETWORK.test(text) && !wantsOtherThanNetwork(text) && !namesAmbiguousDepot(text, depots)) {
    return { kind: 'networkSummary' };
  }
  return declined(text, depots);
}

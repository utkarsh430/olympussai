import type { CopilotQuery, RankMetric } from '@/lib/depot/copilot/queries';
import { UNSUPPORTED_QUERY } from '@/lib/depot/copilot/queries';
import { resolveDepot, type DepotRef } from '@/lib/depot/copilot/router/resolveDepot';
import { sanitizeQuestion } from '@/lib/depot/copilot/router/sanitize';

/**
 * A deterministic keyword matcher: the question router used whenever Claude is
 * unavailable. It can only ever return a catalogue query, and it declines
 * (`unsupported`) rather than guess when a depot is needed but not clearly named.
 */

const PEOPLE =
  /\b(crew|crews|drivers?|conductors?|staff|employees?|personnel|people|persons?|individuals?|salary|salaries|attendance|roster|rosters)\b/;
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
const HIGHER_IS_BETTER: ReadonlySet<RankMetric> = new Set(['index', 'onRoad', 'scheduled']);

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

/** Depots the question refers to, in the order written, each at most once. */
function findDepots(text: string, depots: readonly DepotRef[]): string[] {
  const mentions = [...nameMentions(text, depots), ...idMentions(text, depots)].sort(
    (a, b) => a.start - b.start,
  );
  const ids: string[] = [];
  for (const m of mentions) if (!ids.includes(m.id)) ids.push(m.id);
  return ids;
}

function wantsOtherThanNetwork(text: string): boolean {
  return [...text.matchAll(NAMED_AFTER_PREPOSITION)].some((m) => !SCOPE_WORDS.has(m[1] ?? ''));
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
  const higherIsBetter = HIGHER_IS_BETTER.has(metric);
  let order: 'top' | 'bottom' = 'top';
  if (BOTTOM_WORDS.test(text)) order = 'bottom';
  else if (TOP_WORDS.test(text)) order = 'top';
  else if (BAD_WORDS.test(text)) order = higherIsBetter ? 'bottom' : 'top';
  else if (GOOD_WORDS.test(text)) order = higherIsBetter ? 'top' : 'bottom';
  return { kind: 'rankDepots', metric, order, limit: limitFrom(text) };
}

export function scriptedRoute(question: string, depots: readonly DepotRef[]): CopilotQuery {
  const clean = sanitizeQuestion(question);
  const text = clean.toLowerCase();
  if (text === '' || PEOPLE.test(text)) return UNSUPPORTED_QUERY;

  const [first, second] = findDepots(text, depots);
  const needsDepot = (build: (id: string) => CopilotQuery): CopilotQuery =>
    first === undefined ? UNSUPPORTED_QUERY : build(first);

  if (COMPARE.test(text) || (first !== undefined && second !== undefined)) {
    if (first === undefined || second === undefined) return UNSUPPORTED_QUERY;
    return { kind: 'compareDepots', depotA: first, depotB: second };
  }
  if (TRANSFER.test(text)) return needsDepot((depotId) => ({ kind: 'transfersFor', depotId }));
  if (OUTSHED.test(text)) return needsDepot((depotId) => ({ kind: 'outshedStatus', depotId }));
  if (EXCEPTION.test(text)) {
    if (first === undefined && NETWORK.test(text) && !wantsOtherThanNetwork(text)) {
      return { kind: 'networkSummary' };
    }
    return needsDepot((depotId) => ({ kind: 'exceptionsFor', depotId }));
  }
  if (DEFICIT.test(text) || SURPLUS.test(text)) {
    // About one depot, the modelled balance is part of its transfer picture.
    if (first !== undefined) return { kind: 'transfersFor', depotId: first };
    return { kind: DEFICIT.test(text) ? 'depotsInDeficit' : 'depotsInSurplus' };
  }
  if (first !== undefined) return { kind: 'depotSummary', depotId: first };
  if (RANKING.test(text)) return rankQuery(text);
  if (NETWORK.test(text) && !wantsOtherThanNetwork(text)) return { kind: 'networkSummary' };
  return UNSUPPORTED_QUERY;
}
